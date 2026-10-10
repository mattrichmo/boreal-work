# Boreal MCP

`boreal-mcp` is a focused adapter over Boreal's existing Global and Project
Unix-socket services. The SQLite databases remain with the Boreal host. Run
the MCP server as the same operating-system user that owns those private
service sockets and credentials.

The server stays in a focused nested Cargo package and ships as the standalone
`boreal-mcp` command. Build it with:

```sh
cargo build --release --manifest-path crates/mcp/Cargo.toml
```

This produces `target/release/boreal-mcp` in the package workspace (Cargo may
use a configured shared target directory). The executable has three commands:

```text
boreal-mcp serve --config /absolute/path/mcp.toml --transport stdio --profile personal
boreal-mcp serve --config /absolute/path/mcp.toml --transport http
boreal-mcp status --config /absolute/path/mcp.toml
```

Stdio reserves stdout for MCP protocol messages; logs and errors go to stderr.
Use the stdio command from a local MCP client. The profile name selects a
server-side allowlist; the client cannot choose its own Boreal actor or scopes.
Install the binary beside the host's Boreal tools with
`cargo install --path crates/mcp --locked`. The root `bwrk mcp` wrapper and shared workspace wiring
are part of the CLI integration handoff below.

The adapter pins MCP protocol `2026-07-28` and Rust SDK `rmcp 3.5.1`. It uses
that version's `server/discover` lifecycle, so MCP clients must support this
protocol version; the older `initialize` handshake is not enabled.

## Configuration

The config is TOML, versioned, limited to 256 KiB, and must be a regular file
owned by the current user with mode `0600`. Store credentials in environment
variables, not in the file. Example for a local stdio profile and a loopback
HTTP listener (replace socket paths, IDs and identity-provider URLs):

```toml
version = 1

[global]
socket = "/absolute/private/runtime/global.sock"

[projects."project-a"]
socket = "/absolute/private/runtime/project-a.sock"

[projects."project-a".credential_env_by_actor]
"mcp-agent" = "BOREAL_PROJECT_A_CREDENTIAL"

[stdio_profiles.personal]
actor_id = "mcp-agent"
projects = ["project-a"]
scopes = ["boreal:global:read", "boreal:project:read", "boreal:project:work-write"]

[principals."agent-subject-from-provider"]
actor_id = "mcp-agent"
projects = ["project-a"]
scopes = ["boreal:global:read", "boreal:project:read", "boreal:project:work-write"]

[http]
bind = "127.0.0.1:8765"
resource_uri = "http://127.0.0.1:8765/mcp"
authorization_servers = ["https://identity.example.test/"]
allowed_hosts = ["127.0.0.1:8765"]
allowed_origins = []

[http.introspection]
endpoint = "https://identity.example.test/oauth/introspect"
issuer = "https://identity.example.test/"
client_id = "boreal-mcp"
client_secret_env = "BOREAL_MCP_INTROSPECTION_SECRET"
max_token_lifetime_seconds = 900
```

Create the file privately and provide secrets through the service manager's
environment (do not put secret values in command-line arguments):

```sh
umask 077
install -m 600 /dev/null /absolute/path/mcp.toml
${EDITOR:-vi} /absolute/path/mcp.toml
export BOREAL_PROJECT_A_CREDENTIAL='the existing Boreal project credential'
export BOREAL_MCP_INTROSPECTION_SECRET='the OAuth introspection client secret'
boreal-mcp status --config /absolute/path/mcp.toml
```

Use the same account that owns the configured Boreal service sockets. `status`
checks config validity and whether the local sockets accept a connection; it
prints configured scopes and project bindings but no actor identities,
credential values, secret environment names or socket paths. A false socket
reachability value means start or repair that Boreal service before MCP use.

## Scope and HTTP security

Global is this installation's portfolio, and has a separate `boreal:global:read`
grant. Each Project is separately bound in `[projects.<id>]`, and every
principal/profile must separately list its allowed Project IDs. Knowing a
project ID does not authorize it. Supported grants are:

* `boreal:global:read`
* `boreal:project:read`
* `boreal:project:work-write`

HTTP uses OAuth 2.0 bearer access tokens checked at the configured RFC 7662
introspection endpoint. The introspection response must include an active
subject, the configured issuer, the MCP resource URI as audience, a future
expiration within the configured maximum lifetime, and scopes. The subject is
mapped server-side to a fixed Boreal actor, project allowlist and grant set;
token scopes are intersected with configured grants. OAuth access tokens are
never forwarded to Boreal services. The server uses its actor-specific
internal project credential instead.

The HTTP endpoint is `/mcp`, with protected-resource metadata at
`/.well-known/oauth-protected-resource` and
`/.well-known/oauth-protected-resource/mcp`. Host and Origin checks run before
authentication and tool routing. Browser Origins are denied unless explicitly
listed. Loopback HTTP is useful for local testing; OAuth authentication is
still required.

To serve beyond loopback, explicitly configure an HTTPS `resource_uri`, TLS
certificate and private key paths, an exact Host allowlist, an OAuth
authorization server and a protected HTTPS introspection endpoint. The private
key must be owner-owned, regular and mode `0600`; certificate/key paths must be
absolute. A reverse proxy may terminate TLS only when it provides correct
authenticated upstream protection and preserves the configured Host and
Origin policy. A private network by itself is not authorization. Do not expose
this server without a reviewed provider/client configuration and valid TLS.

`boreal-mcp serve --transport http` runs in the foreground and handles Ctrl-C;
use the host's existing service manager when supervision is needed. It does not
create OAuth clients, certificates, firewall rules, tunnels, or accounts.

## Available tools and contract limits

Tools are filtered by the authenticated policy and identify the target Project
on each call:

| Tool | Scope | Existing service operation |
| --- | --- | --- |
| `boreal_capabilities` | authenticated | Shows only explicit bindings and configured capabilities |
| `global_page` | Global read | Bounded Global detail page for projects, items, or notes |
| `project_status` | Project read | Bounded status page |
| `project_work_show` | Project read | Read a work item |
| `project_source_list` | Project read | Bounded source metadata list |
| `project_review_list` | Project read | Bounded review records page |
| `project_review_show` | Project read | One review and bounded evidence metadata |
| `operation_status` | Project read | Reconcile an existing durable operation ID |
| `project_agent_guide` | Project read | Read current workflow context and obligations |
| `project_agent_next` | Project read | Get Boreal's next safe action |
| `project_agent_resume` | Project read | Read recovery guidance for an attempt |
| `project_session_start` | Project work-write | Register a server-bound actor session |
| `project_session_end` | Project work-write | End the authenticated actor's session |
| `project_work_create` | Project work-write | Create a task or planning container through the application service |
| `project_work_edit` | Project work-write | Existing edit command with expected revision and operation ID |
| `project_work_claim` | Project work-write | Existing claim command with expected revision, attempt/session/source/config identities and operation ID |
| `project_work_wait` | Project work-write | Record a reason-coded work hold |
| `project_agent_start` | Project work-write | Atomic claim, accept, and start or resume |
| `project_work_checkpoint` | Project work-write | Record a confirmed typed checkpoint |
| `project_attempt_heartbeat` | Project work-write | Heartbeat a fenced attempt |
| `project_attempt_renew` | Project work-write | Renew a fenced attempt lease |
| `project_attempt_submit` | Project work-write | Submit for downstream verification |
| `project_attempt_release` | Project work-write | Release a fenced attempt with an optional reason |

Tool input is capped at 16 KiB, service frames at 128 KiB, inline tool output
at 64 KiB, page size at 50 rows and backend concurrency at 32 calls. A write
timeout returns an unknown outcome with the original operation ID. Read
`operation_status` before retrying; MCP request IDs are not used as write
identity. Expected revisions preserve Boreal conflict handling.

Claim retries are compared with Boreal's durable canonical request digest. An
exact retry returns the original claim result as unchanged; reusing that
operation ID with a different payload returns a conflict. The adapter reads
the original operation through the Project service before dispatching a retry.

`tools/list` is filtered for the authenticated principal's actual grants and
project bindings. Its response is marked private with a zero cache lifetime so
one principal's view cannot be reused for another principal.

Global writes, Send/Intake, operator hold resolution, artifact/evidence
mutation, workflow/review decisions, source/memory body reads, and machine
administration are not exposed. Evidence submission and review decisions remain
gated until Boreal has a separate, explicit authorization contract for them.
`project_attempt_submit` hands work to downstream verification; it does not
approve or close it. `project_session_end` records a session boundary; it does
not create a handoff summary. There is no generic shell, SQL, arbitrary
filesystem or URL-fetch tool. Artifact bodies are not returned.

For `project_agent_guide`, `project_agent_next`, and `project_agent_resume`,
provide a stable `session_id`. It is an audit/context label and does not prove
caller identity; the server derives the actor from the authenticated profile or
OAuth subject mapping. Use a distinct session ID per concurrent worker and
reuse it only when continuing that worker's own attempt. `project_agent_start`
uses Boreal's selector when `work_id` is omitted and requires the current
`source_version_id`, `config_identity`, expected revision, and a durable
operation ID. On an uncertain write, read `operation_status` for that same ID
before retrying.

## Validation

Run the MCP unit and synthetic HTTP-auth tests from the repository root:

```sh
cargo test --manifest-path crates/mcp/Cargo.toml --lib
```

The real-daemon regression starts a disposable `bwrk service run` process over
a temporary project database and checks status, work edits, claim/replay,
revision conflicts, and operation readback after a deliberately dropped
response. Build the current CLI binary first, then run the daemon test
explicitly:

```sh
cargo build -p boreal-cli --bin bwrk
BWRK_BIN="$PWD/target/debug/bwrk" cargo test \
  --manifest-path crates/mcp/Cargo.toml --lib \
  backend::tests::project_work_journey_and_lost_reply_reconcile_with_real_daemon \
  -- --ignored --exact
```

The test creates and removes only synthetic local project data and credentials;
it does not contact an external provider or expose a listener.

## CLI integration handoff

The `boreal-mcp` executable is installable beside the host's existing Boreal
tools. The root `bwrk mcp` wrapper and root workspace membership are held for
the CLI integration owner to wire and qualify; that change requires removing
this package's nested `[workspace]` marker and reconciling the root lockfile.
The package depends on the current local `boreal-application`,
`boreal-protocol`, and `boreal-service` crates, and routes existing Global and
Project commands through their private Unix sockets.
The current baseline does not provide actor-aware Global writes or
digest-verified source/memory content reads. Avoid adding duplicate command
implementations in the adapter.

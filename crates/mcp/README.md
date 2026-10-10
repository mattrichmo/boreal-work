# Boreal MCP

`boreal-mcp` is a focused adapter over Boreal's existing Global and Project
Unix-socket services. The SQLite databases remain with the Boreal host. Run
the MCP server as the same operating-system user that owns those private
service sockets and credentials.

The server stays in a focused crate in the root Cargo workspace. The installed
`bwrk` CLI exposes `mcp` commands, and the crate also builds a standalone
`boreal-mcp` executable. Build and install the first-class CLI with:

```sh
cargo build --release -p boreal-cli --bin bwrk
cargo install --path crates/cli --bin bwrk --locked
```

The CLI command surface is:

```text
bwrk mcp start --config /absolute/path/mcp.toml
bwrk mcp serve --config /absolute/path/mcp.toml --transport stdio --profile personal
bwrk mcp serve --config /absolute/path/mcp.toml --transport http
bwrk mcp status --config /absolute/path/mcp.toml
```

Stdio reserves stdout for MCP protocol messages; logs and errors go to stderr.
Use the stdio command from a local MCP client. The profile name selects a
server-side allowlist; the client cannot choose its own Boreal actor or scopes.
`start` runs the configured authenticated Streamable HTTP server in the
foreground; it does not create a daemon. `serve` selects stdio or HTTP
explicitly. The standalone executable remains available for clients that
launch MCP servers directly:

```sh
cargo install --path crates/mcp --locked
boreal-mcp serve --config /absolute/path/mcp.toml --transport stdio --profile personal
```

`bwrk mcp status` emits the normal Boreal JSON envelope. The standalone
`boreal-mcp status` command emits the status object directly.

The adapter pins MCP protocol `2026-07-28` and Rust SDK `rmcp 3.5.1`. It uses
that version's `server/discover` lifecycle with per-request metadata, so MCP
clients must support this protocol version; the older `initialize` handshake
is not enabled.

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
grant. `global_page.management_project_id` filters a Global management project;
it is not an execution workspace selector. Each Project is separately bound
in `[projects.<id>]`, and every principal/profile must separately list its
allowed Project IDs. Knowing a project ID does not authorize it. Supported
grants are:

* `boreal:global:read`
* `boreal:project:read`
* `boreal:project:work-write`
* `boreal:project:evidence-write`
* `boreal:project:finish-close`

Evidence write and finish-close each require Project read and an explicit
project binding. They are separate grants, neither implies the other, and
neither is inherited from ordinary work-write. Add only the specific grant a
principal needs to its `[principals.<subject>]` or `[stdio_profiles.<name>]`
entry. For HTTP, the active token must also include Project read; the effective
grant is the intersection of token scopes and configured policy scopes.

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
| `global_page` | Global read | Bounded Global page for projects, items, notes, statuses, relationships, note links, or status history |
| `global_history` | Global read | Bounded Global activity history, optionally filtered by a management project or item |
| `project_status` | Project read | Bounded status page |
| `project_work_show` | Project read | Read a work item |
| `project_work_rollup` | Project read | Read an existing container rollup |
| `project_dependency_graph` | Project read | Read the dependency tree or cycle diagnostics |
| `project_session_show` | Project read | Read one exact Project session binding |
| `project_source_list` | Project read | Bounded source metadata list with catalog and origin paths removed |
| `project_source_search` | Project read | Search the existing source index for bounded excerpts; local origin strings are omitted |
| `project_memory_search` | Project read | Search immutable published memory for bounded excerpts and citations |
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
| `project_evidence_add` | Project evidence-write | Import a typed Boreal receipt through `evidence_add`; the durable operation ID must equal `receipt.operation_id` |
| `project_finish_close` | Project finish-close | Submit a typed receipt and inline summary to the existing finish-close service under a durable close operation ID |

`global_page` accepts only the seven collection names in its tool schema. Its
optional `management_project_id` is a Global portfolio filter. `kind` is
available only for Global items. Source and published-memory searches return at
most 20 results; excerpts are capped by the existing service at 1 KiB and 512
bytes respectively.

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

Global writes, Send/Intake, operator hold resolution, evidence execution,
workflow/review decisions, full source/memory bodies, and machine
administration are not exposed. `global_page` excludes associations because
they contain filesystem paths and excludes imported database snapshots. It
omits Global note bodies and project/item descriptions. `project_evidence_add`
imports a typed receipt;
it does not run a verifier. The verifier-capable `evidence_run` service route
has no MCP wrapper. `project_finish_close` calls Boreal's existing closeout
route, which validates the receipt, attempt, fence, summary, and gates; Boreal
may return a gate rejection while retaining its durable result. It also does
not run verifier work. `project_attempt_submit` hands work to downstream
verification; it does not approve or close it. `project_session_end` records a
session boundary; it does not create a handoff summary. There is no generic
shell, SQL, arbitrary filesystem or URL-fetch tool. Artifact bodies are not
returned.

## Accepted feature matrix and service mapping

| Capability | MCP surface | Existing Boreal route or method | Status and boundary |
| --- | --- | --- | --- |
| Discovery | MCP `server/discover`, `tools/list`, `boreal_capabilities` | RMCP `ServerHandler::discover` / `BorealBackend::capabilities` | Available; discovery is server metadata and does not enumerate unbound projects. |
| Guide | `project_agent_guide` | Project service `command=guide` → `ServiceCommandHandler::guidance("guide")` | Available for an explicitly bound project and stable session label. |
| Next | `project_agent_next` | Project service `command=next` → `ServiceCommandHandler::guidance("next")` | Available through the existing guidance selector. |
| Resume context | `project_agent_resume` | Project service `command=resume` → `ServiceCommandHandler::guidance("resume")` | Available as read-only recovery guidance. |
| Start or resume attempt | `project_agent_start` | Project service `command=start` → `ServiceCommandHandler::start`; uses `WorkApplication::claim`, `accept`, and `start` | Available as the existing atomic route; the MCP adapter does not create a second lifecycle. |
| Work checkpoint | `project_work_checkpoint` | Project service `command=completion` → `completion_commands::apply` → `WorkApplication::complete` with `CompletionCommandDto(kind="work.checkpoint")` | Available as a typed checkpoint. It is not an evidence receipt or a finish decision. |
| Receipt import | `project_evidence_add` under `boreal:project:evidence-write` | Project service `command=evidence_add` → `WorkApplication::record_receipt` | Available for typed receipt imports only. Boreal retains invalid or untrusted receipts under its existing rules. No verifier process is run. The operation ID must equal the receipt's durable operation ID. |
| Final finish-close | `project_finish_close` under `boreal:project:finish-close` | Project service `command=finish_close` → receipt admission, `WorkApplication::prepare_finish`, summary recording, and close finalization | Available through the existing service contract. The service owns attempt/fence/gate validation and durable replay; a gate rejection remains a rejection. A submit rejection after receipt admission is durably recorded with receipt and submit operation IDs, while exact replay returns that result. The MCP adapter does not implement a parallel close rule or run verifier work. |
| Release | `project_attempt_release` | Project service `command=release` → `ServiceCommandHandler::release` → `WorkApplication::release` | Available with explicit attempt ID, fence, expected revision, and operation ID. |
| Submit for verification | `project_attempt_submit` | Project service `command=submit` → `WorkApplication::submit` | Available as a nonterminal handoff to downstream verification; it does not approve or close work. |

Review listing/details are read-only. No review decision or operator hold
resolution tool is exposed. Adding those tools would require stronger grants
than the current `boreal:project:work-write` permission.

For `project_agent_guide`, `project_agent_next`, and `project_agent_resume`,
provide a stable `session_id`. It is an audit/context label and does not prove
caller identity; the server derives the actor from the authenticated profile or
OAuth subject mapping. Use a distinct session ID per concurrent worker and
reuse it only when continuing that worker's own attempt. `project_agent_start`
uses Boreal's selector when `work_id` is omitted and requires the current
`source_version_id`, `config_identity`, expected revision, and a durable
operation ID. On an uncertain write, read `operation_status` for that same ID
before retrying.

For `project_evidence_add`, use the receipt's own `operation_id` as the MCP
operation ID, then use it for `operation_status` after a timeout. For
`project_finish_close`, use the durable outer close operation ID for
`operation_status`; Boreal separately journals the receipt and close result.
Reuse the exact original payload after readback. A changed payload under that
same ID is a conflict. The expected project revision is checked before Boreal
records the finish intent. If a concurrent write advances the project after
that intent but before receipt admission, Boreal records a terminal conflict;
refresh the project state and submit a new finish operation ID.
If submission is rejected after receipt admission, the recorded result reports
`submit_rejected` (or an operation-ID conflict) and retains the receipt;
retrying the same close ID and payload returns that result without submitting
again. If the service cannot establish whether submission committed, it leaves
the outcome unresolved for operation readback instead of claiming rollback.

## Validation

Run the MCP unit and synthetic HTTP-auth tests from the repository root:

See [OPERATION_MATRIX.md](OPERATION_MATRIX.md) for the supported Project and
Global CLI/service route inventory, the MCP mapping for each route family, and
the reason each omitted family stays unavailable.

```sh
cargo test -p boreal-mcp --lib
```

The library suite exercises stdio JSON-lines discovery/tool calls with a local
profile, plus a loopback Streamable HTTP Global page request against a
disposable SQLite Global application with synthetic authorization.

The real-daemon regression starts a disposable `bwrk service run` process over
a temporary project database and checks status, work edits, claim/replay,
revision conflicts, scoped synthetic receipt import, finish-close gate
rejection/replay, and operation readback after deliberately dropped claim,
edit, and finish responses. It also checks a competing actor cannot claim
already-claimed work. The receipts use synthetic `external_attested` fixtures;
the test does not run a verifier. Build the current CLI binary first, then run
the daemon test explicitly:

```sh
cargo build -p boreal-cli --bin bwrk
BWRK_BIN="$PWD/target/debug/bwrk" cargo test \
  -p boreal-mcp --lib \
  backend::tests::project_work_journey_and_lost_reply_reconcile_with_real_daemon \
  -- --ignored --exact
```

The test creates and removes only synthetic local project data and credentials;
it does not contact an external provider or expose a listener.

## CLI integration

The `bwrk mcp start|serve|status` commands and workspace membership use the
same `boreal-mcp` library and configuration as the standalone executable. The
package depends on the current local `boreal-application`, `boreal-protocol`,
and `boreal-service` crates, and routes existing Global and Project commands
through their private Unix sockets.
The current baseline does not provide actor-aware Global writes or
digest-verified source/memory content reads. Avoid adding duplicate command
implementations in the adapter.

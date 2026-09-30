# Global registry controls and discovery

The global manager has its own database. Registry IDs below are management
project IDs, not local workspace IDs. Pausing a management project changes
cross-project participation; it does not pause or release local work attempts.

```sh
bwrk registry pause PROJECT_ID --expected-revision REV --yes --json
bwrk registry resume PROJECT_ID --expected-revision REV --yes --json
bwrk registry set-state PROJECT_ID --state archived --expected-revision REV --yes --json
bwrk registry doctor --json
bwrk global next --limit 25 --json
```

`set-state` accepts linked, paused and archived. Missing links are derived
failures diagnosed by doctor, not operator-authored lifecycle values. Resume
requires an unarchived nonterminal project; use explicit global project
unarchive controls for archived records. Changes share the global manager's
atomic operation/revision/history boundary and preserve local project state.

Doctor checks associated folders and workspace metadata identities, reports
unavailable links and duplicate associations, and performs no link repair.
Global next reads live project status rather than trusting cached rollups. It
ranks dispatchable advisory candidates by work priority, management priority,
and stable identity, excludes paused/terminal/archived management projects,
and returns the workspace directory and a `prime` argv. Each recommendation
names its observed project revision. Run prime from that directory to
authenticate and obtain current trusted guidance before claiming work. No
cross-project credentials are copied or work claimed by global next.

These commands are local; they do not silently redirect an explicit project
service socket to the separate global database.

Discovery refuses registries above 1,000 associations rather than silently
returning an incomplete diagnostic. Linked project metadata is bounded to 64 KiB.

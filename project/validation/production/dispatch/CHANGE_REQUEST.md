# Shared-file or bounded-scope change request

- Request ID:
- Requesting task / attempt:
- Source identity:
- Requested shared paths:
- Current owner/steward:
- Why the task cannot remain within its assigned boundary:
- Contract/schema/protocol/migration impact:
- Conflicting tasks checked with `tools/plan.py conflicts`:
- Proposed serialized integration order:
- Required focused and integration reruns:
- Reviewer and coordinator disposition:

No worker may edit an unassigned shared path while this request is pending.
Approval changes the dispatch record and ledger before the edit begins; it does
not retroactively authorize an existing patch.

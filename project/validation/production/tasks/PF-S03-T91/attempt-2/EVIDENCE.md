# PF-S03-T91 attempt 2 — reconciliation record

## Disposition

`bounded_correction_recorded_not_accepted`.

At implementation revision `be79688ebefcd6004a9f6f60c4b27a8c99ca6e60`, the
coordinator reconciled the source-binding defect and wired real status action
facts through store → application → CLI JSON. Missing facts remain explicit,
integrity is quarantined for damaged rows, and no mutation action is invented
from a display label.

The full action descriptor set still requires the remaining canonical
decision-input records before it can be safely exposed. T90 remains without
independent review, so this record does not accept PF-S03.

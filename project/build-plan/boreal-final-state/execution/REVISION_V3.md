# Revision 3 dispatch amendment

This file updates wave sequencing; it does not overwrite active file grants or the S00 recovery repair. Read the existing PARALLEL_DISPATCH.md, SHARED_FILES.md and STREAMS.md as ownership rules, with the current task-level graph in ../DEPENDENCY_GRAPH.md taking precedence over their historical wave numbering.

After S00-T90, run independent S01 recovery, S02 packaging, S04 Global reads, S12-T01 contract work and nonconflicting S08 groundwork. S08-T02 requires S12-T01. S12-T02/T03/T04 may run concurrently on disjoint modules; T05 integrates their interfaces and T06 consumes S02 packaging. S05-T05 consumes S12-T01; S07-T05 consumes S12-T05. S09 waits for both S07 and S08. S11 waits for S09, S10 and S12 gates.

A single coordinator owns cross-sprint arbitration. Each protected whole file has one writer/steward across the wave. The new S12 packets list candidate modules only: bind exact files before implementation and obtain bounded grants for extra paths. Never use different line ranges as independent ownership.

Do not dispatch the preserved S10-T04/T05/T06 optional cards from the core graph. Their reviewed activation and runtime disposition rules are in ../DEFERRED.md and ../IMPORT.md. The three conditional IDs are preserved, not completed or erased.

Leaf-local contract checks are required only where the packet explicitly names a downstream dependency. Keep one T90 per sprint. Do not change task/role policy to fit an Operator-authenticated agent; verify enrolled-worker behavior in S12 and final acceptance.

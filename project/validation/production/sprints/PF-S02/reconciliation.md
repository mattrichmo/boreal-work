# PF-S02 reconciliation — attempt 1

Source revision: `be79688ebefcd6004a9f6f60c4b27a8c99ca6e60`.

The coordinator reconciled the three reported implementation gaps without
changing the Rust-centered authority boundary:

1. caller credentials are derived locally and checked for direct and socket
   routes before project mutations;
2. backup and restore external effects are admitted and read back through a
   durable maintenance-job journal with stable operation identity;
3. status rows carry the real canonical revision/session/source/configuration
   and integrity facts, while missing facts deny forward actions rather than
   being replaced with fabricated descriptors;
4. the production oracle binds to an externally generated source/artifact
   manifest and therefore remains valid across commits.

The focused and full automated checks listed in the task evidence passed. This
reconciliation is not acceptance: T90 has no independent reviewer, PF-S02-T92
has not authorized successors, and native/crash/service/release evidence is
still open.

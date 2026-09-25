-- Acceptance retains the exact exceptional dispositions used at closeout.
CREATE TABLE boreal_outcome_exception (
 outcome_id TEXT NOT NULL REFERENCES boreal_accepted_outcome(outcome_id),
 exception_id TEXT NOT NULL REFERENCES boreal_policy_exception(exception_id),
 PRIMARY KEY(outcome_id,exception_id)
);
CREATE TRIGGER boreal_outcome_exception_update BEFORE UPDATE ON boreal_outcome_exception
BEGIN SELECT RAISE(ABORT,'accepted_exception_link_immutable'); END;
CREATE TRIGGER boreal_outcome_exception_delete BEFORE DELETE ON boreal_outcome_exception
BEGIN SELECT RAISE(ABORT,'accepted_exception_link_immutable'); END;

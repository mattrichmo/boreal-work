-- Canonical planning: containment is not cycle membership. Historical sprint
-- rows and edges are retained; no historical closeout becomes accepted proof.
DROP TRIGGER work_parent_kind_guard;
DROP TRIGGER work_parent_kind_guard_update;
DROP TRIGGER work_parent_retype_guard;
CREATE TRIGGER work_parent_kind_guard BEFORE INSERT ON work_item
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM work_item p WHERE p.project_id=NEW.project_id AND p.work_id=NEW.parent_id
 AND ((p.kind='milestone' AND NEW.kind IN ('milestone','task','sprint'))
   OR (p.kind='sprint' AND NEW.kind='task')
   OR (p.kind='task' AND NEW.kind='task' AND EXISTS (
     SELECT 1 FROM work_node_v3 n WHERE n.project_id=p.project_id AND n.work_id=p.work_id AND n.execution_mode='container'))))
BEGIN SELECT RAISE(ABORT,'invalid_parent_kind'); END;
CREATE TRIGGER work_parent_kind_guard_update BEFORE UPDATE OF project_id,parent_id,kind ON work_item
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM work_item p WHERE p.project_id=NEW.project_id AND p.work_id=NEW.parent_id
 AND ((p.kind='milestone' AND NEW.kind IN ('milestone','task','sprint'))
   OR (p.kind='sprint' AND NEW.kind='task')
   OR (p.kind='task' AND NEW.kind='task' AND EXISTS (
     SELECT 1 FROM work_node_v3 n WHERE n.project_id=p.project_id AND n.work_id=p.work_id AND n.execution_mode='container'))))
BEGIN SELECT RAISE(ABORT,'invalid_parent_kind'); END;
CREATE TRIGGER work_parent_retype_guard BEFORE UPDATE OF kind ON work_item
WHEN NEW.kind<>OLD.kind AND (EXISTS(SELECT 1 FROM work_item c WHERE c.project_id=NEW.project_id AND c.parent_id=NEW.work_id)
 OR EXISTS(SELECT 1 FROM work_node_v3 n WHERE n.project_id=NEW.project_id AND n.work_id=NEW.work_id))
BEGIN SELECT RAISE(ABORT,'retype_requires_explicit_proof_generation'); END;
CREATE TRIGGER boreal_containment_no_cycle BEFORE UPDATE OF parent_id ON work_item
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
 WITH RECURSIVE ancestor(id) AS (SELECT NEW.parent_id UNION SELECT w.parent_id FROM work_item w JOIN ancestor a ON a.id=w.work_id WHERE w.project_id=NEW.project_id AND w.parent_id IS NOT NULL)
 SELECT 1 FROM ancestor WHERE id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'work_containment_cycle'); END;
-- Only fill absent projections. Existing conflicting records remain for doctor,
-- rather than silently choosing one of two historical versions of a parent.
INSERT INTO work_node_v3(work_id,project_id,decomposition_kind,execution_mode,parent_id,created_at,updated_at)
WITH RECURSIVE tree(work_id,project_id,depth) AS (
 SELECT work_id,project_id,0 FROM work_item WHERE parent_id IS NULL AND kind IN ('milestone','task')
 UNION ALL SELECT c.work_id,c.project_id,t.depth+1 FROM work_item c JOIN tree t ON c.parent_id=t.work_id AND c.project_id=t.project_id WHERE t.depth<1024)
SELECT w.work_id,w.project_id,w.kind,CASE WHEN w.kind='milestone' THEN 'container' ELSE 'direct' END,
 CASE WHEN p.kind='sprint' THEN p.parent_id ELSE w.parent_id END,w.created_at,w.updated_at
FROM tree t JOIN work_item w ON w.project_id=t.project_id AND w.work_id=t.work_id
LEFT JOIN work_item p ON p.project_id=w.project_id AND p.work_id=w.parent_id
WHERE w.kind IN ('milestone','task') AND NOT EXISTS (SELECT 1 FROM work_node_v3 n WHERE n.project_id=w.project_id AND n.work_id=w.work_id)
ORDER BY t.depth,w.work_id;
CREATE TRIGGER boreal_work_node_create AFTER INSERT ON work_item
WHEN NEW.kind IN ('milestone','task')
BEGIN
 INSERT INTO work_node_v3(work_id,project_id,decomposition_kind,execution_mode,parent_id,created_at,updated_at)
 VALUES(NEW.work_id,NEW.project_id,NEW.kind,CASE WHEN NEW.kind='milestone' THEN 'container' ELSE 'direct' END,
 CASE WHEN EXISTS(SELECT 1 FROM work_item p WHERE p.project_id=NEW.project_id AND p.work_id=NEW.parent_id AND p.kind='sprint')
 THEN (SELECT p.parent_id FROM work_item p WHERE p.project_id=NEW.project_id AND p.work_id=NEW.parent_id) ELSE NEW.parent_id END,NEW.created_at,NEW.updated_at);
END;
CREATE TRIGGER boreal_work_node_parent_sync AFTER UPDATE OF parent_id ON work_item
WHEN NEW.kind IN ('milestone','task')
BEGIN
 UPDATE work_node_v3 SET parent_id=CASE WHEN EXISTS(SELECT 1 FROM work_item p WHERE p.project_id=NEW.project_id AND p.work_id=NEW.parent_id AND p.kind='sprint')
 THEN (SELECT p.parent_id FROM work_item p WHERE p.project_id=NEW.project_id AND p.work_id=NEW.parent_id) ELSE NEW.parent_id END,updated_at=NEW.updated_at
 WHERE project_id=NEW.project_id AND work_id=NEW.work_id;
END;
CREATE TRIGGER boreal_projection_parent_guard BEFORE UPDATE OF parent_id ON work_node_v3
WHEN NEW.parent_id IS NOT (SELECT CASE WHEN p.kind='sprint' THEN p.parent_id ELSE w.parent_id END FROM work_item w
 LEFT JOIN work_item p ON p.project_id=w.project_id AND p.work_id=w.parent_id WHERE w.project_id=NEW.project_id AND w.work_id=NEW.work_id)
BEGIN SELECT RAISE(ABORT,'edit_canonical_work_parent_not_projection'); END;
-- New graph writes have direct-task endpoints. Legacy edges are not deleted.
CREATE TRIGGER boreal_dependency_direct BEFORE INSERT ON dependency
WHEN (SELECT COUNT(*) FROM work_node_v3 n WHERE n.project_id=NEW.project_id AND n.work_id IN(NEW.prerequisite_id,NEW.dependent_id)
 AND n.decomposition_kind='task' AND n.execution_mode='direct')<>2
BEGIN SELECT RAISE(ABORT,'dependency_requires_direct_tasks'); END;
CREATE TRIGGER boreal_dependency_projection_insert AFTER INSERT ON dependency
BEGIN INSERT INTO work_dependency_v3(project_id,prerequisite_work_id,dependent_work_id,policy,created_at)
 VALUES(NEW.project_id,NEW.prerequisite_id,NEW.dependent_id,'closed_only',NEW.created_at); END;
CREATE TRIGGER boreal_dependency_projection_delete AFTER DELETE ON dependency
BEGIN DELETE FROM work_dependency_v3 WHERE project_id=OLD.project_id AND prerequisite_work_id=OLD.prerequisite_id AND dependent_work_id=OLD.dependent_id; END;
CREATE TRIGGER boreal_dependency_projection_authority BEFORE INSERT ON work_dependency_v3
WHEN NOT EXISTS(SELECT 1 FROM dependency d WHERE d.project_id=NEW.project_id AND d.prerequisite_id=NEW.prerequisite_work_id AND d.dependent_id=NEW.dependent_work_id)
BEGIN SELECT RAISE(ABORT,'edit_canonical_dependency_not_projection'); END;
CREATE TRIGGER boreal_dependency_projection_no_update BEFORE UPDATE ON work_dependency_v3
BEGIN SELECT RAISE(ABORT,'edit_canonical_dependency_not_projection'); END;
CREATE TRIGGER boreal_dependency_projection_no_delete BEFORE DELETE ON work_dependency_v3
WHEN EXISTS(SELECT 1 FROM dependency d WHERE d.project_id=OLD.project_id AND d.prerequisite_id=OLD.prerequisite_work_id AND d.dependent_id=OLD.dependent_work_id)
BEGIN SELECT RAISE(ABORT,'edit_canonical_dependency_not_projection'); END;
CREATE TABLE boreal_cycle_event (
 event_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
 project_id TEXT NOT NULL,cycle_id TEXT NOT NULL,kind TEXT NOT NULL,prior_state TEXT,next_state TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES actor(actor_id),reason TEXT NOT NULL CHECK(trim(reason)<>''),payload_json TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,cycle_id) REFERENCES cycle_v3(project_id,cycle_id));
CREATE INDEX boreal_cycle_event_history ON boreal_cycle_event(project_id,cycle_id,created_at,event_id);
CREATE TABLE boreal_assignment_event (
 event_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
 project_id TEXT NOT NULL,assignment_id TEXT NOT NULL,cycle_id TEXT NOT NULL,work_id TEXT NOT NULL,
 prior_state TEXT,next_state TEXT NOT NULL,predecessor_id TEXT,successor_id TEXT,
 actor_id TEXT NOT NULL REFERENCES actor(actor_id),reason TEXT NOT NULL CHECK(trim(reason)<>''),created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,assignment_id) REFERENCES cycle_assignment_v3(project_id,assignment_id));
CREATE INDEX boreal_assignment_event_history ON boreal_assignment_event(project_id,work_id,created_at,event_id);
CREATE TABLE boreal_legacy_sprint_cycle (
 project_id TEXT NOT NULL,sprint_work_id TEXT NOT NULL,cycle_id TEXT NOT NULL,
 operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
 reason TEXT NOT NULL CHECK(trim(reason)<>''),created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,sprint_work_id),FOREIGN KEY(project_id,sprint_work_id) REFERENCES work_item(project_id,work_id),
 FOREIGN KEY(project_id,cycle_id) REFERENCES cycle_v3(project_id,cycle_id));
CREATE TRIGGER boreal_assignment_identity BEFORE UPDATE OF assignment_id,project_id,cycle_id,work_id ON cycle_assignment_v3
BEGIN SELECT RAISE(ABORT,'assignment_identity_immutable'); END;
CREATE TRIGGER boreal_assignment_no_delete BEFORE DELETE ON cycle_assignment_v3
BEGIN SELECT RAISE(ABORT,'assignment_history_requires_disposition'); END;
CREATE TRIGGER boreal_assignment_terminal_update BEFORE UPDATE OF state ON cycle_assignment_v3
WHEN NEW.state IN('planned','committed') AND EXISTS(SELECT 1 FROM cycle_v3 c WHERE c.project_id=NEW.project_id AND c.cycle_id=NEW.cycle_id AND c.lifecycle IN('completed','cancelled'))
BEGIN SELECT RAISE(ABORT,'cannot_commit_into_terminal_cycle'); END;
CREATE TRIGGER boreal_immutable_boreal_cycle_event_update BEFORE UPDATE ON boreal_cycle_event
BEGIN SELECT RAISE(ABORT,'boreal_cycle_event_immutable_history'); END;
CREATE TRIGGER boreal_immutable_boreal_cycle_event_delete BEFORE DELETE ON boreal_cycle_event
BEGIN SELECT RAISE(ABORT,'boreal_cycle_event_immutable_history'); END;
CREATE TRIGGER boreal_immutable_boreal_assignment_event_update BEFORE UPDATE ON boreal_assignment_event
BEGIN SELECT RAISE(ABORT,'boreal_assignment_event_immutable_history'); END;
CREATE TRIGGER boreal_immutable_boreal_assignment_event_delete BEFORE DELETE ON boreal_assignment_event
BEGIN SELECT RAISE(ABORT,'boreal_assignment_event_immutable_history'); END;
CREATE TRIGGER boreal_immutable_boreal_legacy_sprint_cycle_update BEFORE UPDATE ON boreal_legacy_sprint_cycle
BEGIN SELECT RAISE(ABORT,'boreal_legacy_sprint_cycle_immutable_history'); END;
CREATE TRIGGER boreal_immutable_boreal_legacy_sprint_cycle_delete BEFORE DELETE ON boreal_legacy_sprint_cycle
BEGIN SELECT RAISE(ABORT,'boreal_legacy_sprint_cycle_immutable_history'); END;
CREATE TRIGGER boreal_immutable_cycle_template_v3_update BEFORE UPDATE ON cycle_template_v3
BEGIN SELECT RAISE(ABORT,'cycle_template_v3_immutable_history'); END;
CREATE TRIGGER boreal_immutable_cycle_template_v3_delete BEFORE DELETE ON cycle_template_v3
BEGIN SELECT RAISE(ABORT,'cycle_template_v3_immutable_history'); END;
CREATE TRIGGER boreal_immutable_cycle_template_weekday_v3_update BEFORE UPDATE ON cycle_template_weekday_v3
BEGIN SELECT RAISE(ABORT,'cycle_template_weekday_v3_immutable_history'); END;
CREATE TRIGGER boreal_immutable_cycle_template_weekday_v3_delete BEFORE DELETE ON cycle_template_weekday_v3
BEGIN SELECT RAISE(ABORT,'cycle_template_weekday_v3_immutable_history'); END;

-- Durable cited memory is distinct from accepted work and genuine Git publication.
CREATE TABLE boreal_memory_draft (
 project_id TEXT NOT NULL,draft_id TEXT NOT NULL,entry_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,
 citations_json TEXT NOT NULL CHECK(json_valid(citations_json)),content_digest TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES actor(actor_id),operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
 project_revision INTEGER NOT NULL CHECK(project_revision>0),created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,draft_id),FOREIGN KEY(project_id) REFERENCES project(project_id));
CREATE INDEX boreal_memory_draft_entry ON boreal_memory_draft(project_id,entry_id,project_revision);
CREATE TABLE boreal_memory_review (
 project_id TEXT NOT NULL,review_id TEXT NOT NULL,draft_id TEXT NOT NULL,content_digest TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN('approved','rejected','revoked')),reason TEXT NOT NULL CHECK(trim(reason)<>''),
 actor_id TEXT NOT NULL REFERENCES actor(actor_id),operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
 project_revision INTEGER NOT NULL CHECK(project_revision>0),created_at TEXT NOT NULL,
 PRIMARY KEY(project_id,review_id),FOREIGN KEY(project_id,draft_id) REFERENCES boreal_memory_draft(project_id,draft_id));
CREATE INDEX boreal_memory_review_current ON boreal_memory_review(project_id,draft_id,project_revision DESC);
CREATE TABLE boreal_memory_publication_intent (
 project_id TEXT NOT NULL,operation_id TEXT NOT NULL PRIMARY KEY REFERENCES operation(operation_id) DEFERRABLE INITIALLY DEFERRED,
 review_id TEXT NOT NULL,draft_id TEXT NOT NULL,content_digest TEXT NOT NULL,memory_root TEXT NOT NULL,
 expected_manifest_identity TEXT,planned_manifest_identity TEXT NOT NULL,publication_digest TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(project_id,review_id) REFERENCES boreal_memory_review(project_id,review_id),
 FOREIGN KEY(project_id,draft_id) REFERENCES boreal_memory_draft(project_id,draft_id));
CREATE TRIGGER boreal_memory_draft_no_update BEFORE UPDATE ON boreal_memory_draft
BEGIN SELECT RAISE(ABORT,'memory_history_is_immutable'); END;
CREATE TRIGGER boreal_memory_draft_no_delete BEFORE DELETE ON boreal_memory_draft
BEGIN SELECT RAISE(ABORT,'memory_history_is_immutable'); END;
CREATE TRIGGER boreal_memory_review_no_update BEFORE UPDATE ON boreal_memory_review
BEGIN SELECT RAISE(ABORT,'memory_history_is_immutable'); END;
CREATE TRIGGER boreal_memory_review_no_delete BEFORE DELETE ON boreal_memory_review
BEGIN SELECT RAISE(ABORT,'memory_history_is_immutable'); END;
CREATE TRIGGER boreal_memory_publication_intent_no_update BEFORE UPDATE ON boreal_memory_publication_intent
BEGIN SELECT RAISE(ABORT,'memory_history_is_immutable'); END;
CREATE TRIGGER boreal_memory_publication_intent_no_delete BEFORE DELETE ON boreal_memory_publication_intent
BEGIN SELECT RAISE(ABORT,'memory_history_is_immutable'); END;

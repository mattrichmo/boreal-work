-- Immutable project-scoped receipts for deliveries into mutable Intake.
-- This is an additive feature schema; it does not change work-model/3.
CREATE TABLE IF NOT EXISTS intake_delivery_v1 (
  project_id TEXT NOT NULL,
  delivery_key TEXT NOT NULL CHECK (trim(delivery_key) <> ''),
  intake_id TEXT NOT NULL CHECK (trim(intake_id) <> ''),
  origin_kind TEXT NOT NULL CHECK (trim(origin_kind) <> ''),
  origin_item_id TEXT NOT NULL CHECK (trim(origin_item_id) <> ''),
  origin_digest TEXT NOT NULL CHECK (trim(origin_digest) <> ''),
  payload_digest TEXT NOT NULL CHECK (trim(payload_digest) <> ''),
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, delivery_key),
  UNIQUE (project_id, intake_id),
  FOREIGN KEY (project_id, intake_id)
    REFERENCES intake_item_v3(project_id, intake_id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS intake_delivery_v1_no_update
BEFORE UPDATE ON intake_delivery_v1
BEGIN SELECT RAISE(ABORT, 'intake_delivery_receipts_are_immutable'); END;

CREATE TRIGGER IF NOT EXISTS intake_delivery_v1_no_delete
BEFORE DELETE ON intake_delivery_v1
BEGIN SELECT RAISE(ABORT, 'intake_delivery_receipts_are_immutable'); END;

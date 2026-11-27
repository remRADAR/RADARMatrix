PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS executions (
  execution_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_fingerprint TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CREATED','RESERVED','APPROVED','DISPATCHING','SUCCEEDED','FAILED','CANCELLED','UNCERTAIN')),
  version INTEGER NOT NULL CHECK (version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  provider_name TEXT,
  provider_request_id TEXT,
  UNIQUE (workspace_id, actor_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS executions_unresolved_idx
  ON executions (state, updated_at)
  WHERE state IN ('DISPATCHING','UNCERTAIN');

CREATE TABLE IF NOT EXISTS delegated_grants (
  grant_id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL,
  allowed_actions_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses >= 0),
  uses INTEGER NOT NULL CHECK (uses >= 0 AND (max_uses = 0 OR uses <= max_uses)),
  integrity_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','REVOKED'))
);

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL UNIQUE REFERENCES executions(execution_id),
  grant_id TEXT NOT NULL REFERENCES delegated_grants(grant_id),
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reserved_at TEXT NOT NULL,
  UNIQUE (execution_id, grant_id)
);

CREATE TABLE IF NOT EXISTS approval_claims (
  jti TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL UNIQUE REFERENCES executions(execution_id),
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_fingerprint TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dispatch_intents (
  execution_id TEXT PRIMARY KEY NOT NULL REFERENCES executions(execution_id),
  provider_name TEXT NOT NULL,
  provider_request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (provider_name, provider_request_id)
);

CREATE TABLE IF NOT EXISTS provider_outcomes (
  outcome_id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL REFERENCES executions(execution_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','CANCELLED','UNCERTAIN','CONFIRMED_SUCCEEDED','CONFIRMED_FAILED','STILL_PENDING','UNKNOWN','UNSUPPORTED','RECONCILIATION_CONFLICT')),
  provider_name TEXT NOT NULL,
  provider_request_id TEXT,
  observed_at TEXT NOT NULL,
  evidence_reference TEXT,
  evidence_digest TEXT,
  metadata_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_outcomes_execution_idx
  ON provider_outcomes (execution_id, observed_at);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  execution_id TEXT NOT NULL REFERENCES executions(execution_id),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  event_type TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE (execution_id, sequence)
);

CREATE INDEX IF NOT EXISTS audit_events_workspace_idx
  ON audit_events (workspace_id, occurred_at, event_id);

-- A false assertion deliberately violates CHECK and aborts the full batch.
-- Insert and delete these rows within the same D1 batch to enforce exact
-- affected-row counts inside the transaction, not after commit.
CREATE TABLE IF NOT EXISTS transaction_assertions (
  assertion_id TEXT PRIMARY KEY NOT NULL,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;

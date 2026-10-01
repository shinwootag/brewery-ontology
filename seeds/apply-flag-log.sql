-- apply-flag-log.sql
-- Installs the DATABASE half of FlagLog + Batch.flag, whose CODE half lives in
-- apps/ontology/src/actions/manufacturing/batchFlag.ts.
--
-- Idempotent: safe to run repeatedly (CREATE TABLE IF NOT EXISTS /
-- ON CONFLICT DO NOTHING).
--
-- Apply with:  pnpm run-sql seeds/apply-flag-log.sql
--
-- All ids and column names match seeds/04-manufacturing-with-monitoring.sql
-- (the canonical course definition) so this file and that seed converge on the
-- same rows rather than fighting each other.

-- ----------------------------------------------------------------------------
-- 1. FlagLog instance table.
--    A flag raised against a batch for human review. Deliberately independent
--    of batch.status — flagging records a concern, it does not halt the batch.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manufacturing.flag_log (
  id          TEXT PRIMARY KEY,
  batch_id    TEXT REFERENCES manufacturing.batch(id),
  reason      TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  flagged_by  TEXT,
  flagged_at  TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 2. object_type row.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.object_type
  (id, api_name, name, description, schema, datasource_table) VALUES
  ('5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'flagLog', 'Flag Log',
   'A flag raised against a batch for review', 'manufacturing', 'flag_log')
ON CONFLICT (api_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. property rows.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.property
  (id, object_type_id, api_name, name, data_type, required, is_title, is_primary_key, datasource_column) VALUES
  ('dc7aa125-907f-4843-b69d-f3479bfa25e9', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'id',         'ID',          'string',   true,  false, true,  'id'),
  ('1e218992-f914-4dc0-bf64-581270eee507', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'batchId',    'Batch',       'string',   true,  false, false, 'batch_id'),
  ('3ad5d7b9-a8fb-4f65-8f31-5cc38bc984b4', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'reason',     'Reason',      'string',   true,  true,  false, 'reason'),
  ('1a70a905-b82c-4fe1-b1b7-91952491cdea', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'severity',   'Severity',    'enum',     true,  false, false, 'severity'),
  ('5cb2e342-d499-4799-81a7-444497a098a5', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'status',     'Status',      'enum',     true,  false, false, 'status'),
  ('f3ec4f53-aace-4f50-95c4-d2f4abf3f3e3', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'flaggedBy',  'Flagged By',  'string',   false, false, false, 'flagged_by'),
  ('ae0f0ecd-2dd8-48ba-8111-222aed7c4869', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'flaggedAt',  'Flagged At',  'datetime', false, false, false, 'flagged_at'),
  ('fb08d72a-9b34-4cca-a013-8091a60e720a', '5edb54df-b9ab-43e3-82c3-c3c94ac68276', 'resolvedAt', 'Resolved At', 'datetime', false, false, false, 'resolved_at')
ON CONFLICT (object_type_id, api_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. link row: FlagLog -> Batch (via the batchId property), inverse flagLogs.
--    The link table has no natural unique key beyond id, so the guard is a
--    bare ON CONFLICT DO NOTHING on the primary key.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.link
  (id, api_name, name, inverse_api_name, inverse_name, source_type_id, target_type_id, via_property_id, cardinality) VALUES
  ('648788da-2412-4561-8630-ae95e59c0910', 'batch', 'Batch', 'flagLogs', 'Flag Logs',
   '5edb54df-b9ab-43e3-82c3-c3c94ac68276',   -- source: flagLog
   '5dfc3a86-5d86-432d-8beb-d1f22cb8def6',   -- target: batch
   '1e218992-f914-4dc0-bf64-581270eee507',   -- via:    flagLog.batchId
   'many_to_one')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. action_type row for Batch.flag (handler: batchFlag.ts).
--    object_type_id resolved by api_name so it works regardless of the batch
--    type's UUID in this database.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.action_type
  (id, object_type_id, api_name, name, description, parameter_schema)
SELECT
  '558a18d0-7978-4508-b960-791177c29f83',
  ot.id,
  'flag',
  'Flag Batch',
  'Raise an open flag against the batch for review; does not change batch status',
  '{"type":"object","properties":{"reason":{"type":"string"},"severity":{"type":"string","enum":["low","medium","high"]}},"required":["reason","severity"]}'
FROM manufacturing.object_type ot
WHERE ot.api_name = 'batch'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

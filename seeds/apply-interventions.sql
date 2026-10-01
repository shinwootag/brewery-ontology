-- apply-interventions.sql
-- Installs the METADATA half of the three fermentation intervention actions,
-- whose handlers live in apps/ontology/src/actions/manufacturing/:
--   batchPlaceOnHold.ts, batchExtendRest.ts, batchScheduleEarlyTransfer.ts
--
-- Idempotent: safe to run repeatedly (ON CONFLICT DO NOTHING).
--
-- Apply with:  pnpm run-sql seeds/apply-interventions.sql
--
-- No DDL here: all three actions write to columns that already exist on
-- manufacturing.batch (status, planned_transfer_at).
--
-- Ids, names, descriptions and parameter_schemas match
-- seeds/04-manufacturing-with-monitoring.sql (the canonical course definition)
-- so this file and that seed converge on identical rows.
--
-- object_type_id is resolved by api_name so this works regardless of the batch
-- type's UUID in this database.

-- ----------------------------------------------------------------------------
-- Batch.placeOnHold — halt a fermenting/conditioning batch, keep its schedule.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.action_type
  (id, object_type_id, api_name, name, description, parameter_schema)
SELECT
  '1b1221e9-20f8-4077-89a6-27ca7fd2f62a',
  ot.id,
  'placeOnHold',
  'Place On Hold',
  'Place a fermenting or conditioning batch on hold, recording the reason. Does not change the planned transfer.',
  '{"type":"object","properties":{"reason":{"type":"string"}},"required":["reason"]}'
FROM manufacturing.object_type ot
WHERE ot.api_name = 'batch'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Batch.extendRest — more time in the current vessel. This batch only.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.action_type
  (id, object_type_id, api_name, name, description, parameter_schema)
SELECT
  '7d4f2e0a-8e91-4fe2-87aa-c985c20dfe17',
  ot.id,
  'extendRest',
  'Extend Rest',
  'Push this batch''s planned transfer later by a number of days, giving it more time in its current vessel. Affects only this batch; does not cascade to other batches.',
  '{"type":"object","properties":{"additionalDays":{"type":"integer","minimum":1}},"required":["additionalDays"]}'
FROM manufacturing.object_type ot
WHERE ot.api_name = 'batch'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Batch.scheduleEarlyTransfer — advance the transfer. Does NOT check or reserve
-- a destination vessel; the description says so explicitly so that neither an
-- agent reading the metadata nor a reviewer reads success as availability.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.action_type
  (id, object_type_id, api_name, name, description, parameter_schema)
SELECT
  '38125492-93ac-4d6f-8bc1-f793d298c119',
  ot.id,
  'scheduleEarlyTransfer',
  'Schedule Early Transfer',
  'Move this batch''s planned transfer earlier, advancing it toward the next stage ahead of schedule. Rewrites only this batch''s planned transfer date; does not check or reserve a destination vessel.',
  '{"type":"object","properties":{"plannedAt":{"type":"string","format":"date-time"}},"required":["plannedAt"]}'
FROM manufacturing.object_type ot
WHERE ot.api_name = 'batch'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

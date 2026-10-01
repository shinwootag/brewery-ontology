-- apply-escalate.sql
-- Adds the `escalated` proposal status and the Proposal.escalate action,
-- whose handler lives in apps/ontology/src/actions/shared/proposalEscalate.ts.
--
-- Idempotent: safe to run repeatedly (DROP CONSTRAINT IF EXISTS before the
-- re-ADD; ON CONFLICT DO NOTHING on the metadata row).
--
-- Apply with:  pnpm run-sql seeds/apply-escalate.sql
--
-- Ids, names, descriptions and parameter_schema match
-- seeds/04-manufacturing-with-monitoring.sql (the canonical course definition).

-- ----------------------------------------------------------------------------
-- 1. Widen the status CHECK constraint to admit 'escalated'.
--    seeds/apply-proposal.sql creates the table with a three-value CHECK, so
--    the constraint must be replaced rather than added. Dropping and re-adding
--    is safe: the new set is a strict superset, so no existing row can violate
--    it, and the whole file runs in one transaction.
-- ----------------------------------------------------------------------------
ALTER TABLE manufacturing.proposal
  DROP CONSTRAINT IF EXISTS proposal_status_check;

ALTER TABLE manufacturing.proposal
  ADD CONSTRAINT proposal_status_check
  CHECK (status IN ('pending','approved','rejected','escalated'));

-- ----------------------------------------------------------------------------
-- 2. action_type row for Proposal.escalate.
--    object_type_id resolved by api_name so it works regardless of the proposal
--    type's UUID in this database.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.action_type
  (id, object_type_id, api_name, name, description, parameter_schema)
SELECT
  '4c2a39cc-82ac-4e15-b59f-8601bb0d1f52',
  ot.id,
  'escalate',
  'Escalate Proposal',
  'Escalate a pending proposal for human resolution without approving or rejecting it; records a note explaining the unresolved concern. The proposal stays open and can still be approved or rejected later.',
  '{"type":"object","properties":{"note":{"type":"string"}},"required":["note"]}'
FROM manufacturing.object_type ot
WHERE ot.api_name = 'proposal'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

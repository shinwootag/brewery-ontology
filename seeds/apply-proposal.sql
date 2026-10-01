-- apply-proposal.sql
-- Installs the DATABASE half of the human-in-the-loop proposal gate whose
-- CODE half already exists (apps/ontology/src/actions/shared/proposalApprove.ts,
-- proposalReject.ts, the generic create route, and the propose_* agent tools).
--
-- Idempotent: safe to run repeatedly (CREATE TABLE IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING).
--
-- Apply with:  pnpm run-sql seeds/apply-proposal.sql
--
-- Column names below match EXACTLY what the handlers and create route
-- read/write:
--   proposalApprove/proposalReject  -> id, status, reviewed_by, reviewed_at,
--                                       decision_note, type, target_id, params
--   generic create route (POST /:type) inserts, via property metadata columns:
--                                       type, target_id, params, rationale,
--                                       status, proposed_by, proposed_at
--   inner action + decision audit writes -> audit_log.authorized_by_proposal
-- (No target_type column: nothing in the code reads or writes one.)

-- ----------------------------------------------------------------------------
-- 0. audit_log needs authorized_by_proposal — the proposalApprove/Reject and the
--    proposal-triggered action handlers write it. Without it those writes fail.
-- ----------------------------------------------------------------------------
ALTER TABLE manufacturing.audit_log
  ADD COLUMN IF NOT EXISTS authorized_by_proposal TEXT;

-- ----------------------------------------------------------------------------
-- 1. Proposal instance table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manufacturing.proposal (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type          TEXT NOT NULL,                        -- handler key, e.g. 'batch.cancel'
  target_id     TEXT NOT NULL,                        -- domain id of the target instance
  params        JSONB NOT NULL,                       -- action-specific params only
  rationale     TEXT NOT NULL,                        -- the agent's case for the proposal
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  proposed_by   TEXT NOT NULL,
  proposed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  decision_note TEXT
);

-- ----------------------------------------------------------------------------
-- 2. object_type + property metadata rows for Proposal.
--    UUIDs match seeds/03-manufacturing-with-proposals.sql (canonical ids).
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.object_type
  (id, api_name, name, description, schema, datasource_table) VALUES
  ('2ee159a5-4192-4020-8d54-27447f4997a0', 'proposal', 'Proposal',
   'An agent-proposed action awaiting human review', 'manufacturing', 'proposal')
ON CONFLICT (api_name) DO NOTHING;

INSERT INTO manufacturing.property
  (id, object_type_id, api_name, name, data_type, required, is_title, is_primary_key, datasource_column) VALUES
  ('a09693de-b916-4726-8e93-0fa954235750', '2ee159a5-4192-4020-8d54-27447f4997a0', 'id',           'ID',            'string',   true,  false, true,  'id'),
  ('ed7222ec-45a0-4149-a810-67ffc3dfb3f3', '2ee159a5-4192-4020-8d54-27447f4997a0', 'type',         'Action Type',   'string',   true,  true,  false, 'type'),
  ('59e1d341-11df-40d3-bb69-40f366c10a1c', '2ee159a5-4192-4020-8d54-27447f4997a0', 'targetId',     'Target ID',     'string',   true,  false, false, 'target_id'),
  ('fb192996-d7b7-4e03-8933-92bc1c975d11', '2ee159a5-4192-4020-8d54-27447f4997a0', 'params',       'Parameters',    'json',     true,  false, false, 'params'),
  ('063c7cdc-d49a-4518-bfda-68303628b7d4', '2ee159a5-4192-4020-8d54-27447f4997a0', 'rationale',    'Rationale',     'string',   true,  false, false, 'rationale'),
  ('0bc6e3ee-d31f-42db-a710-48f6051d2643', '2ee159a5-4192-4020-8d54-27447f4997a0', 'status',       'Status',        'enum',     true,  false, false, 'status'),
  ('848261bc-dcc2-4c70-8f4a-821e72b3ba6c', '2ee159a5-4192-4020-8d54-27447f4997a0', 'proposedBy',   'Proposed By',   'string',   true,  false, false, 'proposed_by'),
  ('166116bf-f211-4883-83f3-3f67e9665477', '2ee159a5-4192-4020-8d54-27447f4997a0', 'proposedAt',   'Proposed At',   'datetime', true,  false, false, 'proposed_at'),
  ('066e0cbf-af8c-42ad-94eb-128a10d46564', '2ee159a5-4192-4020-8d54-27447f4997a0', 'reviewedBy',   'Reviewed By',   'string',   false, false, false, 'reviewed_by'),
  ('7ccb8a20-fdfa-433e-80a0-cf6cf7936855', '2ee159a5-4192-4020-8d54-27447f4997a0', 'reviewedAt',   'Reviewed At',   'datetime', false, false, false, 'reviewed_at'),
  ('cf3421d1-1e1b-47a9-bfca-2f950040156f', '2ee159a5-4192-4020-8d54-27447f4997a0', 'decisionNote', 'Decision Note', 'string',   false, false, false, 'decision_note')
ON CONFLICT (object_type_id, api_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. action_type rows for Proposal.approve and Proposal.reject.
--    parameter_schema matches the handlers' params (optional decisionNote).
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.action_type
  (id, object_type_id, api_name, name, description, parameter_schema) VALUES
  ('eabefec8-6192-409f-9d2d-ff52dfaaf6a9', '2ee159a5-4192-4020-8d54-27447f4997a0', 'approve', 'Approve Proposal',
   'Approve a pending proposal and invoke its underlying action',
   '{"type":"object","properties":{"decisionNote":{"type":"string"}}}'),
  ('47500da2-2795-4d61-92dc-9672159feb19', '2ee159a5-4192-4020-8d54-27447f4997a0', 'reject',  'Reject Proposal',
   'Reject a pending proposal without invoking its underlying action',
   '{"type":"object","properties":{"decisionNote":{"type":"string"}}}')
ON CONFLICT (object_type_id, api_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. action_type row for Batch.cancel (handler: batchCancel.ts).
--    parameter_schema matches the handler's params (required reason: string).
--    object_type_id resolved by api_name so it works regardless of the batch
--    type's UUID in this database.
-- ----------------------------------------------------------------------------
INSERT INTO manufacturing.action_type
  (id, object_type_id, api_name, name, description, parameter_schema)
SELECT
  'a1d4c0f2-7b3e-4e91-9c2a-2f6b8d5e0a17',
  ot.id,
  'cancel',
  'Cancel Batch',
  'Cancel a queued or fermenting batch, recording the reason',
  '{"type":"object","properties":{"reason":{"type":"string"}},"required":["reason"]}'
FROM manufacturing.object_type ot
WHERE ot.api_name = 'batch'
ON CONFLICT (object_type_id, api_name) DO NOTHING;

import type { Generated } from "kysely";

// ============================================================
// Metadata tables (schema-agnostic — use with db.withSchema())
// ============================================================

export interface ObjectTypeTable {
  id: Generated<string>;
  api_name: string;
  name: string;
  description: string | null;
  status: Generated<string>;
  visibility: Generated<string>;
  point_of_contact: string | null;
  edits_enabled: Generated<boolean>;
  schema: string;
  datasource_table: string;
}

export interface PropertyTable {
  id: Generated<string>;
  api_name: string;
  name: string;
  object_type_id: string;
  data_type: string;
  required: Generated<boolean>;
  is_title: Generated<boolean>;
  is_primary_key: Generated<boolean>;
  datasource_column: string;
}

export interface LinkTable {
  id: Generated<string>;
  api_name: string;
  name: string;
  inverse_api_name: string;
  inverse_name: string;
  source_type_id: string;
  target_type_id: string;
  via_property_id: string;
  cardinality: string;
}

export interface ActionTypeTable {
  id: Generated<string>;
  api_name: string;
  name: string;
  object_type_id: string;
  description: string | null;
  parameter_schema: unknown;
}

export interface AuditLogTable {
  id: Generated<string>;
  action_type_id: string;
  action_api_name: string;
  target_type_id: string;
  target_type_api_name: string;
  target_id: string;
  actor: string;
  params: unknown;
  result: unknown;
  /** Proposal id when this action was authorized via an approved proposal. */
  authorized_by_proposal: string | null;
  created_at: Generated<Date>;
}

// ============================================================
// Instance tables (schema-prefixed)
// ============================================================

export interface ManufacturingTankTable {
  id: string;
  name: string;
  capacity: string;
  status: string;
  current_temperature: string | null;
  commissioned_at: Date;
}

export interface ManufacturingLineTable {
  id: string;
  name: string;
  status: string;
  commissioned_at: Date;
}

export interface ManufacturingOperatorTable {
  id: string;
  name: string;
  certifications: string[] | null;
  shift: string;
}

export interface ManufacturingRecipeTable {
  id: string;
  name: string;
  target_sugar_curve: unknown;
  fermentation_days: number;
  required_ingredients: string[] | null;
  notes: string | null;
}

export interface ManufacturingBatchTable {
  id: string;
  recipe_id: string;
  target_volume: string | null;
  status: string;
  planned_start: Date | null;
  current_sugar_level: string | null;
  current_temperature: string | null;
  days_fermenting: number | null;
  assigned_tank_id: string | null;
  assigned_operator_id: string | null;
  last_operator_note: string | null;
}

export interface ManufacturingBottlingRunTable {
  id: string;
  batch_id: string;
  line_id: string;
  planned_start: Date | null;
  status: string;
  assigned_operator_id: string | null;
}

export interface ManufacturingMaintenanceLogTable {
  id: string;
  target_type: string;
  target_id: string;
  type: string;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  notes: string | null;
}

export interface ManufacturingQualityTestTable {
  id: string;
  batch_id: string;
  test_date: Date;
  ph: string | null;
  sugar_level: string | null;
  notes: string | null;
  tested_by: string | null;
}

export interface ManufacturingFlagLogTable {
  id: string;
  batch_id: string;
  reason: string;
  severity: string;
  status: Generated<string>;
  flagged_by: string | null;
  flagged_at: Date | null;
  resolved_at: Date | null;
}

export interface ManufacturingProposalTable {
  id: Generated<number>;
  type: string;
  target_id: string;
  params: unknown;
  rationale: string;
  status: Generated<string>;
  proposed_by: string;
  proposed_at: Generated<Date>;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  decision_note: string | null;
}

// ============================================================
// Combined DB interface
// ============================================================

export interface DB {
  // Metadata (schema-agnostic)
  object_type: ObjectTypeTable;
  property: PropertyTable;
  link: LinkTable;
  action_type: ActionTypeTable;
  audit_log: AuditLogTable;

  // Manufacturing instance tables
  "manufacturing.tank": ManufacturingTankTable;
  "manufacturing.line": ManufacturingLineTable;
  "manufacturing.operator": ManufacturingOperatorTable;
  "manufacturing.recipe": ManufacturingRecipeTable;
  "manufacturing.batch": ManufacturingBatchTable;
  "manufacturing.bottling_run": ManufacturingBottlingRunTable;
  "manufacturing.maintenance_log": ManufacturingMaintenanceLogTable;
  "manufacturing.quality_test": ManufacturingQualityTestTable;
  "manufacturing.flag_log": ManufacturingFlagLogTable;
  "manufacturing.proposal": ManufacturingProposalTable;
}

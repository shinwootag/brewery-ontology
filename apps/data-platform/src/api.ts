const META = "/api/objects/meta";
const OBJ = "/api/objects";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ObjectType {
  id: string;
  api_name: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  point_of_contact: string | null;
  edits_enabled: boolean;
  schema: string;
  datasource_table: string;
  instance_count: number;
}

export interface Property {
  id: string;
  api_name: string;
  name: string;
  object_type_id: string;
  data_type: string;
  required: boolean;
  is_title: boolean;
  is_primary_key: boolean;
  datasource_column: string;
}

export interface Link {
  id: string;
  api_name: string;
  name: string;
  inverse_api_name: string;
  inverse_name: string;
  source_type_id: string;
  target_type_id: string;
  via_property_id: string;
  cardinality: string;
}

export interface ActionType {
  id: string;
  api_name: string;
  name: string;
  object_type_id: string;
  description: string | null;
  parameter_schema: unknown;
}

export interface TypeBundle {
  objectType: ObjectType;
  properties: Property[];
  outgoingLinks: Link[];
  incomingLinks: Link[];
  actions: ActionType[];
}

/* ------------------------------------------------------------------ */
/*  Fetchers                                                           */
/* ------------------------------------------------------------------ */

export async function fetchTypes(): Promise<ObjectType[]> {
  const res = await fetch(`${META}/types`);
  if (!res.ok) throw new Error("Failed to fetch types");
  return res.json();
}

export async function fetchTypeBundle(apiName: string): Promise<TypeBundle> {
  const res = await fetch(`${META}/types/${apiName}`);
  if (!res.ok) throw new Error(`Failed to fetch type ${apiName}`);
  return res.json();
}

export async function patchType(
  apiName: string,
  updates: { name?: string; description?: string | null },
): Promise<ObjectType> {
  const res = await fetch(`${META}/types/${apiName}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update type");
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Instance data                                                      */
/* ------------------------------------------------------------------ */

export async function fetchInstances(
  typeApiName: string,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${OBJ}/${typeApiName}`);
  if (!res.ok) throw new Error("Failed to fetch instances");
  return res.json();
}

export async function fetchInstance(
  typeApiName: string,
  id: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${OBJ}/${typeApiName}/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error("Failed to fetch instance");
  return res.json();
}

export interface AuditEntry {
  id: string;
  action: string;
  actionApiName: string;
  actor: string;
  params: unknown;
  result: unknown;
  timestamp: string;
}

export async function fetchAudit(
  typeApiName: string,
  id: string,
): Promise<AuditEntry[]> {
  const res = await fetch(
    `${OBJ}/${typeApiName}/${encodeURIComponent(id)}/audit`,
  );
  if (!res.ok) throw new Error("Failed to fetch audit log");
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Actions                                                            */
/* ------------------------------------------------------------------ */

export async function postAction(
  typeApiName: string,
  instanceId: string,
  actionApiName: string,
  params: Record<string, unknown>,
  options?: { callerIdentity?: string },
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options?.callerIdentity) {
    headers["x-caller-identity"] = options.callerIdentity;
  }
  const res = await fetch(
    `${OBJ}/${typeApiName}/${encodeURIComponent(instanceId)}/actions/${actionApiName}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error ?? "Action failed");
  }
  return body;
}

/* ------------------------------------------------------------------ */
/*  Proposals                                                          */
/* ------------------------------------------------------------------ */

export interface Proposal {
  id: number;
  type: string;
  target_id: string;
  params: Record<string, unknown> | null;
  rationale: string;
  status: string;
  proposed_by: string;
  proposed_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
}

/** Fetch all proposals (the queue filters to pending client-side). */
export async function fetchProposals(): Promise<Proposal[]> {
  const res = await fetch(`${OBJ}/proposal`);
  if (!res.ok) throw new Error("Failed to fetch proposals");
  return res.json();
}

/**
 * Approve or reject a proposal by invoking its action on the invoke route,
 * stamped with the reviewer's identity. Throws Error(message) on failure.
 */
export async function decideProposal(
  proposalId: number,
  decision: "approve" | "reject",
  callerIdentity: string,
): Promise<Record<string, unknown>> {
  return postAction("proposal", String(proposalId), decision, {}, {
    callerIdentity,
  });
}

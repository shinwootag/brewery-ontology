import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";
import { ESCALATABLE_STATUSES, describeStatuses } from "./proposalStatus.ts";

/** Keep in sync with the action_type.parameter_schema metadata row. */
interface EscalateParams {
  note: string;
}

interface ProposalInstance {
  id: number | string;
  status: string;
  [key: string]: unknown;
}

/**
 * Proposal.escalate — schema-generic. Parks a proposal for a human to resolve,
 * recording a note explaining the unresolved concern, WITHOUT invoking the
 * underlying action.
 *
 * Escalation is not a decision: the proposal stays open and can still be
 * approved or rejected afterwards (see DECIDABLE_STATUSES). It records who
 * escalated and why in reviewed_by/reviewed_at/decision_note; a later
 * approve/reject overwrites those with the final decision, while the audit_log
 * keeps the escalation permanently.
 */
export const proposalEscalate: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const proposal = instance as unknown as ProposalInstance;
  const { note } = params as unknown as EscalateParams;
  const { schema } = context.objectType;
  const escalatedBy = context.callerIdentity ?? "system";
  const proposalId = String(proposal.id);

  // Business validation
  if (!ESCALATABLE_STATUSES.has(proposal.status)) {
    throw new Error(
      `Cannot escalate: proposal status is "${proposal.status}", must be ${describeStatuses(ESCALATABLE_STATUSES)}`,
    );
  }
  if (typeof note !== "string" || note.trim() === "") {
    throw new Error("note is required");
  }

  // Pinned server clock (anchored to COURSE_NOW).
  const escalatedAt = new Date().toISOString();

  const updated = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "proposal")}
      SET ${sql.id("status")} = ${"escalated"},
          ${sql.id("reviewed_by")} = ${escalatedBy},
          ${sql.id("reviewed_at")} = ${escalatedAt},
          ${sql.id("decision_note")} = ${note}
      WHERE ${sql.id("id")} = ${proposal.id}
    `.execute(trx);

    const { rows } = await sql`
      SELECT * FROM ${sql.id(schema, "proposal")}
      WHERE ${sql.id("id")} = ${proposal.id}
    `.execute(trx);
    const updatedProposal = rows[0] as Record<string, unknown>;

    await trx
      .withSchema(schema)
      .insertInto("audit_log")
      .values({
        action_type_id: context.actionType.id,
        action_api_name: context.actionType.api_name,
        target_type_id: context.objectType.id,
        target_type_api_name: context.objectType.api_name,
        target_id: proposalId,
        actor: escalatedBy,
        params: JSON.stringify(params),
        result: JSON.stringify({ status: "escalated" }),
        // Escalation authorizes nothing — no underlying action runs.
        authorized_by_proposal: null,
      })
      .execute();

    return updatedProposal;
  });

  return { ...updated, status: "escalated" };
};

import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";
import { DECIDABLE_STATUSES, describeStatuses } from "./proposalStatus.ts";

interface RejectParams {
  decisionNote?: string;
}

interface ProposalInstance {
  id: number | string;
  status: string;
  [key: string]: unknown;
}

/**
 * Proposal.reject — schema-generic. Validates the proposal is still decidable
 * (pending, or escalated and awaiting human resolution), records
 * the reviewer and decision, and marks it rejected WITHOUT invoking the
 * underlying action.
 */
export const proposalReject: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const proposal = instance as unknown as ProposalInstance;
  const { decisionNote } = params as unknown as RejectParams;
  const { schema } = context.objectType;
  const reviewer = context.callerIdentity ?? "system";
  const proposalId = String(proposal.id);

  // Business validation
  if (!DECIDABLE_STATUSES.has(proposal.status)) {
    throw new Error(
      `Cannot reject: proposal status is "${proposal.status}", must be ${describeStatuses(DECIDABLE_STATUSES)}`,
    );
  }

  // Pinned server clock (anchored to COURSE_NOW).
  const reviewedAt = new Date().toISOString();

  const updated = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "proposal")}
      SET ${sql.id("status")} = ${"rejected"},
          ${sql.id("reviewed_by")} = ${reviewer},
          ${sql.id("reviewed_at")} = ${reviewedAt},
          ${sql.id("decision_note")} = ${decisionNote ?? null}
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
        actor: reviewer,
        params: JSON.stringify(params),
        result: JSON.stringify({ status: "rejected" }),
        authorized_by_proposal: null,
      })
      .execute();

    return updatedProposal;
  });

  return { ...updated, status: "rejected" };
};

import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";
import { invokeAction } from "./invokeAction.ts";
import { DECIDABLE_STATUSES, describeStatuses } from "./proposalStatus.ts";

interface ApproveParams {
  decisionNote?: string;
}

interface ProposalInstance {
  id: number | string;
  type: string;
  target_id: string;
  params: Record<string, unknown> | null;
  status: string;
  [key: string]: unknown;
}

/**
 * Proposal.approve — schema-generic. Validates the proposal is still decidable
 * (pending, or escalated and awaiting human resolution), invokes
 * the underlying action it stands for (case-sensitive `type`, e.g. "batch.cancel")
 * on its `target_id` with the stored `params`, threading the approving user and
 * the proposal id into the inner action's context. Only if that inner action
 * succeeds does the proposal flip to approved and an approve audit row persist —
 * so a failing inner action leaves the proposal pending with no approve audit.
 */
export const proposalApprove: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const proposal = instance as unknown as ProposalInstance;
  const { decisionNote } = params as unknown as ApproveParams;
  const { schema } = context.objectType;
  const reviewer = context.callerIdentity ?? "system";
  const proposalId = String(proposal.id);

  // Business validation
  if (!DECIDABLE_STATUSES.has(proposal.status)) {
    throw new Error(
      `Cannot approve: proposal status is "${proposal.status}", must be ${describeStatuses(DECIDABLE_STATUSES)}`,
    );
  }

  // Pinned server clock (anchored to COURSE_NOW).
  const reviewedAt = new Date().toISOString();

  // 1. Invoke the underlying action FIRST. If it throws, we never touch the
  //    proposal and never write an approve audit row — approval stays atomic.
  //    The inner handler records the approving user as actor and stamps
  //    authorized_by_proposal with this proposal id.
  const triggeredResult = await invokeAction(
    proposal.type,
    proposal.target_id,
    (proposal.params ?? {}) as Record<string, unknown>,
    { callerIdentity: reviewer, authorizedByProposal: proposalId },
  );

  // 2. Inner action committed — mark the proposal approved and audit the decision.
  const decision = {
    status: "approved" as const,
    triggeredAction: proposal.type,
    triggeredTargetId: proposal.target_id,
    triggeredResult,
  };

  const updated = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "proposal")}
      SET ${sql.id("status")} = ${"approved"},
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

    // Audit the approve decision itself. authorized_by_proposal stays null here:
    // this row IS the authorization, not an action authorized by one.
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
        result: JSON.stringify(decision),
        authorized_by_proposal: null,
      })
      .execute();

    return updatedProposal;
  });

  return { ...updated, ...decision };
};

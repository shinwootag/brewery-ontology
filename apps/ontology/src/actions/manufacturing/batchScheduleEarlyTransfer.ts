import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";

/** Keep in sync with the action_type.parameter_schema metadata row. */
interface ScheduleEarlyTransferParams {
  plannedAt: string;
}

interface BatchInstance {
  id: string;
  status: string;
  planned_transfer_at: string | Date | null;
  [key: string]: unknown;
}

/**
 * Batch.scheduleEarlyTransfer — move this batch's transfer earlier, advancing
 * it toward the next stage ahead of schedule.
 *
 * IMPORTANT: this rewrites planned_transfer_at and nothing else. It does NOT
 * check that a destination vessel is free at the new time, does not reserve
 * one, and does not reschedule whatever currently occupies it. Callers must not
 * treat a successful call as confirmation that the earlier slot is available.
 */
export const batchScheduleEarlyTransfer: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const batch = instance as unknown as BatchInstance;
  const { plannedAt } = params as unknown as ScheduleEarlyTransferParams;
  const { schema } = context.objectType;

  // Defensive checks that mirror the JSON Schema.
  const newDate = new Date(plannedAt);
  if (Number.isNaN(newDate.getTime())) {
    throw new Error("plannedAt must be a valid date-time");
  }
  if (batch.status === "cancelled") {
    throw new Error(
      `Cannot schedule early transfer: batch status is "${batch.status}"`,
    );
  }
  if (newDate.getTime() <= Date.now()) {
    throw new Error("plannedAt must be in the future");
  }
  if (batch.planned_transfer_at == null) {
    throw new Error(
      `Cannot schedule early transfer: batch ${batch.id} has no planned transfer to move`,
    );
  }

  const current = new Date(batch.planned_transfer_at);
  if (Number.isNaN(current.getTime())) {
    throw new Error(
      `Cannot schedule early transfer: batch ${batch.id} has an unreadable planned transfer date`,
    );
  }
  // "Early" is the whole point of the action — pushing the date later is
  // extendRest's job, and silently accepting it here would misreport intent.
  if (newDate.getTime() >= current.getTime()) {
    throw new Error(
      `plannedAt must be earlier than the current planned transfer (${current.toISOString()})`,
    );
  }

  // Single transaction: move the transfer earlier + audit. No vessel check —
  // see the note above; availability is not this action's concern.
  const updatedBatch = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "batch")}
      SET ${sql.id("planned_transfer_at")} = ${plannedAt}
      WHERE ${sql.id("id")} = ${batch.id}
    `.execute(trx);

    const { rows } = await sql`
      SELECT * FROM ${sql.id(schema, "batch")}
      WHERE ${sql.id("id")} = ${batch.id}
    `.execute(trx);

    const updated = rows[0] as Record<string, unknown>;

    await trx
      .withSchema(schema)
      .insertInto("audit_log")
      .values({
        action_type_id: context.actionType.id,
        action_api_name: context.actionType.api_name,
        target_type_id: context.objectType.id,
        target_type_api_name: context.objectType.api_name,
        target_id: batch.id,
        actor: context.callerIdentity ?? "system",
        params: JSON.stringify(params),
        result: JSON.stringify(updated),
        authorized_by_proposal: context.authorizedByProposal ?? null,
      })
      .execute();

    return updated;
  });

  return updatedBatch;
};

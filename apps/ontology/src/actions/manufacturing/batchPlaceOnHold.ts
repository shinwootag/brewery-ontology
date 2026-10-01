import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";

/** Keep in sync with the action_type.parameter_schema metadata row. */
interface PlaceOnHoldParams {
  reason: string;
}

interface BatchInstance {
  id: string;
  status: string;
  [key: string]: unknown;
}

const HOLDABLE_STATUSES = new Set(["fermenting", "conditioning"]);

/**
 * Batch.placeOnHold — halt a fermenting or conditioning batch.
 *
 * Sets status to `onHold` and records the reason. Deliberately leaves
 * planned_transfer_at untouched: putting a batch on hold stops the run, it does
 * not reschedule it. Rescheduling is extendRest/scheduleEarlyTransfer's job.
 */
export const batchPlaceOnHold: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const batch = instance as unknown as BatchInstance;
  const { reason } = params as unknown as PlaceOnHoldParams;
  const { schema } = context.objectType;

  if (!HOLDABLE_STATUSES.has(batch.status)) {
    throw new Error(
      `Cannot place on hold: batch status is "${batch.status}", must be "fermenting" or "conditioning"`,
    );
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("reason is required");
  }

  // Single transaction: status change + audit. No planned_transfer_at write.
  const updatedBatch = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "batch")}
      SET ${sql.id("status")} = ${"onHold"}
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

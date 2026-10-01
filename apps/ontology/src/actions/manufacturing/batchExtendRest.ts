import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";

/** Keep in sync with the action_type.parameter_schema metadata row. */
interface ExtendRestParams {
  additionalDays: number;
}

interface BatchInstance {
  id: string;
  status: string;
  planned_transfer_at: string | Date | null;
  [key: string]: unknown;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Batch.extendRest — give this batch more time in its current vessel by pushing
 * its planned transfer later.
 *
 * Scope is deliberately narrow: it rewrites planned_transfer_at on THIS batch
 * only. It does not cascade to batches queued behind it and does not touch the
 * tank they are waiting on — any knock-on scheduling is a separate decision.
 */
export const batchExtendRest: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const batch = instance as unknown as BatchInstance;
  const { additionalDays } = params as unknown as ExtendRestParams;
  const { schema } = context.objectType;

  // Defensive checks that mirror the JSON Schema.
  if (!Number.isInteger(additionalDays) || additionalDays < 1) {
    throw new Error("additionalDays must be an integer of at least 1");
  }
  if (batch.status === "cancelled") {
    throw new Error(
      `Cannot extend rest: batch status is "${batch.status}"`,
    );
  }
  if (batch.planned_transfer_at == null) {
    throw new Error(
      `Cannot extend rest: batch ${batch.id} has no planned transfer to push back`,
    );
  }

  const current = new Date(batch.planned_transfer_at);
  if (Number.isNaN(current.getTime())) {
    throw new Error(
      `Cannot extend rest: batch ${batch.id} has an unreadable planned transfer date`,
    );
  }
  const newTransferAt = new Date(
    current.getTime() + additionalDays * MS_PER_DAY,
  ).toISOString();

  // Single transaction: push the transfer + audit.
  const updatedBatch = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "batch")}
      SET ${sql.id("planned_transfer_at")} = ${newTransferAt}
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

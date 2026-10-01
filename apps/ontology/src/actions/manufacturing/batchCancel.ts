import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";

interface CancelParams {
  reason: string;
}

interface BatchInstance {
  id: string;
  status: string;
  [key: string]: unknown;
}

const CANCELLABLE_STATUSES = new Set(["queued", "fermenting"]);

export const batchCancel: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const batch = instance as unknown as BatchInstance;
  const { reason } = params as unknown as CancelParams;
  const { schema } = context.objectType;

  // Business validation
  if (!CANCELLABLE_STATUSES.has(batch.status)) {
    throw new Error(
      `Cannot cancel: batch status is "${batch.status}", must be "queued" or "fermenting"`,
    );
  }

  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("reason is required");
  }

  // Single transaction: update batch + write audit log capturing the reason
  const updatedBatch = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "batch")}
      SET ${sql.id("status")} = ${"cancelled"}
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

import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";

interface DeferStartParams {
  newPlannedStart: string;
}

interface BatchInstance {
  id: string;
  status: string;
  planned_start: string | null;
  [key: string]: unknown;
}

export const batchDeferStart: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const batch = instance as unknown as BatchInstance;
  const { newPlannedStart } = params as unknown as DeferStartParams;
  const { schema } = context.objectType;

  // Business validation
  if (batch.status !== "queued") {
    throw new Error(
      `Cannot defer: batch status is "${batch.status}", must be "queued"`,
    );
  }

  const newDate = new Date(newPlannedStart);
  if (newDate.getTime() <= Date.now()) {
    throw new Error("newPlannedStart must be in the future");
  }

  // Single transaction: update batch + write audit log
  const updatedBatch = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "batch")}
      SET ${sql.id("planned_start")} = ${newPlannedStart}
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

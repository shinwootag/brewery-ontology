import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";

/** Keep in sync with the action_type.parameter_schema metadata row. */
interface FlagParams {
  reason: string;
  severity: string;
}

interface BatchInstance {
  id: string;
  status: string;
  [key: string]: unknown;
}

const VALID_SEVERITIES = new Set(["low", "medium", "high"]);

/**
 * Batch.flag — raise an open FlagLog against a batch.
 *
 * Flagging records a concern for a human to review; it deliberately does NOT
 * touch batch.status. A flagged batch keeps running until someone acts on the
 * flag (or files a proposal to cancel/defer it).
 */
export const batchFlag: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const batch = instance as unknown as BatchInstance;
  const { reason, severity } = params as unknown as FlagParams;
  const { schema } = context.objectType;

  // Defensive checks that mirror the JSON Schema (the route validates too, but
  // the handler and schema must agree).
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("reason is required");
  }
  if (!VALID_SEVERITIES.has(severity)) {
    throw new Error(
      `Invalid severity "${severity}" (expected one of ${[...VALID_SEVERITIES].join(", ")})`,
    );
  }

  // Pinned server clock (COURSE_NOW), same source the other handlers use.
  const flaggedAt = new Date().toISOString();
  const flaggedBy = context.callerIdentity ?? "system";

  // Single transaction: flag log + audit. Note the absence of any UPDATE on
  // batch — that is the defining property of this action.
  const createdFlag = await db.transaction().execute(async (trx) => {
    // Domain id following the FL-<batch>-<date> convention, disambiguated if a
    // flag for that batch/day already exists.
    const datePart = flaggedAt.slice(0, 10);
    const base = `FL-${batch.id.replace(/-/g, "")}-${datePart}`;
    let flagId = base;
    for (let n = 2; ; n++) {
      const { rows } = await sql`
        SELECT 1 FROM ${sql.id(schema, "flag_log")}
        WHERE ${sql.id("id")} = ${flagId}
      `.execute(trx);
      if (rows.length === 0) break;
      flagId = `${base}-${n}`;
    }

    const { rows: inserted } = await sql`
      INSERT INTO ${sql.id(schema, "flag_log")}
        (${sql.id("id")}, ${sql.id("batch_id")}, ${sql.id("reason")},
         ${sql.id("severity")}, ${sql.id("status")}, ${sql.id("flagged_by")},
         ${sql.id("flagged_at")}, ${sql.id("resolved_at")})
      VALUES (${flagId}, ${batch.id}, ${reason}, ${severity}, 'open',
              ${flaggedBy}, ${flaggedAt}, NULL)
      RETURNING *
    `.execute(trx);

    const flag = inserted[0] as Record<string, unknown>;

    await trx
      .withSchema(schema)
      .insertInto("audit_log")
      .values({
        action_type_id: context.actionType.id,
        action_api_name: context.actionType.api_name,
        target_type_id: context.objectType.id,
        target_type_api_name: context.objectType.api_name,
        target_id: batch.id,
        actor: flaggedBy,
        params: JSON.stringify(params),
        result: JSON.stringify(flag),
        authorized_by_proposal: context.authorizedByProposal ?? null,
      })
      .execute();

    return flag;
  });

  return createdFlag;
};

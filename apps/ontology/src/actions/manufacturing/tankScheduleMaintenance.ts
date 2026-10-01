import { sql } from "kysely";
import { db } from "../../db.ts";
import type { ActionContext, ActionHandler } from "../index.ts";

/** Keep in sync with the action_type.parameter_schema metadata row. */
interface ScheduleMaintenanceParams {
  type: string;
  plannedAt: string;
  notes: string;
}

interface TankInstance {
  id: string;
  status: string;
  [key: string]: unknown;
}

const VALID_TYPES = new Set([
  "inspection",
  "preventive",
  "corrective",
  "cleaning",
]);

export const tankScheduleMaintenance: ActionHandler = async (
  instance: Record<string, unknown>,
  params: Record<string, unknown>,
  context: ActionContext,
) => {
  const tank = instance as unknown as TankInstance;
  const { type, plannedAt, notes } = params as unknown as ScheduleMaintenanceParams;
  const { schema } = context.objectType;

  // Defensive checks that mirror the JSON Schema (the route validates too, but
  // the handler and schema must agree).
  if (!VALID_TYPES.has(type)) {
    throw new Error(
      `Invalid maintenance type "${type}" (expected one of ${[...VALID_TYPES].join(", ")})`,
    );
  }
  const planned = new Date(plannedAt);
  if (Number.isNaN(planned.getTime())) {
    throw new Error("plannedAt must be a valid date-time");
  }

  // Business validation: the tank cannot go offline while a batch is fermenting.
  const { rows: fermenting } = await sql`
    SELECT ${sql.id("id")} FROM ${sql.id(schema, "batch")}
    WHERE ${sql.id("assigned_tank_id")} = ${tank.id}
      AND ${sql.id("status")} = 'fermenting'
  `.execute(db);
  if (fermenting.length > 0) {
    const ids = fermenting.map((r) => (r as { id: string }).id).join(", ");
    throw new Error(
      `Cannot take tank ${tank.id} offline for maintenance: batch(es) still fermenting (${ids})`,
    );
  }

  // Single transaction: tank offline + scheduled maintenance log + audit.
  const createdLog = await db.transaction().execute(async (trx) => {
    await sql`
      UPDATE ${sql.id(schema, "tank")}
      SET ${sql.id("status")} = 'maintenance'
      WHERE ${sql.id("id")} = ${tank.id}
    `.execute(trx);

    // Domain id following the ML-<tank>-<date> convention, disambiguated if a
    // log for that tank/day already exists.
    const datePart = plannedAt.slice(0, 10);
    const base = `ML-${tank.id.replace(/-/g, "")}-${datePart}`;
    let logId = base;
    for (let n = 2; ; n++) {
      const { rows } = await sql`
        SELECT 1 FROM ${sql.id(schema, "maintenance_log")}
        WHERE ${sql.id("id")} = ${logId}
      `.execute(trx);
      if (rows.length === 0) break;
      logId = `${base}-${n}`;
    }

    const { rows: inserted } = await sql`
      INSERT INTO ${sql.id(schema, "maintenance_log")}
        (${sql.id("id")}, ${sql.id("target_type")}, ${sql.id("target_id")},
         ${sql.id("type")}, ${sql.id("status")}, ${sql.id("planned_at")},
         ${sql.id("notes")})
      VALUES (${logId}, 'tank', ${tank.id}, ${type}, 'scheduled', ${plannedAt}, ${notes})
      RETURNING *
    `.execute(trx);

    const log = inserted[0] as Record<string, unknown>;

    await trx
      .withSchema(schema)
      .insertInto("audit_log")
      .values({
        action_type_id: context.actionType.id,
        action_api_name: context.actionType.api_name,
        target_type_id: context.objectType.id,
        target_type_api_name: context.objectType.api_name,
        target_id: tank.id,
        actor: context.callerIdentity ?? "system",
        params: JSON.stringify(params),
        result: JSON.stringify(log),
        authorized_by_proposal: context.authorizedByProposal ?? null,
      })
      .execute();

    return log;
  });

  return createdLog;
};

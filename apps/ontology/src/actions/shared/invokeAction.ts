import { sql } from "kysely";
import { Validator } from "@cfworker/json-schema";
import { db, INSTANCE_SCHEMAS } from "../../db.ts";
import { actionHandlers } from "../index.ts";
import type { ActionContext } from "../index.ts";

export interface InvokeActionOptions {
  /** Who is invoking the action; threaded to the handler's context. */
  callerIdentity?: string;
  /** Proposal id, when this invocation is authorized by an approved proposal. */
  authorizedByProposal?: string;
}

/**
 * Resolve and dispatch an action from its registry key (`"batch.cancel"`),
 * mirroring what the HTTP invoke route does but callable in-process. Used by
 * the proposal-approval flow to trigger the underlying action. The `type` is
 * matched case-sensitively against the handler registry.
 *
 * Throws (rather than returning an error object) if the type/action/instance
 * can't be resolved, if params fail schema validation, or if the handler
 * itself throws — so a caller can rely on a throw meaning "nothing changed".
 */
export async function invokeAction(
  type: string,
  targetId: string,
  params: Record<string, unknown>,
  options: InvokeActionOptions = {},
): Promise<Record<string, unknown>> {
  const dotIndex = type.indexOf(".");
  if (dotIndex <= 0 || dotIndex === type.length - 1) {
    throw new Error(
      `Invalid action type "${type}" (expected "objectType.action")`,
    );
  }
  const typeApiName = type.slice(0, dotIndex);
  const actionApiName = type.slice(dotIndex + 1);

  // 1. Resolve object type + its metadata schema
  let objectType;
  let metaSchema: string | undefined;
  for (const s of INSTANCE_SCHEMAS) {
    objectType = await db
      .withSchema(s)
      .selectFrom("object_type")
      .selectAll()
      .where("api_name", "=", typeApiName)
      .executeTakeFirst();
    if (objectType) {
      metaSchema = s;
      break;
    }
  }
  if (!objectType || !metaSchema || !INSTANCE_SCHEMAS.has(objectType.schema)) {
    throw new Error(`Unknown object type: ${typeApiName}`);
  }

  // 2. Resolve the action_type metadata
  const actionType = await db
    .withSchema(metaSchema)
    .selectFrom("action_type")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .where("api_name", "=", actionApiName)
    .executeTakeFirst();
  if (!actionType) {
    throw new Error(`Unknown action: ${type}`);
  }

  // 3. Validate params against the stored parameter_schema (parity with route)
  if (actionType.parameter_schema) {
    const validator = new Validator(actionType.parameter_schema as object);
    const result = validator.validate(params);
    if (!result.valid) {
      throw new Error(
        `Invalid params for ${type}: ${JSON.stringify(result.errors)}`,
      );
    }
  }

  // 4. Fetch the target instance by its primary key
  const pkProp = await db
    .withSchema(metaSchema)
    .selectFrom("property")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .where("is_primary_key", "=", true)
    .executeTakeFirstOrThrow();

  const { rows } = await sql`
    SELECT * FROM ${sql.id(objectType.schema, objectType.datasource_table)}
    WHERE ${sql.id(pkProp.datasource_column)} = ${targetId}
  `.execute(db);
  if (rows.length === 0) {
    throw new Error(`Target not found: ${typeApiName} ${targetId}`);
  }
  const instance = rows[0] as Record<string, unknown>;

  // 5. Dispatch to the registered handler
  const handler = actionHandlers[type];
  if (!handler) {
    throw new Error(`No handler registered for ${type}`);
  }

  const context: ActionContext = {
    objectType: {
      id: objectType.id,
      api_name: objectType.api_name,
      schema: objectType.schema,
      datasource_table: objectType.datasource_table,
    },
    actionType: {
      id: actionType.id,
      api_name: actionType.api_name,
      parameter_schema: actionType.parameter_schema,
    },
    callerIdentity: options.callerIdentity,
    authorizedByProposal: options.authorizedByProposal,
  };

  return handler(instance, params, context);
}

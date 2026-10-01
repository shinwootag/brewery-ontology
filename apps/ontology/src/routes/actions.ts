import { Hono } from "hono";
import { sql } from "kysely";
import { Validator } from "@cfworker/json-schema";
import { db, INSTANCE_SCHEMAS } from "../db.ts";
import { actionHandlers } from "../actions/index.ts";
import type { ActionContext } from "../actions/index.ts";

const actions = new Hono();

// POST /:type/:id/actions/:actionName — invoke an action on an instance
actions.post("/:type/:id/actions/:actionName", async (c) => {
  const typeApiName = c.req.param("type");
  const instanceId = c.req.param("id");
  const actionName = c.req.param("actionName");

  // 1. Resolve object type
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
    return c.json({ error: "Unknown type" }, 404);
  }

  // 2. Look up the action_type
  const actionType = await db
    .withSchema(metaSchema)
    .selectFrom("action_type")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .where("api_name", "=", actionName)
    .executeTakeFirst();

  if (!actionType) {
    return c.json({ error: `Unknown action: ${actionName}` }, 404);
  }

  // 3. Validate request body against parameter_schema
  const body = await c.req.json();

  if (actionType.parameter_schema) {
    const validator = new Validator(actionType.parameter_schema as object);
    const result = validator.validate(body);
    if (!result.valid) {
      return c.json({ error: "Invalid parameters", details: result.errors }, 422);
    }
  }

  // 4. Fetch the target instance
  const pkProp = await db
    .withSchema(metaSchema)
    .selectFrom("property")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .where("is_primary_key", "=", true)
    .executeTakeFirstOrThrow();

  const { rows } = await sql`
    SELECT * FROM ${sql.id(objectType.schema, objectType.datasource_table)}
    WHERE ${sql.id(pkProp.datasource_column)} = ${instanceId}
  `.execute(db);

  if (rows.length === 0) {
    return c.json({ error: "Instance not found" }, 404);
  }

  const instance = rows[0] as Record<string, unknown>;

  // 5. Dispatch to handler
  const handlerKey = `${typeApiName}.${actionName}`;
  const handler = actionHandlers[handlerKey];

  if (!handler) {
    return c.json({ error: `No handler registered for ${handlerKey}` }, 501);
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
    callerIdentity: c.req.header("x-caller-identity") || undefined,
  };

  try {
    const result = await handler(instance, body, context);
    return c.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Action failed";
    return c.json({ error: message }, 400);
  }
});

export default actions;

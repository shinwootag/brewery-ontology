import { Hono } from "hono";
import { sql } from "kysely";
import { db, INSTANCE_SCHEMAS } from "../db.ts";

const meta = new Hono();

// GET /types — list all object types across all schemas (with instance counts)
meta.get("/types", async (c) => {
  const allTypes = [];
  for (const schema of INSTANCE_SCHEMAS) {
    const types = await db
      .withSchema(schema)
      .selectFrom("object_type")
      .selectAll()
      .execute();

    for (const t of types) {
      const { rows } = await sql<{ count: number }>`
        SELECT COUNT(*)::int AS count FROM ${sql.id(t.schema, t.datasource_table)}
      `.execute(db);
      const count = (rows[0] as { count: number }).count;
      allTypes.push({ ...t, instance_count: count });
    }
  }
  return c.json(allTypes);
});

// GET /types/:type — full metadata bundle for one type
meta.get("/types/:type", async (c) => {
  const apiName = c.req.param("type");

  let objectType;
  let schema: string | undefined;

  for (const s of INSTANCE_SCHEMAS) {
    objectType = await db
      .withSchema(s)
      .selectFrom("object_type")
      .selectAll()
      .where("api_name", "=", apiName)
      .executeTakeFirst();
    if (objectType) {
      schema = s;
      break;
    }
  }

  if (!objectType || !schema) {
    return c.json({ error: `Unknown type: ${apiName}` }, 404);
  }

  const metaDb = db.withSchema(schema);

  const [properties, outgoingLinks, incomingLinks, actions] = await Promise.all([
    metaDb
      .selectFrom("property")
      .selectAll()
      .where("object_type_id", "=", objectType.id)
      .execute(),
    metaDb
      .selectFrom("link")
      .selectAll()
      .where("source_type_id", "=", objectType.id)
      .execute(),
    metaDb
      .selectFrom("link")
      .selectAll()
      .where("target_type_id", "=", objectType.id)
      .execute(),
    metaDb
      .selectFrom("action_type")
      .selectAll()
      .where("object_type_id", "=", objectType.id)
      .execute(),
  ]);

  return c.json({ objectType, properties, outgoingLinks, incomingLinks, actions });
});

// PATCH /types/:type — update display name or description
meta.patch("/types/:type", async (c) => {
  const apiName = c.req.param("type");
  const body = await c.req.json<{ name?: string; description?: string | null }>();

  const updates: Record<string, string | null> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: "name must be a non-empty string" }, 400);
    }
    updates.name = body.name;
  }
  if (body.description !== undefined) {
    updates.description = body.description;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  for (const s of INSTANCE_SCHEMAS) {
    const existing = await db
      .withSchema(s)
      .selectFrom("object_type")
      .select("id")
      .where("api_name", "=", apiName)
      .executeTakeFirst();

    if (existing) {
      const updated = await db
        .withSchema(s)
        .updateTable("object_type")
        .set(updates)
        .where("api_name", "=", apiName)
        .returningAll()
        .executeTakeFirstOrThrow();
      return c.json(updated);
    }
  }

  return c.json({ error: `Unknown type: ${apiName}` }, 404);
});

export default meta;

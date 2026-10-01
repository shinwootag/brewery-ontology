import { Hono } from "hono";
import { sql } from "kysely";
import { db, INSTANCE_SCHEMAS } from "../db.ts";

const objects = new Hono();

/**
 * Look up an object_type by api_name, searching all allowed schemas.
 * Validates the instance schema before returning.
 */
async function findObjectType(apiName: string) {
  for (const s of INSTANCE_SCHEMAS) {
    const ot = await db
      .withSchema(s)
      .selectFrom("object_type")
      .selectAll()
      .where("api_name", "=", apiName)
      .executeTakeFirst();
    if (ot) {
      if (!INSTANCE_SCHEMAS.has(ot.schema)) return undefined;
      return { metaSchema: s, objectType: ot };
    }
  }
  return undefined;
}

// GET /:type — list instances with optional query-param filters
objects.get("/:type", async (c) => {
  const found = await findObjectType(c.req.param("type"));
  if (!found) return c.json({ error: "Unknown type" }, 404);

  const { metaSchema, objectType } = found;
  const { schema, datasource_table } = objectType;

  // Fetch properties to validate filter params
  const properties = await db
    .withSchema(metaSchema)
    .selectFrom("property")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .execute();

  const propsByApiName = new Map(properties.map((p) => [p.api_name, p]));

  // Collect valid filters from query string
  const filters: { column: string; value: string }[] = [];
  for (const [key, value] of Object.entries(c.req.query())) {
    const prop = propsByApiName.get(key);
    if (prop) {
      filters.push({ column: prop.datasource_column, value });
    }
  }

  // Build query using parameterized values and quoted identifiers
  let query = sql`SELECT * FROM ${sql.id(schema, datasource_table)}`;

  if (filters.length > 0) {
    const conditions = filters.map(
      (f) => sql`${sql.id(f.column)} = ${f.value}`,
    );
    query = sql`${query} WHERE ${sql.join(conditions, sql` AND `)}`;
  }

  const { rows } = await query.execute(db);
  return c.json(rows);
});

// POST /:type/query — filtered instance query with a JSON body
//   body: { filters?: { property, op, value }[], limit?: number }
//   op ∈ eq | neq | gt | gte | lt | lte | in | contains | isNull | isNotNull
const COMPARISON_OPS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

objects.post("/:type/query", async (c) => {
  const found = await findObjectType(c.req.param("type"));
  if (!found) return c.json({ error: "Unknown type" }, 404);

  const { metaSchema, objectType } = found;
  const { schema, datasource_table } = objectType;

  let body: {
    filters?: { property: string; op: string; value?: unknown }[];
    limit?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const rawFilters = Array.isArray(body.filters) ? body.filters : [];

  // Map filter properties to real columns (rejects unknown properties).
  const properties = await db
    .withSchema(metaSchema)
    .selectFrom("property")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .execute();
  const propsByApiName = new Map(properties.map((p) => [p.api_name, p]));

  const conditions = [];
  for (const f of rawFilters) {
    const prop = propsByApiName.get(f.property);
    if (!prop) {
      return c.json({ error: `Unknown property: ${f.property}` }, 400);
    }
    const col = sql.id(prop.datasource_column);

    if (f.op === "isNull") {
      conditions.push(sql`${col} IS NULL`);
    } else if (f.op === "isNotNull") {
      conditions.push(sql`${col} IS NOT NULL`);
    } else if (f.op === "in") {
      const values = Array.isArray(f.value) ? f.value : [];
      if (values.length === 0) {
        return c.json({ error: `'in' filter needs a non-empty array` }, 400);
      }
      conditions.push(
        sql`${col} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`,
      );
    } else if (f.op === "contains") {
      conditions.push(sql`${col} ILIKE ${"%" + String(f.value ?? "") + "%"}`);
    } else if (f.op in COMPARISON_OPS) {
      conditions.push(sql`${col} ${sql.raw(COMPARISON_OPS[f.op])} ${f.value}`);
    } else {
      return c.json({ error: `Unknown op: ${f.op}` }, 400);
    }
  }

  let query = sql`SELECT * FROM ${sql.id(schema, datasource_table)}`;
  if (conditions.length > 0) {
    query = sql`${query} WHERE ${sql.join(conditions, sql` AND `)}`;
  }
  if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
    query = sql`${query} LIMIT ${Math.max(0, Math.floor(body.limit))}`;
  }

  const { rows } = await query.execute(db);
  return c.json(rows);
});

// POST /:type — create an instance from a JSON body.
//   Validates the body against the type's property metadata, then inserts.
//   Auto-generated columns (identity, defaults) may be omitted; identity
//   columns may not be supplied. Returns the created row.
interface ColumnInfo {
  column_default: string | null;
  is_identity: string; // 'YES' | 'NO'
  identity_generation: string | null; // 'ALWAYS' | 'BY DEFAULT' | null
  is_nullable: string; // 'YES' | 'NO'
}

/** Validate + coerce a body value for insertion, given the property's data_type.
 *  Throws Error (→ 400) on a type mismatch. */
function coerceValue(dataType: string, apiName: string, value: unknown): unknown {
  if (value === null) return null;
  switch (dataType) {
    case "json":
      // jsonb column: hand Postgres a JSON string (matches how handlers write
      // jsonb). Objects/arrays are stringified; a string is assumed to be JSON.
      return typeof value === "string" ? value : JSON.stringify(value);
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        return Number(value);
      }
      throw new Error(`Property "${apiName}" must be a number`);
    }
    case "datetime": {
      if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
        throw new Error(`Property "${apiName}" must be an ISO date-time string`);
      }
      return value;
    }
    case "string[]": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        throw new Error(`Property "${apiName}" must be an array of strings`);
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new Error(`Property "${apiName}" must be a boolean`);
      }
      return value;
    }
    // enum, string, and anything else are stored as text
    default: {
      if (typeof value !== "string") {
        throw new Error(`Property "${apiName}" must be a string`);
      }
      return value;
    }
  }
}

objects.post("/:type", async (c) => {
  const found = await findObjectType(c.req.param("type"));
  if (!found) return c.json({ error: "Unknown type" }, 404);

  const { metaSchema, objectType } = found;
  const { schema, datasource_table } = objectType;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "Body must be a JSON object" }, 400);
  }

  // Property metadata for this type.
  const properties = await db
    .withSchema(metaSchema)
    .selectFrom("property")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .execute();
  const propsByApiName = new Map(properties.map((p) => [p.api_name, p]));

  // Reject any body key that isn't a known property.
  for (const key of Object.keys(body)) {
    if (!propsByApiName.has(key)) {
      return c.json({ error: `Unknown property: ${key}` }, 400);
    }
  }

  // Column-level facts (defaults, identity, nullability) so we know which
  // metadata-"required" fields the DB can actually fill in on its own.
  const { rows: colRows } = await sql<ColumnInfo & { column_name: string }>`
    SELECT column_name, column_default, is_identity, identity_generation, is_nullable
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${datasource_table}
  `.execute(db);
  const colInfo = new Map(colRows.map((r) => [r.column_name, r]));

  const insertColumns: ReturnType<typeof sql.id>[] = [];
  const insertValues: unknown[] = [];

  for (const prop of properties) {
    const ci = colInfo.get(prop.datasource_column);
    const isIdentityAlways =
      ci?.is_identity === "YES" && ci?.identity_generation === "ALWAYS";
    const hasDefault = ci != null && (ci.column_default != null || ci.is_identity === "YES");
    const provided = Object.prototype.hasOwnProperty.call(body, prop.api_name);

    if (isIdentityAlways) {
      if (provided) {
        return c.json(
          { error: `Cannot set generated column: ${prop.api_name}` },
          400,
        );
      }
      continue; // DB generates it
    }

    if (!provided) {
      // A property is effectively required only if it can't be filled by a
      // column default (identity/serial or DEFAULT clause).
      if (prop.required && !hasDefault) {
        return c.json(
          { error: `Missing required property: ${prop.api_name}` },
          400,
        );
      }
      continue; // omit → DB default / NULL applies
    }

    let coerced: unknown;
    try {
      coerced = coerceValue(prop.data_type, prop.api_name, body[prop.api_name]);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Invalid property" },
        400,
      );
    }
    insertColumns.push(sql.id(prop.datasource_column));
    insertValues.push(coerced);
  }

  if (insertColumns.length === 0) {
    return c.json({ error: "No insertable properties in body" }, 400);
  }

  try {
    const { rows } = await sql`
      INSERT INTO ${sql.id(schema, datasource_table)}
        (${sql.join(insertColumns, sql`, `)})
      VALUES (${sql.join(insertValues.map((v) => sql`${v}`), sql`, `)})
      RETURNING *
    `.execute(db);
    return c.json(rows[0], 201);
  } catch (err) {
    // Surface constraint / cast failures as a 400 rather than a 500.
    return c.json(
      { error: err instanceof Error ? err.message : "Insert failed" },
      400,
    );
  }
});

// GET /:type/:id — get one instance with bidirectional link resolution
objects.get("/:type/:id", async (c) => {
  const found = await findObjectType(c.req.param("type"));
  if (!found) return c.json({ error: "Unknown type" }, 404);

  const { metaSchema, objectType } = found;
  const { schema, datasource_table } = objectType;
  const instanceId = c.req.param("id");

  const metaDb = db.withSchema(metaSchema);

  // Get PK column for this type
  const pkProp = await metaDb
    .selectFrom("property")
    .selectAll()
    .where("object_type_id", "=", objectType.id)
    .where("is_primary_key", "=", true)
    .executeTakeFirstOrThrow();

  // Fetch the instance
  const { rows } = await sql`
    SELECT * FROM ${sql.id(schema, datasource_table)}
    WHERE ${sql.id(pkProp.datasource_column)} = ${instanceId}
  `.execute(db);

  if (rows.length === 0) return c.json({ error: "Not found" }, 404);

  const instance = rows[0] as Record<string, unknown>;

  // Fetch links in both directions
  const [outboundLinks, inboundLinks] = await Promise.all([
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
  ]);

  const links: Record<string, unknown> = {};

  const allLinks = [...outboundLinks, ...inboundLinks];
  if (allLinks.length > 0) {
    // Batch-fetch all related types and properties in 3 parallel queries
    const typeIds = new Set<string>();
    const propIds = new Set<string>();
    for (const link of allLinks) {
      typeIds.add(link.source_type_id);
      typeIds.add(link.target_type_id);
      propIds.add(link.via_property_id);
    }

    const [relatedTypes, viaProps, pkProps] = await Promise.all([
      metaDb
        .selectFrom("object_type")
        .selectAll()
        .where("id", "in", [...typeIds])
        .execute(),
      metaDb
        .selectFrom("property")
        .selectAll()
        .where("id", "in", [...propIds])
        .execute(),
      metaDb
        .selectFrom("property")
        .selectAll()
        .where("object_type_id", "in", [...typeIds])
        .where("is_primary_key", "=", true)
        .execute(),
    ]);

    const typeMap = new Map(relatedTypes.map((t) => [t.id, t]));
    const propMap = new Map(viaProps.map((p) => [p.id, p]));
    const pkByType = new Map(pkProps.map((p) => [p.object_type_id, p]));

    // --- Outbound: follow FK on this instance → target row ---
    for (const link of outboundLinks) {
      const viaProp = propMap.get(link.via_property_id);
      if (!viaProp?.datasource_column) continue;

      const fkValue = instance[viaProp.datasource_column];
      if (fkValue == null) {
        links[link.api_name] = null;
        continue;
      }

      const targetType = typeMap.get(link.target_type_id);
      if (!targetType?.schema || !targetType.datasource_table) continue;
      if (!INSTANCE_SCHEMAS.has(targetType.schema)) continue;

      const targetPk = pkByType.get(link.target_type_id);
      if (!targetPk?.datasource_column) continue;

      const { rows: targetRows } = await sql`
        SELECT * FROM ${sql.id(targetType.schema, targetType.datasource_table)}
        WHERE ${sql.id(targetPk.datasource_column)} = ${fkValue}
      `.execute(db);

      links[link.api_name] =
        link.cardinality === "many_to_one" ? (targetRows[0] ?? null) : targetRows;
    }

    // --- Inbound: find source rows whose FK matches this PK ---
    for (const link of inboundLinks) {
      const viaProp = propMap.get(link.via_property_id);
      if (!viaProp?.datasource_column) continue;

      const sourceType = typeMap.get(link.source_type_id);
      if (!sourceType?.schema || !sourceType.datasource_table) continue;
      if (!INSTANCE_SCHEMAS.has(sourceType.schema)) continue;

      const pkValue = instance[pkProp.datasource_column];

      const { rows: sourceRows } = await sql`
        SELECT * FROM ${sql.id(sourceType.schema, sourceType.datasource_table)}
        WHERE ${sql.id(viaProp.datasource_column)} = ${pkValue}
      `.execute(db);

      links[link.inverse_api_name] = sourceRows;
    }
  }

  return c.json({ ...instance, links });
});

// GET /:type/:id/audit — audit-log entries for one object, newest first
objects.get("/:type/:id/audit", async (c) => {
  const found = await findObjectType(c.req.param("type"));
  if (!found) return c.json({ error: "Unknown type" }, 404);

  const { metaSchema, objectType } = found;
  const instanceId = c.req.param("id");
  const metaDb = db.withSchema(metaSchema);

  const entries = await metaDb
    .selectFrom("audit_log")
    .selectAll()
    .where("target_type_id", "=", objectType.id)
    .where("target_id", "=", instanceId)
    .orderBy("created_at", "desc")
    .execute();

  // Resolve human-readable action names from action_type.
  const actionTypeIds = [...new Set(entries.map((e) => e.action_type_id))];
  const actionTypes = actionTypeIds.length
    ? await metaDb
        .selectFrom("action_type")
        .select(["id", "name"])
        .where("id", "in", actionTypeIds)
        .execute()
    : [];
  const nameById = new Map(actionTypes.map((a) => [a.id, a.name]));

  return c.json(
    entries.map((e) => ({
      id: e.id,
      action: nameById.get(e.action_type_id) ?? e.action_api_name,
      actionApiName: e.action_api_name,
      actor: e.actor,
      params: e.params,
      result: e.result,
      timestamp: e.created_at,
    })),
  );
});

export default objects;

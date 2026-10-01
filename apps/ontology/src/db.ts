import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";
import type { DB } from "./schema.ts";

const { Pool } = pg;

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

/** Schemas whose instance tables may be queried dynamically. */
export const INSTANCE_SCHEMAS = new Set(["manufacturing"]);

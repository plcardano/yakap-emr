import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function requireDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return url;
}

const globalForDb = globalThis as unknown as {
  yakapSql?: ReturnType<typeof postgres>;
};

function client() {
  globalForDb.yakapSql ??= postgres(requireDatabaseUrl());
  return globalForDb.yakapSql;
}

export const db = drizzle({ client: client(), schema });

import "server-only";

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

export type RefundsDb = BetterSQLite3Database<typeof schema>;

export type OpenDatabaseOptions = {
  /** directory containing the drizzle-kit generated SQL migrations */
  migrationsFolder?: string;
};

export function defaultDatabasePath(): string {
  return path.join(process.cwd(), "data", "refunds.db");
}

export function defaultMigrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

/** Opens (creating if needed) the SQLite file and applies pending migrations. */
export function openDatabase(file: string, options: OpenDatabaseOptions = {}): RefundsDb {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder() });
  return db;
}

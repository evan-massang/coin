import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { runMigrations } from "./migrations.js";

export type DB = Database.Database;

/**
 * Open a database at `file` (or in-memory for tests), apply pragmas + migrations.
 * Pass ":memory:" for an isolated test DB.
 */
export function openDb(file: string): DB {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

let singleton: DB | undefined;

/** Process-wide database, opened lazily at config.dbPath. */
export function getDb(): DB {
  if (!singleton) singleton = openDb(config.dbPath);
  return singleton;
}

/** Close the singleton (used on shutdown / in tests). */
export function closeDb(): void {
  singleton?.close();
  singleton = undefined;
}

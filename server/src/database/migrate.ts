import type { Database as DatabaseType } from 'better-sqlite3';
import { getDb } from './db.js';

/**
 * Lightweight, additive, idempotent migration runner.
 *
 * The project has no migration framework; schema.sql is applied with
 * CREATE TABLE/TRIGGER/INDEX IF NOT EXISTS on every boot. That safely covers
 * new tables for fresh *and* existing databases, but it cannot add columns to
 * tables that already exist. This runner fills that gap: it inspects the live
 * schema and performs guarded `ALTER TABLE ADD COLUMN` operations only when a
 * column is genuinely missing. It never drops or rewrites anything, so it is
 * safe to run repeatedly and on databases that already contain event data.
 */

interface ColumnSpec {
  name: string;
  definition: string; // SQL fragment after the column name
}

function getColumns(db: DatabaseType, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

function ensureColumns(db: DatabaseType, table: string, columns: ColumnSpec[]): string[] {
  const existing = getColumns(db, table);
  if (existing.size === 0) {
    // Table does not exist yet (fresh DB) — schema.sql CREATE already includes
    // these columns, so there is nothing to back-fill here.
    return [];
  }
  const applied: string[] = [];
  for (const col of columns) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.definition}`);
      applied.push(`${table}.${col.name}`);
    }
  }
  return applied;
}

/**
 * Apply all pending additive column migrations. Returns the list of columns
 * that were added (empty when the database is already up to date).
 */
export function runMigrations(): string[] {
  const db = getDb();
  const applied: string[] = [];

  // TechBrains Round 2 case configuration (media lifecycle + AI evaluation).
  applied.push(
    ...ensureColumns(db, 'level2_cases', [
      { name: 'viewing_duration_seconds', definition: 'INTEGER NOT NULL DEFAULT 60' },
      { name: 'replay_cost', definition: 'INTEGER NOT NULL DEFAULT 20' },
      { name: 'reference_answer', definition: 'TEXT' },
      { name: 'evaluation_guidance', definition: 'TEXT' }
    ])
  );

  // TechBrains Round 1 per-question timer. Existing questions default to 30s so
  // seeded/legacy data keeps working. (SQLite ADD COLUMN cannot carry a CHECK,
  // which is fine — the service and schema.sql validate positivity.)
  applied.push(
    ...ensureColumns(db, 'level1_questions', [
      { name: 'time_limit_seconds', definition: 'INTEGER NOT NULL DEFAULT 30' }
    ])
  );

  // TechBrains Round 1 per-question server-authoritative timing bookkeeping.
  applied.push(
    ...ensureColumns(db, 'team_question_assignments', [
      { name: 'served_at', definition: 'TEXT' },
      { name: 'deadline_at', definition: 'TEXT' }
    ])
  );

  if (applied.length > 0) {
    console.log(`[Migrate] Applied additive column migrations: ${applied.join(', ')}`);
  } else {
    console.log('[Migrate] Database schema already up to date.');
  }

  return applied;
}

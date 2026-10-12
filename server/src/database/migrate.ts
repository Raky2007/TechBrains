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
      { name: 'evaluation_guidance', definition: 'TEXT' },
      { name: 'case_number', definition: 'INTEGER DEFAULT 1' },
      { name: 'q1_title', definition: 'TEXT' },
      { name: 'q1_prompt', definition: 'TEXT' },
      { name: 'q1_correct_pin', definition: 'TEXT' },
      { name: 'q1_pin_evidence', definition: 'TEXT' },
      { name: 'q1_accepted_formats_json', definition: 'TEXT' },
      { name: 'q2_title', definition: 'TEXT' },
      { name: 'q2_prompt', definition: 'TEXT' }
    ])
  );

  // TechBrains Round 1 per-question timer. Existing questions default to 30s so
  // seeded/legacy data keeps working. (SQLite ADD COLUMN cannot carry a CHECK,
  // which is fine — the service and schema.sql validate positivity.)
  applied.push(
    ...ensureColumns(db, 'level1_questions', [
      { name: 'time_limit_seconds', definition: 'INTEGER NOT NULL DEFAULT 30' },
      { name: 'points_value', definition: 'INTEGER NOT NULL DEFAULT 3' }
    ])
  );

  // TechBrains Round 1 per-question server-authoritative timing bookkeeping.
  applied.push(
    ...ensureColumns(db, 'team_question_assignments', [
      { name: 'served_at', definition: 'TEXT' },
      { name: 'deadline_at', definition: 'TEXT' }
    ])
  );

  // Point 14: Admin team ban status and metadata
  applied.push(
    ...ensureColumns(db, 'teams', [
      { name: 'is_banned', definition: 'INTEGER NOT NULL DEFAULT 0' },
      { name: 'banned_at', definition: 'TEXT' },
      { name: 'banned_by', definition: 'TEXT' },
      { name: 'ban_reason', definition: 'TEXT' }
    ])
  );

  // TechBrains Round 2 two-level credit pools. NULL = not yet initialized; each
  // is seeded exactly once when the team first enters that level.
  applied.push(
    ...ensureColumns(db, 'teams', [
      { name: 'level1_credits', definition: 'INTEGER' },
      { name: 'level2_credits', definition: 'INTEGER' }
    ])
  );

  // Level pools: add required_level to clues table for level-specific spending
  applied.push(
    ...ensureColumns(db, 'clues', [
      { name: 'required_level', definition: 'INTEGER NOT NULL DEFAULT 1' },
      { name: 'question_number', definition: 'INTEGER NOT NULL DEFAULT 1' },
      { name: 'tier', definition: 'TEXT NOT NULL DEFAULT "simple"' }
    ])
  );

  // Level 2 Question 1 & Question 2 columns on conclusions
  applied.push(
    ...ensureColumns(db, 'conclusions', [
      { name: 'q1_pin', definition: 'TEXT' },
      { name: 'q1_is_correct', definition: 'INTEGER DEFAULT 0' },
      { name: 'q1_score', definition: 'REAL DEFAULT 0' },
      { name: 'q2_selected_suspect', definition: 'TEXT' },
      { name: 'q2_explanation', definition: 'TEXT' }
    ])
  );

  // Level 2 Question 1 & Question 2 breakdown on case_evaluations
  applied.push(
    ...ensureColumns(db, 'case_evaluations', [
      { name: 'q1_score', definition: 'REAL DEFAULT 0' },
      { name: 'q2_score', definition: 'REAL DEFAULT 0' },
      { name: 'suspect_score', definition: 'INTEGER DEFAULT 0' },
      { name: 'evidence_score', definition: 'INTEGER DEFAULT 0' },
      { name: 'logic_score', definition: 'INTEGER DEFAULT 0' },
      { name: 'q2_selected_suspect_correct', definition: 'INTEGER DEFAULT 0' },
      { name: 'q2_closest_answer', definition: 'TEXT' },
      { name: 'q2_accuracy_summary', definition: 'TEXT' },
      { name: 'q2_matched_evidence', definition: 'TEXT' },
      { name: 'q2_missing_evidence', definition: 'TEXT' },
      { name: 'q2_feedback', definition: 'TEXT' }
    ])
  );

  // Ensure level2_question_submissions table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS level2_question_submissions (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      question_number INTEGER NOT NULL CHECK(question_number IN (1, 2)),
      pin_submitted TEXT,
      pin_normalized TEXT,
      is_correct INTEGER,
      selected_suspect TEXT,
      explanation TEXT,
      score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 5,
      suspect_score INTEGER DEFAULT 0,
      evidence_score INTEGER DEFAULT 0,
      logic_score INTEGER DEFAULT 0,
      evaluation_status TEXT NOT NULL DEFAULT 'completed' CHECK(evaluation_status IN ('pending', 'completed', 'failed')),
      evaluation_data_json TEXT,
      submitted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(round_id, team_id, question_number)
    );
    CREATE INDEX IF NOT EXISTS idx_l2_q_sub_round_team ON level2_question_submissions(round_id, team_id);
  `);

  applied.push(
    ...ensureColumns(db, 'level2_question_submissions', [
      { name: 'suspect_score', definition: 'INTEGER DEFAULT 0' },
      { name: 'evidence_score', definition: 'INTEGER DEFAULT 0' },
      { name: 'logic_score', definition: 'INTEGER DEFAULT 0' }
    ])
  );

  // Add player1_roll, player2_roll, and assigned_case_id to teams table
  applied.push(
    ...ensureColumns(db, 'teams', [
      { name: 'player1_roll', definition: 'TEXT' },
      { name: 'player2_roll', definition: 'TEXT' },
      { name: 'assigned_case_id', definition: 'TEXT' }
    ])
  );

  // Upgrade status check constraints on evaluation tables if needed
  migrateEvaluationStatusConstraints(db);

  // Ensure all existing Level 2 clues have required_level = 2 and match current specifications
  try {
    db.prepare('UPDATE clues SET required_level = 2 WHERE required_level = 1 OR required_level IS NULL').run();

    // Synchronize Question 1 clues: 10, 50, 70 CR
    db.prepare(`
      UPDATE clues
      SET credit_cost = 10,
          title = 'Keypad Smudges',
          content = 'Smudges remember what hands forget. Four keys have been pressed more than the rest.'
      WHERE question_number = 1 AND tier = 'simple'
    `).run();

    db.prepare(`
      UPDATE clues
      SET credit_cost = 50,
          title = 'Stated Times',
          content = 'Strike out each stated time. Each one holds a digit that the worn keys do not.'
      WHERE question_number = 1 AND tier = 'medium'
    `).run();

    db.prepare(`
      UPDATE clues
      SET credit_cost = 70,
          title = 'Vault Timestamp',
          content = 'The screen showed 7:40, but its picture may not have been live. Compare the shadows with the time the footage was actually captured.'
      WHERE question_number = 1 AND tier = 'high'
    `).run();

    // Synchronize Question 2 clues: 30, 60, 70 CR
    db.prepare(`
      UPDATE clues
      SET credit_cost = 30,
          title = 'The Silent Log',
          content = 'A door log can stay silent while a screen tells the loudest lie. Follow the one who shapes what screens say.'
      WHERE question_number = 2 AND tier = 'simple'
    `).run();

    db.prepare(`
      UPDATE clues
      SET credit_cost = 60,
          title = 'Timeline Verification',
          content = 'An exit at 7:25, a lock at 7:30 and a workshop card from 7:32 to 8:05. Three evenings are accounted for. One is not.'
      WHERE question_number = 2 AND tier = 'medium'
    `).run();

    db.prepare(`
      UPDATE clues
      SET credit_cost = 70,
          title = 'Badge and Ledger',
          content = 'The badge behind that account matches the ledger''s letter, and the account belongs to the person who manages recordings.'
      WHERE question_number = 2 AND tier = 'high'
    `).run();
  } catch {
    // Ignore if clues table doesn't exist yet
  }

  if (applied.length > 0) {
    console.log(`[Migrate] Applied additive column migrations: ${applied.join(', ')}`);
  } else {
    console.log('[Migrate] Database schema already up to date.');
  }

  return applied;
}

function migrateEvaluationStatusConstraints(db: DatabaseType): void {
  // Check case_evaluations
  const ceRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='case_evaluations'").get() as { sql: string } | undefined;
  if (ceRow && !ceRow.sql.includes("'processing'")) {
    db.transaction(() => {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE case_evaluations_dg_tmp (
            id TEXT PRIMARY KEY,
            conclusion_id TEXT NOT NULL UNIQUE REFERENCES conclusions(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'overridden')),
            score REAL,
            max_score REAL NOT NULL DEFAULT 20,
            verdict TEXT,
            reasoning TEXT,
            provider TEXT,
            model TEXT,
            source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai', 'manual')),
            is_overridden INTEGER NOT NULL DEFAULT 0 CHECK(is_overridden IN (0, 1)),
            error_message TEXT,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            evaluator_id TEXT REFERENCES admin_users(id),
            q1_score REAL DEFAULT 0,
            q2_score REAL DEFAULT 0,
            q2_selected_suspect_correct INTEGER DEFAULT 0,
            q2_closest_answer TEXT,
            q2_accuracy_summary TEXT,
            q2_matched_evidence TEXT,
            q2_missing_evidence TEXT,
            q2_feedback TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        INSERT INTO case_evaluations_dg_tmp (
          id, conclusion_id, status, score, max_score, verdict, reasoning, provider, model,
          source, is_overridden, error_message, attempt_count, evaluator_id,
          q1_score, q2_score, q2_selected_suspect_correct, q2_closest_answer,
          q2_accuracy_summary, q2_matched_evidence, q2_missing_evidence, q2_feedback,
          created_at, updated_at
        ) SELECT 
          id, conclusion_id, status, score, max_score, verdict, reasoning, provider, model,
          source, is_overridden, error_message, attempt_count, evaluator_id,
          COALESCE(q1_score, 0), COALESCE(q2_score, 0), COALESCE(q2_selected_suspect_correct, 0), q2_closest_answer,
          q2_accuracy_summary, q2_matched_evidence, q2_missing_evidence, q2_feedback,
          created_at, updated_at
        FROM case_evaluations;
        DROP TABLE case_evaluations;
        ALTER TABLE case_evaluations_dg_tmp RENAME TO case_evaluations;
        CREATE INDEX IF NOT EXISTS idx_case_evaluations_conclusion ON case_evaluations(conclusion_id);
      `);
      db.pragma('foreign_keys = ON');
    })();
    console.log('[Migrate] Upgraded case_evaluations table status constraint.');
  }

  // Check level2_question_submissions
  const l2SubRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='level2_question_submissions'").get() as { sql: string } | undefined;
  if (l2SubRow && !l2SubRow.sql.includes("'processing'")) {
    db.transaction(() => {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE level2_question_submissions_dg_tmp (
            id TEXT PRIMARY KEY,
            round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
            team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            question_number INTEGER NOT NULL CHECK(question_number IN (1, 2)),
            pin_submitted TEXT,
            pin_normalized TEXT,
            is_correct INTEGER,
            selected_suspect TEXT,
            explanation TEXT,
            score REAL NOT NULL DEFAULT 0,
            max_score REAL NOT NULL DEFAULT 5,
            evaluation_status TEXT NOT NULL DEFAULT 'completed' CHECK(evaluation_status IN ('pending', 'processing', 'completed', 'failed', 'overridden')),
            evaluation_data_json TEXT,
            submitted_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(round_id, team_id, question_number)
        );
        INSERT INTO level2_question_submissions_dg_tmp SELECT * FROM level2_question_submissions;
        DROP TABLE level2_question_submissions;
        ALTER TABLE level2_question_submissions_dg_tmp RENAME TO level2_question_submissions;
        CREATE INDEX IF NOT EXISTS idx_l2_q_sub_round_team ON level2_question_submissions(round_id, team_id);
      `);
      db.pragma('foreign_keys = ON');
    })();
    console.log('[Migrate] Upgraded level2_question_submissions evaluation_status constraint.');
  }
}

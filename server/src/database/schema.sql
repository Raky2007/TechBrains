-- NEXUS LAN Database Schema
-- Foreign keys must be enabled in SQLite connection: PRAGMA foreign_keys = ON;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('idle', 'level1_active', 'level1_paused', 'level1_ended', 'level2_active', 'level2_paused', 'level2_ended', 'completed')),
    current_level INTEGER CHECK(current_level IN (1, 2) OR current_level IS NULL),
    settings_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    game_session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    team_name TEXT NOT NULL COLLATE NOCASE,
    access_token_hash TEXT NOT NULL,
    level1_score INTEGER NOT NULL DEFAULT 0,
    level2_score REAL NOT NULL DEFAULT 0,
    initial_credits INTEGER NOT NULL DEFAULT 200,
    current_credits INTEGER NOT NULL DEFAULT 200,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(game_session_id, team_name COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS level1_questions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN ('image', 'video', 'text')),
    media_path TEXT,
    correct_answer TEXT NOT NULL CHECK(correct_answer IN ('AI', 'HUMAN', 'CANT_DEFINE')),
    explanation TEXT,
    category TEXT,
    difficulty TEXT CHECK(difficulty IN ('easy', 'medium', 'hard') OR difficulty IS NULL),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    game_session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    level INTEGER NOT NULL CHECK(level IN (1, 2)),
    status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'ended')),
    started_at TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    paused_at TEXT,
    remaining_seconds INTEGER,
    settings_snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE TABLE IF NOT EXISTS team_question_assignments (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES level1_questions(id) ON DELETE CASCADE,
    question_order INTEGER NOT NULL,
    UNIQUE(round_id, team_id, question_order),
    UNIQUE(round_id, team_id, question_id)
);

CREATE TABLE IF NOT EXISTS team_answers (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES level1_questions(id) ON DELETE CASCADE,
    selected_answer TEXT NOT NULL CHECK(selected_answer IN ('AI', 'HUMAN', 'CANT_DEFINE')),
    is_correct INTEGER NOT NULL CHECK(is_correct IN (0, 1)),
    awarded_points INTEGER NOT NULL DEFAULT 0,
    submitted_at TEXT NOT NULL,
    UNIQUE(round_id, team_id, question_id)
);

CREATE TABLE IF NOT EXISTS level2_cases (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    situation_description TEXT NOT NULL,
    media_path TEXT,
    initial_credits INTEGER NOT NULL DEFAULT 200,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    rubric_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clues (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES level2_cases(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    media_path TEXT,
    credit_cost INTEGER NOT NULL DEFAULT 20,
    display_order INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clue_unlocks (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    clue_id TEXT NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
    credits_spent INTEGER NOT NULL,
    unlocked_at TEXT NOT NULL,
    UNIQUE(round_id, team_id, clue_id)
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    clue_id TEXT REFERENCES clues(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,
    transaction_type TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(team_id, operation_id)
);

CREATE TABLE IF NOT EXISTS conclusions (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    conclusion_text TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'reopened')),
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(round_id, team_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    conclusion_id TEXT NOT NULL UNIQUE REFERENCES conclusions(id) ON DELETE CASCADE,
    accuracy_score REAL NOT NULL DEFAULT 0 CHECK(accuracy_score >= 0 AND accuracy_score <= 10),
    reasoning_score REAL NOT NULL DEFAULT 0 CHECK(reasoning_score >= 0 AND reasoning_score <= 5),
    efficiency_score REAL NOT NULL DEFAULT 0 CHECK(efficiency_score >= 0 AND efficiency_score <= 5),
    total_score REAL NOT NULL DEFAULT 0 CHECK(total_score >= 0 AND total_score <= 20),
    feedback TEXT,
    evaluator_id TEXT NOT NULL REFERENCES admin_users(id),
    evaluated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT REFERENCES admin_users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT,
    created_at TEXT NOT NULL
);

-- Optimization indexes
CREATE INDEX IF NOT EXISTS idx_teams_session ON teams(game_session_id);
CREATE INDEX IF NOT EXISTS idx_assignments_round_team ON team_question_assignments(round_id, team_id);
CREATE INDEX IF NOT EXISTS idx_answers_round_team ON team_answers(round_id, team_id);
CREATE INDEX IF NOT EXISTS idx_clues_case ON clues(case_id);
CREATE INDEX IF NOT EXISTS idx_clue_unlocks_round_team ON clue_unlocks(round_id, team_id);
CREATE INDEX IF NOT EXISTS idx_credit_tx_team ON credit_transactions(team_id);
CREATE INDEX IF NOT EXISTS idx_conclusions_round ON conclusions(round_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

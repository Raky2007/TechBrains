import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db.js';
import { CONFIG } from '../config.js';
import { generateSecureToken, hashToken } from '../utils/crypto.js';
import {
  GameSession,
  GameSettings,
  Round,
  Team,
  Level1Question,
  ClientLevel1Question,
  Level2Case,
  Clue,
  ClientClue,
  ClientCaseMedia,
  CaseMedia,
  CaseEvaluation,
  MediaReplay,
  Conclusion,
  Level1AnswerChoice,
  PublicGameState,
  TeamPrivateState
} from '@nexus/shared';
import { calculateLevel1Score, calculateAuthoritativeLeaderboard } from './scoringService.js';
import { isRoundExpired, getAuthoritativeTimerState } from './timerService.js';
import { logAuditAction } from './auditService.js';
import { evaluateCaseAnswer, isAiConfigured } from './aiEvaluationService.js';

/**
 * Backfill any missing settings keys from defaults so sessions created before a
 * settings-shape change (e.g. round2MaxScore) remain valid and complete.
 */
function normalizeSettings(raw: Partial<GameSettings>): GameSettings {
  return { ...(CONFIG.DEFAULT_SETTINGS as GameSettings), ...raw };
}

export class GameService {
  /**
   * Get primary or latest active game session
   */
  static getGameSession(): { session: GameSession; settings: GameSettings; activeRound: Round | null } {
    const db = getDb();
    let session = db.prepare('SELECT * FROM game_sessions ORDER BY created_at DESC LIMIT 1').get() as GameSession | undefined;

    if (!session) {
      const sessionId = uuidv4();
      const now = new Date().toISOString();
      const settingsJson = JSON.stringify(CONFIG.DEFAULT_SETTINGS);

      db.prepare(`
        INSERT INTO game_sessions (id, name, status, current_level, settings_json, created_at, updated_at)
        VALUES (?, ?, 'idle', NULL, ?, ?, ?)
      `).run(sessionId, 'NEXUS LAN Championship Session', settingsJson, now, now);

      session = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(sessionId) as GameSession;
    }

    const settings: GameSettings = normalizeSettings(JSON.parse(session.settings_json));
    const activeRound = db.prepare(`
      SELECT * FROM rounds 
      WHERE game_session_id = ? AND status IN ('active', 'paused')
      ORDER BY created_at DESC LIMIT 1
    `).get(session.id) as Round | null;

    return { session, settings, activeRound };
  }

  /**
   * Update game settings
   */
  static updateSettings(adminUserId: string, newSettings: Partial<GameSettings>): GameSettings {
    const { session, settings } = this.getGameSession();
    const updatedSettings: GameSettings = { ...settings, ...newSettings };
    const now = new Date().toISOString();

    const db = getDb();
    db.prepare(`
      UPDATE game_sessions 
      SET settings_json = ?, updated_at = ? 
      WHERE id = ?
    `).run(JSON.stringify(updatedSettings), now, session.id);

    logAuditAction(adminUserId, 'UPDATE_SETTINGS', 'game_sessions', session.id, updatedSettings);
    return updatedSettings;
  }

  /**
   * Register a new team with case-insensitive uniqueness check and initial credits
   */
  static registerTeam(teamName: string): { team: Team; token: string } {
    const trimmed = teamName.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 50) {
      throw new Error('Team name must be between 2 and 50 characters.');
    }

    const { session, settings } = this.getGameSession();
    const db = getDb();

    // Case-insensitive duplicate check
    const existing = db.prepare(`
      SELECT id, team_name FROM teams 
      WHERE game_session_id = ? AND team_name = ? COLLATE NOCASE
    `).get(session.id, trimmed);

    if (existing) {
      throw new Error(`Team name "${trimmed}" is already registered in this session. Choose another name or reconnect.`);
    }

    const token = generateSecureToken();
    const tokenHash = hashToken(token);
    const teamId = uuidv4();
    const now = new Date().toISOString();
    const initialCredits = settings.initialCredits || 200;

    db.prepare(`
      INSERT INTO teams (
        id, game_session_id, team_name, access_token_hash, 
        level1_score, level2_score, initial_credits, current_credits, 
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
    `).run(teamId, session.id, trimmed, tokenHash, initialCredits, initialCredits, now, now);

    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as Team;
    return { team, token };
  }

  /**
   * Re-authenticate an existing team using their token
   */
  static authenticateTeam(token: string): Team | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const db = getDb();
    return (db.prepare('SELECT * FROM teams WHERE access_token_hash = ?').get(tokenHash) as Team) || null;
  }

  /**
   * Start a round (Level 1 or Level 2) atomically
   */
  static startRound(adminUserId: string, level: 1 | 2): { round: Round; session: GameSession } {
    const db = getDb();
    const { session, settings } = this.getGameSession();

    if (level === 1 && session.status !== 'idle') {
      throw new Error(`Cannot start Level 1 when game session status is "${session.status}".`);
    }
    if (level === 2 && session.status !== 'level1_ended') {
      throw new Error(`Cannot start Level 2 until Level 1 has completed (current status: "${session.status}").`);
    }

    // Validate prerequisites
    if (level === 1) {
      const activeQCount = (db.prepare('SELECT COUNT(*) as count FROM level1_questions WHERE is_active = 1').get() as any).count;
      if (activeQCount === 0) {
        throw new Error('Cannot start Level 1: No active Level 1 questions found.');
      }
    } else {
      const activeCaseCount = (db.prepare('SELECT COUNT(*) as count FROM level2_cases WHERE is_active = 1').get() as any).count;
      if (activeCaseCount === 0) {
        throw new Error('Cannot start Level 2: No active Level 2 forensic cases found.');
      }
    }

    const durationMinutes = level === 1 ? settings.level1DurationMinutes : settings.level2DurationMinutes;
    const nowMs = Date.now();
    const startedAt = new Date(nowMs).toISOString();
    const deadlineAt = new Date(nowMs + durationMinutes * 60 * 1000).toISOString();
    const roundId = uuidv4();
    const remainingSeconds = durationMinutes * 60;
    const snapshotJson = JSON.stringify(settings);

    const runTransaction = db.transaction(() => {
      // Create round record
      db.prepare(`
        INSERT INTO rounds (
          id, game_session_id, level, status, started_at, deadline_at, 
          paused_at, remaining_seconds, settings_snapshot_json, created_at, ended_at
        ) VALUES (?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?, NULL)
      `).run(roundId, session.id, level, startedAt, deadlineAt, remainingSeconds, snapshotJson, startedAt);

      // If Level 1: Assign questions to every registered team
      if (level === 1) {
        const questions = db.prepare('SELECT id FROM level1_questions WHERE is_active = 1').all() as { id: string }[];
        const teams = db.prepare('SELECT id FROM teams WHERE game_session_id = ?').all(session.id) as { id: string }[];

        const insertAssignment = db.prepare(`
          INSERT INTO team_question_assignments (id, round_id, team_id, question_id, question_order)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const team of teams) {
          // Clone and shuffle if randomizeQuestionOrder is enabled
          let qPool = [...questions];
          if (settings.randomizeQuestionOrder) {
            for (let i = qPool.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [qPool[i], qPool[j]] = [qPool[j], qPool[i]];
            }
          }

          qPool.forEach((q, idx) => {
            insertAssignment.run(uuidv4(), roundId, team.id, q.id, idx + 1);
          });
        }
      }

      // Update game session status
      const nextSessionStatus = level === 1 ? 'level1_active' : 'level2_active';
      db.prepare(`
        UPDATE game_sessions 
        SET status = ?, current_level = ?, updated_at = ? 
        WHERE id = ?
      `).run(nextSessionStatus, level, startedAt, session.id);
    });

    runTransaction();

    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId) as Round;
    const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id) as GameSession;

    logAuditAction(adminUserId, `START_LEVEL_${level}`, 'rounds', roundId, { startedAt, deadlineAt, durationMinutes });

    return { round, session: updatedSession };
  }

  /**
   * Helper to ensure a specific team has questions assigned for Level 1
   */
  static ensureTeamQuestionsAssigned(roundId: string, teamId: string): void {
    const db = getDb();
    const existing = db.prepare(`
      SELECT COUNT(*) as count FROM team_question_assignments 
      WHERE round_id = ? AND team_id = ?
    `).get(roundId, teamId) as any;

    if (existing.count === 0) {
      const { settings } = this.getGameSession();
      const questions = db.prepare('SELECT id FROM level1_questions WHERE is_active = 1').all() as { id: string }[];
      let qPool = [...questions];
      if (settings.randomizeQuestionOrder) {
        for (let i = qPool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [qPool[i], qPool[j]] = [qPool[j], qPool[i]];
        }
      }

      const insertAssignment = db.prepare(`
        INSERT INTO team_question_assignments (id, round_id, team_id, question_id, question_order)
        VALUES (?, ?, ?, ?, ?)
      `);

      qPool.forEach((q, idx) => {
        insertAssignment.run(uuidv4(), roundId, teamId, q.id, idx + 1);
      });
    }
  }

  /**
   * Pause the active round
   */
  static pauseRound(adminUserId: string, level: 1 | 2): { round: Round; session: GameSession } {
    const db = getDb();
    const { session } = this.getGameSession();

    const round = db.prepare(`
      SELECT * FROM rounds 
      WHERE game_session_id = ? AND level = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 1
    `).get(session.id, level) as Round | undefined;

    if (!round) {
      throw new Error(`No active round found for Level ${level} to pause.`);
    }

    const now = Date.now();
    const deadlineMs = new Date(round.deadline_at).getTime();
    const remainingSeconds = Math.max(0, Math.floor((deadlineMs - now) / 1000));
    const pausedAt = new Date(now).toISOString();

    const runTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE rounds 
        SET status = 'paused', paused_at = ?, remaining_seconds = ? 
        WHERE id = ?
      `).run(pausedAt, remainingSeconds, round.id);

      db.prepare(`
        UPDATE game_sessions 
        SET status = ?, updated_at = ? 
        WHERE id = ?
      `).run(level === 1 ? 'level1_paused' : 'level2_paused', pausedAt, session.id);
    });

    runTransaction();

    const updatedRound = db.prepare('SELECT * FROM rounds WHERE id = ?').get(round.id) as Round;
    const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id) as GameSession;

    logAuditAction(adminUserId, `PAUSE_LEVEL_${level}`, 'rounds', round.id, { pausedAt, remainingSeconds });
    return { round: updatedRound, session: updatedSession };
  }

  /**
   * Resume a paused round
   */
  static resumeRound(adminUserId: string, level: 1 | 2): { round: Round; session: GameSession } {
    const db = getDb();
    const { session } = this.getGameSession();

    const round = db.prepare(`
      SELECT * FROM rounds 
      WHERE game_session_id = ? AND level = ? AND status = 'paused'
      ORDER BY created_at DESC LIMIT 1
    `).get(session.id, level) as Round | undefined;

    if (!round) {
      throw new Error(`No paused round found for Level ${level} to resume.`);
    }

    const now = Date.now();
    const remainingSeconds = round.remaining_seconds || 0;
    const newDeadlineAt = new Date(now + remainingSeconds * 1000).toISOString();
    const resumedAt = new Date(now).toISOString();

    const runTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE rounds 
        SET status = 'active', deadline_at = ?, paused_at = NULL 
        WHERE id = ?
      `).run(newDeadlineAt, round.id);

      db.prepare(`
        UPDATE game_sessions 
        SET status = ?, updated_at = ? 
        WHERE id = ?
      `).run(level === 1 ? 'level1_active' : 'level2_active', resumedAt, session.id);
    });

    runTransaction();

    const updatedRound = db.prepare('SELECT * FROM rounds WHERE id = ?').get(round.id) as Round;
    const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id) as GameSession;

    logAuditAction(adminUserId, `RESUME_LEVEL_${level}`, 'rounds', round.id, { newDeadlineAt, remainingSeconds });
    return { round: updatedRound, session: updatedSession };
  }

  /**
   * End a round explicitly or automatically upon expiration
   */
  static endRound(adminUserId: string | null, level: 1 | 2): { round: Round; session: GameSession } {
    const db = getDb();
    const { session } = this.getGameSession();

    const round = db.prepare(`
      SELECT * FROM rounds 
      WHERE game_session_id = ? AND level = ? AND status IN ('active', 'paused')
      ORDER BY created_at DESC LIMIT 1
    `).get(session.id, level) as Round | undefined;

    if (!round) {
      throw new Error(`No active or paused round found for Level ${level} to end.`);
    }

    const endedAt = new Date().toISOString();

    const runTransaction = db.transaction(() => {
      db.prepare(`
        UPDATE rounds 
        SET status = 'ended', ended_at = ? 
        WHERE id = ?
      `).run(endedAt, round.id);

      db.prepare(`
        UPDATE game_sessions 
        SET status = ?, updated_at = ? 
        WHERE id = ?
      `).run(level === 1 ? 'level1_ended' : 'level2_ended', endedAt, session.id);

      // Verify and lock total scores for Level 1
      if (level === 1) {
        db.prepare(`
          UPDATE teams 
          SET level1_score = (
            SELECT COALESCE(SUM(awarded_points), 0) 
            FROM team_answers 
            WHERE team_answers.team_id = teams.id AND team_answers.round_id = ?
          )
          WHERE game_session_id = ?
        `).run(round.id, session.id);
      }
    });

    runTransaction();

    const updatedRound = db.prepare('SELECT * FROM rounds WHERE id = ?').get(round.id) as Round;
    const updatedSession = db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id) as GameSession;

    logAuditAction(adminUserId, `END_LEVEL_${level}`, 'rounds', round.id, { endedAt });
    return { round: updatedRound, session: updatedSession };
  }

  /**
   * Publish the final leaderboard (embargo lift). Does NOT change game status —
   * completing the event is a separate, explicit admin action.
   */
  static publishFinalResults(adminUserId: string): GameSession {
    const db = getDb();
    const { session, settings } = this.getGameSession();
    const now = new Date().toISOString();

    const updated = { ...settings, resultsPublished: true };
    db.prepare(`
      UPDATE game_sessions SET settings_json = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(updated), now, session.id);

    logAuditAction(adminUserId, 'PUBLISH_RESULTS', 'game_sessions', session.id);
    return db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id) as GameSession;
  }

  /**
   * Mark the whole event complete. Any still-active round is ended first.
   */
  static completeEvent(adminUserId: string): GameSession {
    const db = getDb();
    const { session, activeRound } = this.getGameSession();
    if (activeRound) {
      this.endRound(adminUserId, activeRound.level as 1 | 2);
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE game_sessions SET status = 'completed', updated_at = ? WHERE id = ?`).run(now, session.id);
    logAuditAction(adminUserId, 'COMPLETE_EVENT', 'game_sessions', session.id);
    return db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(session.id) as GameSession;
  }

  /**
   * Reset game session cleanly
   */
  static resetGame(adminUserId: string): GameSession {
    const db = getDb();
    const newSessionId = uuidv4();
    const now = new Date().toISOString();
    const settingsJson = JSON.stringify(CONFIG.DEFAULT_SETTINGS);

    db.prepare(`
      INSERT INTO game_sessions (id, name, status, current_level, settings_json, created_at, updated_at)
      VALUES (?, ?, 'idle', NULL, ?, ?, ?)
    `).run(newSessionId, `NEXUS Session ${new Date().toLocaleTimeString()}`, settingsJson, now, now);

    logAuditAction(adminUserId, 'RESET_GAME', 'game_sessions', newSessionId);
    return db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(newSessionId) as GameSession;
  }

  /**
   * Submit an answer for a Level 1 question
   */
  static submitLevel1Answer(
    teamId: string,
    questionId: string,
    selectedAnswer: Level1AnswerChoice
  ): {
    is_correct: boolean;
    awarded_points: number;
    explanation: string | null;
    new_team_score: number;
  } {
    const db = getDb();
    const { session, activeRound } = this.getGameSession();

    if (!activeRound || activeRound.level !== 1 || activeRound.status !== 'active') {
      throw new Error('Level 1 is not currently active for answering.');
    }

    if (isRoundExpired(activeRound)) {
      throw new Error('The round time limit has expired. No further submissions are accepted.');
    }

    // Verify question is assigned to this team
    const assignment = db.prepare(`
      SELECT * FROM team_question_assignments 
      WHERE round_id = ? AND team_id = ? AND question_id = ?
    `).get(activeRound.id, teamId, questionId);

    if (!assignment) {
      throw new Error('This question is not assigned to your team.');
    }

    // Check for duplicate submission
    const existingAnswer = db.prepare(`
      SELECT * FROM team_answers 
      WHERE round_id = ? AND team_id = ? AND question_id = ?
    `).get(activeRound.id, teamId, questionId);

    if (existingAnswer) {
      throw new Error('You have already submitted an answer for this question.');
    }

    // Retrieve question data for authoritative evaluation
    const question = db.prepare('SELECT * FROM level1_questions WHERE id = ?').get(questionId) as Level1Question;
    if (!question) {
      throw new Error('Question not found in database.');
    }

    const { isCorrect, awardedPoints } = calculateLevel1Score(selectedAnswer, question);
    const answerId = uuidv4();
    const now = new Date().toISOString();

    let newScore = 0;

    const runTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO team_answers (
          id, round_id, team_id, question_id, selected_answer, is_correct, awarded_points, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(answerId, activeRound.id, teamId, questionId, selectedAnswer, isCorrect ? 1 : 0, awardedPoints, now);

      db.prepare(`
        UPDATE teams 
        SET level1_score = level1_score + ?, updated_at = ? 
        WHERE id = ?
      `).run(awardedPoints, now, teamId);

      const updatedTeam = db.prepare('SELECT level1_score FROM teams WHERE id = ?').get(teamId) as { level1_score: number };
      newScore = updatedTeam.level1_score;
    });

    runTransaction();

    return {
      is_correct: isCorrect,
      awarded_points: awardedPoints,
      explanation: question.explanation,
      new_team_score: newScore
    };
  }

  /**
   * Unlock a Level 2 clue using credits in an atomic transaction
   */
  static unlockLevel2Clue(
    teamId: string,
    clueId: string,
    operationId?: string
  ): {
    clue: Clue;
    credits_spent: number;
    remaining_credits: number;
    already_unlocked: boolean;
  } {
    const db = getDb();
    const { session, activeRound } = this.getGameSession();

    if (!activeRound || activeRound.level !== 2 || activeRound.status !== 'active') {
      throw new Error('Level 2 is not currently active.');
    }

    if (isRoundExpired(activeRound)) {
      throw new Error('Level 2 time limit has expired.');
    }

    // Enforce the final-answer lock server-side: no spending after submission.
    if (this.isTeamLocked(activeRound.id, teamId)) {
      throw new Error('Your final answer has been submitted. Clue purchases are no longer available.');
    }

    const opId = operationId || uuidv4();

    // Fetch team & clue
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as Team | undefined;
    if (!team) throw new Error('Team not found.');

    const clue = db.prepare('SELECT * FROM clues WHERE id = ? AND is_active = 1').get(clueId) as Clue | undefined;
    if (!clue) throw new Error('Requested clue not found or inactive.');

    // Check if already unlocked (Idempotency)
    const existingUnlock = db.prepare(`
      SELECT * FROM clue_unlocks 
      WHERE round_id = ? AND team_id = ? AND clue_id = ?
    `).get(activeRound.id, teamId, clueId);

    if (existingUnlock) {
      return {
        clue,
        credits_spent: 0,
        remaining_credits: team.current_credits,
        already_unlocked: true
      };
    }

    // Verify credit balance
    if (team.current_credits < clue.credit_cost) {
      throw new Error(`Insufficient credits. Required: ${clue.credit_cost}, Available: ${team.current_credits}`);
    }

    const unlockId = uuidv4();
    const txId = uuidv4();
    const now = new Date().toISOString();
    let remainingCredits = team.current_credits - clue.credit_cost;

    const runTransaction = db.transaction(() => {
      // 1. Deduct credits
      db.prepare(`
        UPDATE teams 
        SET current_credits = current_credits - ?, updated_at = ? 
        WHERE id = ?
      `).run(clue.credit_cost, now, teamId);

      // 2. Record clue unlock
      db.prepare(`
        INSERT INTO clue_unlocks (id, round_id, team_id, clue_id, credits_spent, unlocked_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(unlockId, activeRound.id, teamId, clueId, clue.credit_cost, now);

      // 3. Record immutable credit ledger transaction
      db.prepare(`
        INSERT INTO credit_transactions (id, round_id, team_id, clue_id, amount, transaction_type, operation_id, created_at)
        VALUES (?, ?, ?, ?, ?, 'clue_unlock', ?, ?)
      `).run(txId, activeRound.id, teamId, clueId, -clue.credit_cost, opId, now);
    });

    runTransaction();

    return {
      clue,
      credits_spent: clue.credit_cost,
      remaining_credits: remainingCredits,
      already_unlocked: false
    };
  }

  /**
   * Submit the team's ONE irreversible final answer for Round 2.
   *
   * TechBrains rule: exactly one submission per team. Once submitted the answer
   * is immutable — enforced here in the service layer, backed by the
   * trg_conclusions_immutable_after_submit database trigger (defense in depth).
   * There is no draft/update/resubmit path.
   */
  static submitConclusion(teamId: string, text: string): Conclusion {
    const db = getDb();
    const { activeRound } = this.getGameSession();

    if (!activeRound || activeRound.level !== 2 || activeRound.status !== 'active') {
      throw new Error('Level 2 is not currently active for final submission.');
    }
    if (isRoundExpired(activeRound)) {
      throw new Error('Level 2 time limit has expired. No further submissions are accepted.');
    }

    const trimmed = text.trim();
    if (trimmed.length < 10) {
      throw new Error('Final answer must be at least 10 characters long.');
    }

    // Any existing conclusion row means the team has already made its one
    // irreversible submission — reject outright (no edits, no resubmission).
    const existing = db.prepare(`
      SELECT id, status FROM conclusions WHERE round_id = ? AND team_id = ?
    `).get(activeRound.id, teamId) as { id: string; status: string } | undefined;

    if (existing) {
      throw new Error('Your final answer has already been submitted and cannot be changed.');
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    // Insert directly as 'submitted'. A pending evaluation record is created so
    // the admin queue reflects it immediately (populated by the AI evaluator).
    const runTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO conclusions (id, round_id, team_id, conclusion_text, status, submitted_at, updated_at)
        VALUES (?, ?, ?, ?, 'submitted', ?, ?)
      `).run(id, activeRound.id, teamId, trimmed, now, now);

      const settings = JSON.parse(this.getGameSession().session.settings_json);
      const maxScore = settings.round2MaxScore ?? 20;
      db.prepare(`
        INSERT INTO case_evaluations (id, conclusion_id, status, max_score, source, is_overridden, attempt_count, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, 'ai', 0, 0, ?, ?)
      `).run(uuidv4(), id, maxScore, now, now);
    });
    runTransaction();

    return db.prepare('SELECT * FROM conclusions WHERE id = ?').get(id) as Conclusion;
  }

  /**
   * Ensure a case_evaluations row exists for a conclusion (idempotent).
   */
  private static ensureEvaluationRow(conclusionId: string, maxScore: number): CaseEvaluation {
    const db = getDb();
    let row = db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(conclusionId) as CaseEvaluation | undefined;
    if (!row) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO case_evaluations (id, conclusion_id, status, max_score, source, is_overridden, attempt_count, created_at, updated_at)
        VALUES (?, ?, 'pending', ?, 'ai', 0, 0, ?, ?)
      `).run(uuidv4(), conclusionId, maxScore, now, now);
      row = db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(conclusionId) as CaseEvaluation;
    }
    return row;
  }

  /**
   * Run (or re-run) the AI evaluation for a submitted final answer.
   *
   * The submission itself is never mutated. On success the evaluation is stored
   * as 'completed' and becomes the authoritative Round 2 score (unless a manual
   * override already exists). On failure the evaluation is marked 'failed' with
   * an error message and the submission is preserved for admin retry/override.
   */
  static async runAiEvaluation(conclusionId: string): Promise<CaseEvaluation> {
    const db = getDb();
    const conclusion = db.prepare('SELECT * FROM conclusions WHERE id = ?').get(conclusionId) as Conclusion | undefined;
    if (!conclusion) throw new Error('Conclusion not found.');

    const activeCase = db.prepare('SELECT * FROM level2_cases WHERE is_active = 1 LIMIT 1').get() as Level2Case | undefined;
    const { settings } = this.getGameSession();
    const maxScore = settings.round2MaxScore ?? 20;

    const existing = this.ensureEvaluationRow(conclusionId, maxScore);

    // Never overwrite a manual admin override with an automated run.
    if (existing.is_overridden === 1) {
      return existing;
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE case_evaluations SET status = 'pending', error_message = NULL, attempt_count = attempt_count + 1, updated_at = ? WHERE conclusion_id = ?`)
      .run(now, conclusionId);

    try {
      const result = await evaluateCaseAnswer({
        caseTitle: activeCase?.title || 'Case',
        caseSituation: activeCase?.situation_description || '',
        referenceAnswer: activeCase?.reference_answer ?? null,
        evaluationGuidance: activeCase?.evaluation_guidance ?? null,
        teamAnswer: conclusion.conclusion_text,
        maxScore
      });

      const doneAt = new Date().toISOString();
      const tx = db.transaction(() => {
        db.prepare(`
          UPDATE case_evaluations
          SET status = 'completed', score = ?, max_score = ?, verdict = ?, reasoning = ?,
              provider = ?, model = ?, source = 'ai', is_overridden = 0, error_message = NULL, updated_at = ?
          WHERE conclusion_id = ?
        `).run(result.score, maxScore, result.verdict, result.reasoning, result.provider, result.model, doneAt, conclusionId);

        db.prepare(`UPDATE teams SET level2_score = ?, updated_at = ? WHERE id = ?`)
          .run(result.score, doneAt, conclusion.team_id);
      });
      tx();

      logAuditAction(null, 'AI_EVALUATION_COMPLETED', 'case_evaluations', conclusionId, {
        teamId: conclusion.team_id, score: result.score, provider: result.provider
      });
    } catch (err: any) {
      const failAt = new Date().toISOString();
      db.prepare(`UPDATE case_evaluations SET status = 'failed', error_message = ?, updated_at = ? WHERE conclusion_id = ?`)
        .run(String(err?.message || err).slice(0, 500), failAt, conclusionId);
      logAuditAction(null, 'AI_EVALUATION_FAILED', 'case_evaluations', conclusionId, {
        teamId: conclusion.team_id, error: String(err?.message || err).slice(0, 200)
      });
    }

    return db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(conclusionId) as CaseEvaluation;
  }

  /**
   * Fire-and-forget automatic evaluation used right after a submission.
   * Only runs when an AI provider is actually configured.
   */
  static autoEvaluate(conclusionId: string): void {
    if (!isAiConfigured()) return;
    this.runAiEvaluation(conclusionId).catch((err) => {
      console.error('[GameService] autoEvaluate failed:', err?.message || err);
    });
  }

  /**
   * Admin manual evaluation / override. This is the authoritative source of
   * truth whenever present and is never overwritten by a later AI run.
   */
  static overrideEvaluation(
    adminUserId: string,
    conclusionId: string,
    score: number,
    verdict: string,
    reasoning: string | null
  ): CaseEvaluation {
    const db = getDb();
    const conclusion = db.prepare('SELECT * FROM conclusions WHERE id = ?').get(conclusionId) as Conclusion | undefined;
    if (!conclusion) throw new Error('Conclusion not found.');

    const { settings } = this.getGameSession();
    const maxScore = settings.round2MaxScore ?? 20;
    this.ensureEvaluationRow(conclusionId, maxScore);

    const clamped = Math.max(0, Math.min(maxScore, Math.round(score * 100) / 100));
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE case_evaluations
        SET status = 'completed', score = ?, max_score = ?, verdict = ?, reasoning = ?,
            source = 'manual', is_overridden = 1, evaluator_id = ?, error_message = NULL, updated_at = ?
        WHERE conclusion_id = ?
      `).run(clamped, maxScore, verdict, reasoning, adminUserId, now, conclusionId);

      db.prepare(`UPDATE teams SET level2_score = ?, updated_at = ? WHERE id = ?`)
        .run(clamped, now, conclusion.team_id);
    });
    tx();

    logAuditAction(adminUserId, 'EVALUATION_OVERRIDE', 'case_evaluations', conclusionId, {
      teamId: conclusion.team_id, score: clamped
    });

    return db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(conclusionId) as CaseEvaluation;
  }

  /**
   * Returns true once a team has made its one irreversible final submission.
   * This is the single source of truth for the Round 2 post-submission lock.
   */
  static isTeamLocked(roundId: string, teamId: string): boolean {
    const db = getDb();
    const row = db.prepare(
      `SELECT status FROM conclusions WHERE round_id = ? AND team_id = ?`
    ).get(roundId, teamId) as { status: string } | undefined;
    return row?.status === 'submitted';
  }

  /**
   * Compute the authoritative media viewing state for a team.
   *
   * The initial free viewing window runs from the round start for
   * `viewing_duration_seconds`. After it elapses the media is hidden; each paid
   * replay re-opens a fresh window of the same duration from the replay time.
   * All timestamps are server-derived so the state survives refresh/reconnect.
   */
  static computeCaseMediaState(
    round: Round,
    teamId: string,
    activeCase: Level2Case,
    isLocked: boolean
  ): NonNullable<TeamPrivateState['level2']>['media'] {
    const db = getDb();
    const durationSec = activeCase.viewing_duration_seconds ?? 0;
    const nowMs = Date.now();
    const initialEndsMs = new Date(round.started_at).getTime() + durationSec * 1000;

    const replays = db.prepare(
      `SELECT created_at FROM media_replays WHERE round_id = ? AND team_id = ? ORDER BY created_at DESC`
    ).all(round.id, teamId) as { created_at: string }[];

    let viewingEndsMs = initialEndsMs;
    if (replays.length > 0) {
      const lastReplayWindowEnd = new Date(replays[0].created_at).getTime() + durationSec * 1000;
      viewingEndsMs = Math.max(viewingEndsMs, lastReplayWindowEnd);
    }

    const initialWindowElapsed = nowMs >= initialEndsMs;
    // Media is never visible once the team has locked in its final answer.
    const isVisible = !isLocked && nowMs < viewingEndsMs;

    let items: ClientCaseMedia[] = [];
    if (isVisible) {
      const rows = db.prepare(
        `SELECT * FROM case_media WHERE case_id = ? ORDER BY display_order ASC`
      ).all(activeCase.id) as CaseMedia[];
      if (rows.length > 0) {
        items = rows.map((m) => ({
          id: m.id,
          media_type: m.media_type,
          media_path: m.media_path,
          caption: m.caption,
          display_order: m.display_order
        }));
      } else if (activeCase.media_path) {
        // Legacy single-asset fallback.
        items = [{
          id: `legacy-${activeCase.id}`,
          media_type: 'image',
          media_path: activeCase.media_path,
          caption: null,
          display_order: 1
        }];
      }
    }

    return {
      is_visible: isVisible,
      initial_window_elapsed: initialWindowElapsed,
      viewing_ends_at: isVisible ? new Date(viewingEndsMs).toISOString() : null,
      viewing_duration_seconds: durationSec,
      replay_cost: activeCase.replay_cost ?? 0,
      replay_count: replays.length,
      items
    };
  }

  /**
   * Spend credits to replay the case media (TechBrains Round 2).
   *
   * Server-authoritative and idempotent: a given operation_id is charged at most
   * once (UNIQUE(team_id, operation_id) on both media_replays and
   * credit_transactions), so double-clicks / retries / refreshes never
   * double-charge. Rejected after the final answer is submitted.
   */
  static replayCaseMedia(
    teamId: string,
    operationId: string
  ): {
    credits_spent: number;
    remaining_credits: number;
    replay_count: number;
    viewing_ends_at: string;
    already_charged: boolean;
    already_visible: boolean;
  } {
    const db = getDb();
    const { activeRound } = this.getGameSession();

    if (!activeRound || activeRound.level !== 2 || activeRound.status !== 'active') {
      throw new Error('Level 2 is not currently active.');
    }
    if (isRoundExpired(activeRound)) {
      throw new Error('Level 2 time limit has expired.');
    }

    // Enforce the final-answer lock server-side.
    if (this.isTeamLocked(activeRound.id, teamId)) {
      throw new Error('Your final answer has been submitted. Replay is no longer available.');
    }

    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as Team | undefined;
    if (!team) throw new Error('Team not found.');

    const activeCase = db.prepare('SELECT * FROM level2_cases WHERE is_active = 1 LIMIT 1').get() as Level2Case | undefined;
    if (!activeCase) throw new Error('No active case found.');

    // Idempotency: if this exact operation was already recorded, return it as-is.
    const existing = db.prepare(
      `SELECT * FROM media_replays WHERE team_id = ? AND operation_id = ?`
    ).get(teamId, operationId) as MediaReplay | undefined;
    if (existing) {
      const mediaState = this.computeCaseMediaState(activeRound, teamId, activeCase, false);
      return {
        credits_spent: 0,
        remaining_credits: team.current_credits,
        replay_count: mediaState.replay_count,
        viewing_ends_at: mediaState.viewing_ends_at || new Date().toISOString(),
        already_charged: true,
        already_visible: false
      };
    }

    // If media is currently visible (initial window or an active replay window),
    // there is no need to charge again.
    const currentState = this.computeCaseMediaState(activeRound, teamId, activeCase, false);
    if (currentState.is_visible) {
      return {
        credits_spent: 0,
        remaining_credits: team.current_credits,
        replay_count: currentState.replay_count,
        viewing_ends_at: currentState.viewing_ends_at!,
        already_charged: false,
        already_visible: true
      };
    }

    const cost = activeCase.replay_cost ?? 0;
    if (team.current_credits < cost) {
      throw new Error(`Insufficient credits. Replay costs ${cost}, you have ${team.current_credits}.`);
    }

    const replayId = uuidv4();
    const txId = uuidv4();
    const now = new Date().toISOString();
    const remainingCredits = team.current_credits - cost;

    const runTransaction = db.transaction(() => {
      db.prepare(`UPDATE teams SET current_credits = current_credits - ?, updated_at = ? WHERE id = ?`)
        .run(cost, now, teamId);

      db.prepare(`
        INSERT INTO media_replays (id, round_id, team_id, case_id, credits_spent, operation_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(replayId, activeRound.id, teamId, activeCase.id, cost, operationId, now);

      db.prepare(`
        INSERT INTO credit_transactions (id, round_id, team_id, clue_id, amount, transaction_type, operation_id, created_at)
        VALUES (?, ?, ?, NULL, ?, 'media_replay', ?, ?)
      `).run(txId, activeRound.id, teamId, -cost, operationId, now);
    });
    runTransaction();

    const newState = this.computeCaseMediaState(activeRound, teamId, activeCase, false);
    return {
      credits_spent: cost,
      remaining_credits: remainingCredits,
      replay_count: newState.replay_count,
      viewing_ends_at: newState.viewing_ends_at!,
      already_charged: false,
      already_visible: false
    };
  }

  /**
   * Assemble Public Game State for broadcast / sync
   */
  static getPublicGameState(): PublicGameState {
    const { session, settings, activeRound } = this.getGameSession();
    const timerState = getAuthoritativeTimerState(activeRound);

    return {
      session_id: session.id,
      status: session.status,
      current_level: session.current_level,
      round: timerState ? {
        id: timerState.round_id,
        level: timerState.level,
        status: timerState.status,
        deadline_at: timerState.deadline_at,
        remaining_seconds: timerState.remaining_seconds,
        is_paused: timerState.is_paused
      } : null,
      settings,
      server_time: new Date().toISOString()
    };
  }

  /**
   * Assemble private state for a specific team (progress, clues, private credits)
   */
  static getTeamPrivateState(teamId: string): TeamPrivateState {
    const db = getDb();
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as Team;
    if (!team) throw new Error('Team not found.');

    const { session, activeRound } = this.getGameSession();

    let level1State: TeamPrivateState['level1'] = undefined;
    let level2State: TeamPrivateState['level2'] = undefined;

    // Build Level 1 private state
    if (activeRound && activeRound.level === 1) {
      this.ensureTeamQuestionsAssigned(activeRound.id, teamId);
      const assignments = db.prepare(`
        SELECT 
          tqa.question_order,
          q.id, q.title, q.prompt, q.content_type, q.media_path, q.category, q.difficulty,
          ta.selected_answer, ta.awarded_points,
          CASE WHEN ta.id IS NOT NULL THEN 1 ELSE 0 END as is_answered
        FROM team_question_assignments tqa
        JOIN level1_questions q ON q.id = tqa.question_id
        LEFT JOIN team_answers ta ON ta.round_id = tqa.round_id AND ta.team_id = tqa.team_id AND ta.question_id = q.id
        WHERE tqa.round_id = ? AND tqa.team_id = ?
        ORDER BY tqa.question_order ASC
      `).all(activeRound.id, teamId) as any[];

      const totalAssigned = assignments.length;
      const answeredList = assignments.filter((a) => a.is_answered === 1);
      const nextUnanswered = assignments.find((a) => a.is_answered === 0);

      // Safe client payload: never leaks correct_answer or explanation
      const currentQuestion: ClientLevel1Question | null = nextUnanswered ? {
        id: nextUnanswered.id,
        title: nextUnanswered.title,
        prompt: nextUnanswered.prompt,
        content_type: nextUnanswered.content_type,
        media_path: nextUnanswered.media_path,
        category: nextUnanswered.category,
        difficulty: nextUnanswered.difficulty,
        question_order: nextUnanswered.question_order,
        total_questions: totalAssigned,
        is_answered: false
      } : (assignments.length > 0 ? {
        id: assignments[assignments.length - 1].id,
        title: assignments[assignments.length - 1].title,
        prompt: assignments[assignments.length - 1].prompt,
        content_type: assignments[assignments.length - 1].content_type,
        media_path: assignments[assignments.length - 1].media_path,
        category: assignments[assignments.length - 1].category,
        difficulty: assignments[assignments.length - 1].difficulty,
        question_order: assignments[assignments.length - 1].question_order,
        total_questions: totalAssigned,
        is_answered: true,
        selected_answer: assignments[assignments.length - 1].selected_answer,
        awarded_points: assignments[assignments.length - 1].awarded_points
      } : null);

      level1State = {
        current_question: currentQuestion,
        answered_count: answeredList.length,
        total_assigned: totalAssigned,
        is_completed: answeredList.length === totalAssigned && totalAssigned > 0
      };
    }

    // Build Level 2 private state
    if (activeRound && activeRound.level === 2) {
      const activeCase = db.prepare('SELECT * FROM level2_cases WHERE is_active = 1 LIMIT 1').get() as Level2Case | undefined;
      let clientClues: ClientClue[] = [];

      const conclusion = db.prepare('SELECT * FROM conclusions WHERE round_id = ? AND team_id = ?').get(activeRound.id, teamId) as Conclusion | undefined;
      const isLocked = conclusion?.status === 'submitted';

      if (activeCase) {
        const allClues = db.prepare('SELECT * FROM clues WHERE case_id = ? AND is_active = 1 ORDER BY display_order ASC').all(activeCase.id) as Clue[];
        const unlocks = db.prepare('SELECT clue_id, unlocked_at FROM clue_unlocks WHERE round_id = ? AND team_id = ?').all(activeRound.id, teamId) as { clue_id: string; unlocked_at: string }[];
        const unlockedMap = new Map(unlocks.map((u) => [u.clue_id, u.unlocked_at]));

        // Clues are TEXT ONLY in TechBrains — no media_path is ever exposed.
        clientClues = allClues.map((c) => {
          const isUnlocked = unlockedMap.has(c.id);
          return {
            id: c.id,
            title: c.title,
            credit_cost: c.credit_cost,
            display_order: c.display_order,
            is_unlocked: isUnlocked,
            content: isUnlocked ? c.content : undefined, // Never leak locked content
            unlocked_at: unlockedMap.get(c.id)
          };
        });
      }

      const mediaState = activeCase
        ? this.computeCaseMediaState(activeRound, teamId, activeCase, isLocked)
        : {
            is_visible: false,
            initial_window_elapsed: true,
            viewing_ends_at: null,
            viewing_duration_seconds: 0,
            replay_cost: 0,
            replay_count: 0,
            items: []
          };

      const evalRow = conclusion
        ? (db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(conclusion.id) as CaseEvaluation | undefined)
        : undefined;

      level2State = {
        case: activeCase ? {
          id: activeCase.id,
          title: activeCase.title,
          situation_description: activeCase.situation_description,
          initial_credits: activeCase.initial_credits
        } : null,
        media: mediaState,
        clues: clientClues,
        is_locked: isLocked,
        conclusion: conclusion ? {
          text: conclusion.conclusion_text,
          status: conclusion.status,
          submitted_at: conclusion.submitted_at
        } : null,
        evaluation: evalRow ? {
          status: evalRow.status,
          score: evalRow.score,
          max_score: evalRow.max_score,
          verdict: evalRow.verdict,
          reasoning: evalRow.reasoning,
          is_overridden: evalRow.is_overridden === 1
        } : null
      };
    }

    return {
      team: {
        id: team.id,
        team_name: team.team_name,
        current_credits: team.current_credits,
        level1_score: team.level1_score,
        level2_score: team.level2_score
      },
      level1: level1State,
      level2: level2State
    };
  }

  /**
   * Get the current leaderboard
   */
  static getLeaderboard() {
    const { session, settings } = this.getGameSession();
    return calculateAuthoritativeLeaderboard(session.id, settings);
  }
}

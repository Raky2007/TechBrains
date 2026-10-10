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
  TeamPrivateState,
  TeamStage,
  Level2Q1Result,
  Level2Q2Result,
  Level2Q2Evaluation,
  Level2QuestionSubmission
} from '@nexus/shared';
import { calculateLevel1Score, calculateAuthoritativeLeaderboard } from './scoringService.js';
import { isRoundExpired, getAuthoritativeTimerState } from './timerService.js';
import { logAuditAction } from './auditService.js';
import { evaluateCaseAnswer, isAiConfigured, EvaluationResult } from './aiEvaluationService.js';

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
      `).run(sessionId, 'TechBrains Championship Session', settingsJson, now, now);

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

    const nowMs = Date.now();
    const startedAt = new Date(nowMs).toISOString();

    // TechBrains Round 1 has NO separate overall timer: its total duration is
    // the sum of each active question's individual timer. We still store a
    // round deadline as a generous backstop (sum of timers + buffer) so the
    // existing authoritative ticker / startup-recovery can finalize an
    // abandoned round, but participant timing is governed per-question.
    // Round 2 keeps its configured overall duration.
    let totalSeconds: number;
    if (level === 1) {
      const sumRow = db
        .prepare('SELECT COALESCE(SUM(time_limit_seconds), 0) as total FROM level1_questions WHERE is_active = 1')
        .get() as { total: number };
      // +60s buffer absorbs per-question serve latency and inter-question gaps.
      totalSeconds = Math.max(60, sumRow.total + 60);
    } else {
      totalSeconds = settings.level2DurationMinutes * 60;
    }

    const deadlineAt = new Date(nowMs + totalSeconds * 1000).toISOString();
    const roundId = uuidv4();
    const remainingSeconds = totalSeconds;
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

    logAuditAction(adminUserId, `START_LEVEL_${level}`, 'rounds', roundId, { startedAt, deadlineAt, totalSeconds });

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
   * End a round explicitly or automatically upon expiration.
   * Supports exact round targeting via optional targetRoundId.
   */
  static endRound(
    adminUserId: string | null,
    level: 1 | 2,
    targetRoundId?: string
  ): { round: Round; session: GameSession } {
    const db = getDb();
    const { session } = this.getGameSession();

    let round: Round | undefined;

    if (targetRoundId) {
      // Exact round targeting: must match the target ID, requested level, active session, and eligible status
      round = db.prepare(`
        SELECT * FROM rounds 
        WHERE id = ? AND game_session_id = ? AND level = ? AND status IN ('active', 'paused')
      `).get(targetRoundId, session.id, level) as Round | undefined;

      if (!round) {
        throw new Error(
          `Target round "${targetRoundId}" is not an active or paused Level ${level} round in the current session.`
        );
      }
    } else {
      round = db.prepare(`
        SELECT * FROM rounds 
        WHERE game_session_id = ? AND level = ? AND status IN ('active', 'paused')
        ORDER BY created_at DESC LIMIT 1
      `).get(session.id, level) as Round | undefined;

      if (!round) {
        throw new Error(`No active or paused round found for Level ${level} to end.`);
      }
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
            SELECT COALESCE(SUM(MAX(0, awarded_points)), 0) 
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
   * Reset game session cleanly.
   * Closes obsolete active or paused rounds belonging to the session being reset.
   */
  static resetGame(adminUserId: string): GameSession {
    const db = getDb();
    const newSessionId = uuidv4();
    const now = new Date().toISOString();
    const settingsJson = JSON.stringify(CONFIG.DEFAULT_SETTINGS);

    const runTransaction = db.transaction(() => {
      // Close any active or paused rounds so they cannot linger as active in the background
      db.prepare(`
        UPDATE rounds 
        SET status = 'ended', ended_at = ? 
        WHERE status IN ('active', 'paused')
      `).run(now);

      db.prepare(`
        INSERT INTO game_sessions (id, name, status, current_level, settings_json, created_at, updated_at)
        VALUES (?, ?, 'idle', NULL, ?, ?, ?)
      `).run(newSessionId, `TechBrains Session ${new Date().toLocaleTimeString()}`, settingsJson, now, now);
    });

    runTransaction();

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
    correct_answer: Level1AnswerChoice;
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
    `).get(activeRound.id, teamId, questionId) as { id: string; served_at: string | null; deadline_at: string | null } | undefined;

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

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();

    // Per-question server-authoritative timeout. If the question was already
    // served and its deadline has passed, it is a timeout (0 points, no row)
    // and can never be answered afterward. If it was never served (e.g. a
    // very fast client that submits before fetching state), serve it now so a
    // legitimate first answer is accepted.
    if (assignment.served_at && assignment.deadline_at) {
      if (nowMs > new Date(assignment.deadline_at).getTime()) {
        throw new Error('Time is up for this question. It has timed out and can no longer be answered.');
      }
    } else {
      // Retrieve the per-question timer to establish the deadline on first touch.
      const q = db.prepare('SELECT time_limit_seconds FROM level1_questions WHERE id = ?').get(questionId) as { time_limit_seconds: number } | undefined;
      const limit = q?.time_limit_seconds ?? 30;
      const deadlineIso = new Date(nowMs + limit * 1000).toISOString();
      db.prepare('UPDATE team_question_assignments SET served_at = ?, deadline_at = ? WHERE id = ?').run(now, deadlineIso, assignment.id);
    }

    // Retrieve question data for authoritative evaluation
    const question = db.prepare('SELECT * FROM level1_questions WHERE id = ?').get(questionId) as Level1Question;
    if (!question) {
      throw new Error('Question not found in database.');
    }

    const { isCorrect, awardedPoints } = calculateLevel1Score(selectedAnswer, question);
    const answerId = uuidv4();

    let newScore = 0;

    const runTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO team_answers (
          id, round_id, team_id, question_id, selected_answer, is_correct, awarded_points, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(answerId, activeRound.id, teamId, questionId, selectedAnswer, isCorrect ? 1 : 0, awardedPoints, now);

      db.prepare(`
        UPDATE teams
        SET level1_score = MAX(0, level1_score + ?), updated_at = ?
        WHERE id = ?
      `).run(awardedPoints, now, teamId);

      const updatedTeam = db.prepare('SELECT level1_score FROM teams WHERE id = ?').get(teamId) as { level1_score: number };
      newScore = updatedTeam.level1_score;
    });

    runTransaction();

    // Safe to reveal the correct answer now — ONLY to this team, in direct
    // response to its own accepted submission (never before, never to others).
    return {
      is_correct: isCorrect,
      awarded_points: awardedPoints,
      explanation: question.explanation,
      correct_answer: question.correct_answer,
      new_team_score: newScore
    };
  }

  /**
   * Unlock a Level 2 clue using level-specific credits in an atomic transaction
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

    // Round 1 cutoff qualification is enforced here, not just in the UI.
    this.assertRound2Qualified(teamId);

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

    const clue = db.prepare('SELECT * FROM clues WHERE id = ? AND is_active = 1').get(clueId) as Clue & { required_level: number } | undefined;
    if (!clue) throw new Error('Requested clue not found or inactive.');

    // Check if already unlocked (Idempotency)
    const existingUnlock = db.prepare(`
      SELECT * FROM clue_unlocks 
      WHERE round_id = ? AND team_id = ? AND clue_id = ?
    `).get(activeRound.id, teamId, clueId);

    if (existingUnlock) {
      // Return current balance for the required level
      const currentBalance = this.getLevelBalance(teamId, clue.required_level as 1 | 2) ?? team.current_credits;
      return {
        clue,
        credits_spent: 0,
        remaining_credits: currentBalance,
        already_unlocked: true
      };
    }

    // Initialize level credits if needed
    const requiredLevel = clue.required_level as 1 | 2;
    this.initLevelCredits(teamId, requiredLevel);
    
    // Get current balance from appropriate level pool
    const currentBalance = this.getLevelBalance(teamId, requiredLevel);
    if (currentBalance === null) {
      throw new Error(`Level ${requiredLevel} credits are not initialized for this team.`);
    }

    // Verify credit balance
    if (currentBalance < clue.credit_cost) {
      throw new Error(`Insufficient Level ${requiredLevel} credits. Required: ${clue.credit_cost}, Available: ${currentBalance}`);
    }

    // Use the level-specific spending method
    const spendResult = this.spendLevelCredits(teamId, requiredLevel, clue.credit_cost, opId, 'clue_unlock');
    
    if (!spendResult.charged) {
      // This shouldn't happen due to balance check above, but handle gracefully
      return {
        clue,
        credits_spent: 0,
        remaining_credits: spendResult.remaining,
        already_unlocked: false
      };
    }

    const unlockId = uuidv4();
    const now = new Date().toISOString();

    // Record clue unlock
    db.prepare(`
      INSERT INTO clue_unlocks (id, round_id, team_id, clue_id, credits_spent, unlocked_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(unlockId, activeRound.id, teamId, clueId, clue.credit_cost, now);

    return {
      clue,
      credits_spent: clue.credit_cost,
      remaining_credits: spendResult.remaining,
      already_unlocked: false
    };
  }

  /**
   * Question 1: Crack the Vault Keypad
   * Deterministic server-side validation (no AI model).
   * Awards 5 points for correct normalized PIN (0728, 728, 7:28), 0 points otherwise.
   */
  static submitLevel2Question1(teamId: string, pin: string): Level2Q1Result {
    const db = getDb();
    const { activeRound } = this.getGameSession();

    if (!activeRound || activeRound.level !== 2 || activeRound.status !== 'active') {
      throw new Error('Level 2 is not currently active for submission.');
    }

    this.assertRound2Qualified(teamId);

    if (isRoundExpired(activeRound)) {
      throw new Error('Level 2 time limit has expired. No further submissions are accepted.');
    }

    const trimmed = (pin ?? '').trim();
    if (!trimmed) {
      throw new Error('Please enter a PIN to submit.');
    }

    // Check if Question 1 has already been submitted
    const existing = db.prepare(`
      SELECT * FROM level2_question_submissions
      WHERE round_id = ? AND team_id = ? AND question_number = 1
    `).get(activeRound.id, teamId) as Level2QuestionSubmission | undefined;

    if (existing) {
      throw new Error('Question 1 has already been submitted and cannot be changed.');
    }

    const isCorrect = isVaultPinCorrect(trimmed);
    const score = isCorrect ? 5 : 0;
    const normalized = normalizeVaultPin(trimmed);
    const id = uuidv4();
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO level2_question_submissions (
          id, round_id, team_id, question_number, pin_submitted, pin_normalized,
          is_correct, selected_suspect, explanation, score, max_score,
          evaluation_status, evaluation_data_json, submitted_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, NULL, ?, 5, 'completed', NULL, ?, ?)
      `).run(id, activeRound.id, teamId, trimmed, normalized, isCorrect ? 1 : 0, score, now, now);

      db.prepare(`
        UPDATE teams
        SET level2_score = (
          SELECT COALESCE(SUM(score), 0)
          FROM level2_question_submissions
          WHERE team_id = ? AND round_id = ?
        ), updated_at = ?
        WHERE id = ?
      `).run(teamId, activeRound.id, now, teamId);
    });
    tx();

    logAuditAction(null, 'LEVEL2_Q1_SUBMITTED', 'level2_question_submissions', id, {
      teamId,
      isCorrect,
      score
    });

    return {
      is_submitted: true,
      submitted_pin: trimmed,
      is_correct: isCorrect,
      score,
      max_score: 5,
      submitted_at: now
    };
  }

  /**
   * Question 2: Who Took ORION? (Suspect identification & reasoning)
   * Evaluated via NVIDIA Nemotron / AI provider (max 5 points).
   */
  static async submitLevel2Question2(
    teamId: string,
    selectedSuspect: string,
    explanation: string
  ): Promise<Level2Q2Result> {
    const db = getDb();
    const { activeRound } = this.getGameSession();

    if (!activeRound || activeRound.level !== 2 || activeRound.status !== 'active') {
      throw new Error('Level 2 is not currently active for submission.');
    }

    this.assertRound2Qualified(teamId);

    if (isRoundExpired(activeRound)) {
      throw new Error('Level 2 time limit has expired. No further submissions are accepted.');
    }

    const trimmedSuspect = (selectedSuspect ?? '').trim();
    if (!trimmedSuspect) {
      throw new Error('Please select a suspect.');
    }

    const trimmedExp = (explanation ?? '').trim();
    if (trimmedExp.length < 10) {
      throw new Error('Explanation must be at least 10 characters long.');
    }

    // Check if Question 2 has already been submitted
    const existing = db.prepare(`
      SELECT * FROM level2_question_submissions
      WHERE round_id = ? AND team_id = ? AND question_number = 2
    `).get(activeRound.id, teamId) as Level2QuestionSubmission | undefined;

    if (existing) {
      throw new Error('Question 2 has already been submitted and cannot be changed.');
    }

    const subId = uuidv4();
    const now = new Date().toISOString();

    let conclusion = db.prepare(`
      SELECT * FROM conclusions WHERE round_id = ? AND team_id = ?
    `).get(activeRound.id, teamId) as Conclusion | undefined;

    const conclusionId = conclusion ? conclusion.id : uuidv4();

    // Insert pending submission into level2_question_submissions
    const initTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO level2_question_submissions (
          id, round_id, team_id, question_number, pin_submitted, pin_normalized,
          is_correct, selected_suspect, explanation, score, max_score,
          evaluation_status, evaluation_data_json, submitted_at, updated_at
        ) VALUES (?, ?, ?, 2, NULL, NULL, NULL, ?, ?, 0, 5, 'pending', NULL, ?, ?)
      `).run(subId, activeRound.id, teamId, trimmedSuspect, trimmedExp, now, now);

      if (!conclusion) {
        db.prepare(`
          INSERT INTO conclusions (
            id, round_id, team_id, conclusion_text, status,
            q2_selected_suspect, q2_explanation, submitted_at, updated_at
          ) VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?)
        `).run(
          conclusionId,
          activeRound.id,
          teamId,
          `Selected Suspect: ${trimmedSuspect}\n\nEvidence & Reasoning:\n${trimmedExp}`,
          trimmedSuspect,
          trimmedExp,
          now,
          now
        );

        db.prepare(`
          INSERT INTO case_evaluations (
            id, conclusion_id, status, max_score, source, is_overridden, attempt_count, created_at, updated_at
          ) VALUES (?, ?, 'pending', 5, 'ai', 0, 0, ?, ?)
        `).run(uuidv4(), conclusionId, now, now);
      }
    });
    initTx();

    const activeCase = db.prepare('SELECT * FROM level2_cases WHERE is_active = 1 LIMIT 1').get() as Level2Case | undefined;

    let evalResult: EvaluationResult;
    try {
      evalResult = await evaluateCaseAnswer({
        caseTitle: activeCase?.title || 'The Vanishing Prototype',
        caseSituation: activeCase?.situation_description || '',
        referenceAnswer: activeCase?.reference_answer ?? null,
        evaluationGuidance: activeCase?.evaluation_guidance ?? null,
        teamAnswer: trimmedExp,
        selectedSuspect: trimmedSuspect,
        explanation: trimmedExp,
        maxScore: 5
      });
    } catch (err: any) {
      const failAt = new Date().toISOString();
      const errorMsg = String(err?.message || err).slice(0, 500);

      db.prepare(`
        UPDATE level2_question_submissions
        SET evaluation_status = 'failed', updated_at = ?
        WHERE id = ?
      `).run(failAt, subId);

      db.prepare(`
        UPDATE case_evaluations
        SET status = 'failed', error_message = ?, updated_at = ?
        WHERE conclusion_id = ? AND is_overridden = 0
      `).run(errorMsg, failAt, conclusionId);

      logAuditAction(null, 'AI_EVALUATION_FAILED', 'level2_question_submissions', subId, {
        teamId, error: errorMsg
      });

      return {
        is_submitted: true,
        selected_suspect: trimmedSuspect,
        explanation: trimmedExp,
        score: 0,
        max_score: 5,
        evaluation: {
          score: 0,
          max_score: 5,
          selected_suspect_correct: trimmedSuspect.toLowerCase().includes('kabir'),
          closest_answer: 'Evaluation pending admin review.',
          accuracy_summary: 'Evaluation service temporarily unavailable.',
          matched_evidence: [],
          missing_evidence: [],
          feedback: 'Your submission has been safely recorded. An administrator will review your reasoning.',
          status: 'failed'
        },
        submitted_at: now
      };
    }

    const doneAt = new Date().toISOString();

    const saveTx = db.transaction(() => {
      // Check if admin manually overrode in the interim
      const currentEval = db.prepare(`SELECT is_overridden, score FROM case_evaluations WHERE conclusion_id = ?`).get(conclusionId) as any;
      if (currentEval?.is_overridden === 1) {
        return;
      }

      db.prepare(`
        UPDATE level2_question_submissions
        SET score = ?, evaluation_status = 'completed', evaluation_data_json = ?, updated_at = ?
        WHERE id = ?
      `).run(evalResult.score, JSON.stringify(evalResult), doneAt, subId);

      db.prepare(`
        UPDATE case_evaluations
        SET status = 'completed', score = ?, max_score = 5, verdict = ?, reasoning = ?,
            provider = ?, model = ?, source = 'ai', is_overridden = 0, error_message = NULL,
            q2_score = ?, q2_selected_suspect_correct = ?, q2_closest_answer = ?,
            q2_accuracy_summary = ?, q2_matched_evidence = ?, q2_missing_evidence = ?,
            q2_feedback = ?, updated_at = ?
        WHERE conclusion_id = ?
      `).run(
        evalResult.score,
        evalResult.verdict,
        evalResult.reasoning,
        evalResult.provider,
        evalResult.model,
        evalResult.score,
        evalResult.selected_suspect_correct ? 1 : 0,
        evalResult.closest_answer,
        evalResult.accuracy_summary,
        JSON.stringify(evalResult.matched_evidence),
        JSON.stringify(evalResult.missing_evidence),
        evalResult.feedback,
        doneAt,
        conclusionId
      );

      // Re-calculate team level2_score
      db.prepare(`
        UPDATE teams
        SET level2_score = (
          SELECT COALESCE(SUM(score), 0)
          FROM level2_question_submissions
          WHERE team_id = ? AND round_id = ?
        ), updated_at = ?
        WHERE id = ?
      `).run(teamId, activeRound.id, doneAt, teamId);
    });
    saveTx();

    logAuditAction(null, 'AI_EVALUATION_COMPLETED', 'level2_question_submissions', subId, {
      teamId, score: evalResult.score, provider: evalResult.provider
    });

    return {
      is_submitted: true,
      selected_suspect: trimmedSuspect,
      explanation: trimmedExp,
      score: evalResult.score,
      max_score: 5,
      evaluation: evalResult,
      submitted_at: now
    };
  }

  /**
   * Submit the team's ONE irreversible final answer for Round 2 (legacy backward compatibility).
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

    // Round 1 cutoff qualification is enforced here, not just in the UI.
    this.assertRound2Qualified(teamId);

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
    reasoning: string | null,
    q1ScoreOverride?: number
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
      const q1Sub = db.prepare('SELECT * FROM level2_question_submissions WHERE team_id = ? AND question_number = 1').get(conclusion.team_id) as Level2QuestionSubmission | undefined;
      const q2Sub = db.prepare('SELECT * FROM level2_question_submissions WHERE team_id = ? AND question_number = 2').get(conclusion.team_id) as Level2QuestionSubmission | undefined;

      let finalQ1 = q1Sub ? q1Sub.score : 0;
      if (q1ScoreOverride !== undefined) {
        finalQ1 = Math.max(0, Math.min(5, Math.round(q1ScoreOverride * 100) / 100));
        if (q1Sub) {
          db.prepare('UPDATE level2_question_submissions SET score = ?, is_correct = ?, updated_at = ? WHERE id = ?')
            .run(finalQ1, finalQ1 > 0 ? 1 : 0, now, q1Sub.id);
        }
      }

      const clampedQ2 = Math.min(5, clamped);
      if (q2Sub) {
        db.prepare('UPDATE level2_question_submissions SET score = ?, updated_at = ? WHERE id = ?')
          .run(clampedQ2, now, q2Sub.id);
      }

      const totalL2 = (q1Sub || q2Sub) ? (finalQ1 + clampedQ2) : clamped;

      db.prepare(`
        UPDATE case_evaluations
        SET status = 'completed', score = ?, max_score = ?, verdict = ?, reasoning = ?,
            source = 'manual', is_overridden = 1, evaluator_id = ?, error_message = NULL,
            q1_score = ?, q2_score = ?, updated_at = ?
        WHERE conclusion_id = ?
      `).run(clamped, maxScore, verdict, reasoning, adminUserId, finalQ1, clampedQ2, now, conclusionId);

      db.prepare(`UPDATE teams SET level2_score = ?, updated_at = ? WHERE id = ?`)
        .run(totalL2, now, conclusion.team_id);
    });
    tx();

    logAuditAction(adminUserId, 'EVALUATION_OVERRIDE', 'case_evaluations', conclusionId, {
      teamId: conclusion.team_id, score: clamped, q1Score: q1ScoreOverride
    });

    return db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(conclusionId) as CaseEvaluation;
  }

  /**
   * Returns true once a team has made its one irreversible final submission.
   * This is the single source of truth for the Round 2 post-submission lock.
   */
  static isTeamLocked(roundId: string, teamId: string): boolean {
    const db = getDb();
    const q2 = db.prepare(
      `SELECT id FROM level2_question_submissions WHERE round_id = ? AND team_id = ? AND question_number = 2`
    ).get(roundId, teamId);
    if (q2) return true;
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

    // Round 1 cutoff qualification is enforced here, not just in the UI.
    this.assertRound2Qualified(teamId);

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

    // Build Level 1 private state (per-question server-authoritative timing)
    if (activeRound && activeRound.level === 1) {
      this.ensureTeamQuestionsAssigned(activeRound.id, teamId);
      const assignments = db.prepare(`
        SELECT
          tqa.id as assignment_id, tqa.question_order, tqa.served_at, tqa.deadline_at,
          q.id, q.title, q.prompt, q.content_type, q.media_path, q.category, q.difficulty,
          q.time_limit_seconds, q.correct_answer,
          ta.selected_answer, ta.awarded_points,
          CASE WHEN ta.id IS NOT NULL THEN 1 ELSE 0 END as is_answered
        FROM team_question_assignments tqa
        JOIN level1_questions q ON q.id = tqa.question_id
        LEFT JOIN team_answers ta ON ta.round_id = tqa.round_id AND ta.team_id = tqa.team_id AND ta.question_id = q.id
        WHERE tqa.round_id = ? AND tqa.team_id = ?
        ORDER BY tqa.question_order ASC
      `).all(activeRound.id, teamId) as any[];

      const totalAssigned = assignments.length;
      const nowMs = Date.now();

      // A question is RESOLVED if it has been answered, or it was served and
      // its per-question deadline has passed (an authoritative timeout — worth
      // 0, with no team_answers row ever created). The CURRENT question is the
      // first unresolved assignment; on first delivery we stamp served_at and
      // compute its deadline. Timeouts need no write: they are implied by a
      // passed deadline, so a browser refresh can never "answer" them later.
      const isTimedOut = (a: any): boolean =>
        a.is_answered === 0 && !!a.served_at && !!a.deadline_at && nowMs > new Date(a.deadline_at).getTime();

      const answeredCount = assignments.filter((a) => a.is_answered === 1).length;

      let current: any = null;
      for (const a of assignments) {
        if (a.is_answered === 1) continue;
        if (isTimedOut(a)) continue;
        current = a;
        break;
      }

      // Serve the current question if it has not been served yet.
      if (current && !current.served_at) {
        const limit = current.time_limit_seconds || 30;
        const servedAt = new Date(nowMs).toISOString();
        const deadlineAt = new Date(nowMs + limit * 1000).toISOString();
        db.prepare('UPDATE team_question_assignments SET served_at = ?, deadline_at = ? WHERE id = ?')
          .run(servedAt, deadlineAt, current.assignment_id);
        current.served_at = servedAt;
        current.deadline_at = deadlineAt;
      }

      // resolved = answered + timed-out. Round 1 is complete for this team when
      // every assigned question is resolved (nothing left to serve).
      const resolvedCount = assignments.filter((a) => a.is_answered === 1 || isTimedOut(a)).length;

      // Safe client payload for the CURRENT question: never includes
      // correct_answer (it is only revealed in the submit response after the
      // answer is accepted).
      const currentQuestion: ClientLevel1Question | null = current ? {
        id: current.id,
        title: current.title,
        prompt: current.prompt,
        content_type: current.content_type,
        media_path: current.media_path,
        category: current.category,
        difficulty: current.difficulty,
        question_order: current.question_order,
        total_questions: totalAssigned,
        is_answered: false,
        time_limit_seconds: current.time_limit_seconds,
        deadline_at: current.deadline_at
      } : null;

      level1State = {
        current_question: currentQuestion,
        answered_count: answeredCount,
        total_assigned: totalAssigned,
        is_completed: totalAssigned > 0 && resolvedCount === totalAssigned,
        server_time: new Date(nowMs).toISOString()
      };
    }

    // Round 2 qualification (only meaningful once Round 1 has concluded).
    const { settings: liveSettings } = this.getGameSession();
    let round2Qualified: boolean | undefined = undefined;
    if (session.status !== 'idle' && session.status !== 'level1_active' && session.status !== 'level1_paused') {
      round2Qualified = this.isTeamQualifiedForRound2(team, liveSettings);
    }

    // Build Level 2 private state — ONLY for qualified teams. Unqualified teams
    // receive no case/clue/media data at all (server-side enforcement; the UI
    // block is not the security boundary).
    if (activeRound && activeRound.level === 2 && round2Qualified) {
      const activeCase = db.prepare('SELECT * FROM level2_cases WHERE is_active = 1 LIMIT 1').get() as Level2Case | undefined;
      let clientClues: ClientClue[] = [];

      const conclusion = db.prepare('SELECT * FROM conclusions WHERE round_id = ? AND team_id = ?').get(activeRound.id, teamId) as Conclusion | undefined;

      const q1Row = db.prepare(`
        SELECT * FROM level2_question_submissions
        WHERE round_id = ? AND team_id = ? AND question_number = 1
      `).get(activeRound.id, teamId) as Level2QuestionSubmission | undefined;

      const q2Row = db.prepare(`
        SELECT * FROM level2_question_submissions
        WHERE round_id = ? AND team_id = ? AND question_number = 2
      `).get(activeRound.id, teamId) as Level2QuestionSubmission | undefined;

      const isLocked = Boolean(
        (q2Row && (q2Row.evaluation_status === 'completed' || q2Row.evaluation_status === 'pending')) ||
        (conclusion && conclusion.status === 'submitted')
      );

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
            question_number: c.question_number,
            tier: c.tier,
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

      const q1Result: Level2Q1Result | undefined = q1Row ? {
        is_submitted: true,
        submitted_pin: q1Row.pin_submitted,
        is_correct: Boolean(q1Row.is_correct),
        score: q1Row.score,
        max_score: q1Row.max_score,
        submitted_at: q1Row.submitted_at
      } : undefined;

      let q2Eval: Level2Q2Evaluation | null = null;
      if (q2Row?.evaluation_data_json) {
        try {
          q2Eval = JSON.parse(q2Row.evaluation_data_json);
        } catch {
          q2Eval = null;
        }
      }

      const q2Result: Level2Q2Result | undefined = q2Row ? {
        is_submitted: true,
        selected_suspect: q2Row.selected_suspect,
        explanation: q2Row.explanation,
        score: q2Row.score,
        max_score: q2Row.max_score,
        evaluation: q2Eval,
        submitted_at: q2Row.submitted_at
      } : undefined;

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
        q1: q1Result,
        q2: q2Result,
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

    // Compute this TEAM's own navigation stage (server-authoritative). This is
    // derived only from the global event status + THIS team's own progress and
    // eligibility — never from any other team. Returned so the client can
    // navigate by the team's own stage instead of raw global status.
    const stage = this.computeTeamStage({
      status: session.status,
      resultsPublished: liveSettings.resultsPublished,
      teamCompletedRound1: level1State ? level1State.is_completed : false,
      qualified: round2Qualified
    });

    const levelCredits = this.getLevelBalance(team.id, 1);

    return {
      stage,
      team: {
        id: team.id,
        team_name: team.team_name,
        current_credits: levelCredits !== null ? levelCredits : team.current_credits,
        level1_score: team.level1_score,
        level2_score: team.level2_score
      },
      level1: level1State,
      round2_qualified: round2Qualified,
      round1_cutoff: liveSettings.round1CutoffScore,
      level2: level2State
    };
  }

  /**
   * Pure, team-specific stage resolver. Given the GLOBAL event status and THIS
   * team's own completion/qualification, decide where the team belongs. No
   * other team's state is consulted, so this can never cross-contaminate.
   */
  private static computeTeamStage(args: {
    status: GameSession['status'];
    resultsPublished: boolean;
    teamCompletedRound1: boolean;
    qualified: boolean | undefined;
  }): TeamStage {
    const { status, resultsPublished, teamCompletedRound1, qualified } = args;

    if (status === 'completed' || resultsPublished) return 'result';
    if (status === 'idle') return 'waiting';

    if (status === 'level1_active' || status === 'level1_paused') {
      // Only teams that have finished their OWN Round 1 see the done/celebration
      // stage; everyone else keeps playing Round 1 independently.
      return teamCompletedRound1 ? 'round1_done' : 'round1';
    }

    // Round 1 has ended globally: every team's Round 1 is finalized. Teams wait
    // (on their own completion screen) until the admin starts Round 2.
    if (status === 'level1_ended') return 'round1_done';

    if (status === 'level2_active' || status === 'level2_paused' || status === 'level2_ended') {
      // Round 2 can only start after Round 1 ended globally, so scores are final.
      // Entry is strictly per-team: qualified teams play Round 2; others are
      // held on a not-qualified screen (and the server rejects their R2 calls).
      return qualified ? 'round2' : 'not_qualified';
    }

    return 'waiting';
  }

  /**
   * Round 1 → Round 2 qualification check (server-authoritative).
   *
   * A team qualifies for Round 2 iff its Round 1 score meets the configured
   * cutoff. This is the single source of truth used both for building a team's
   * private state and for gating every Round 2 mutation endpoint.
   */
  static isTeamQualifiedForRound2(team: Team, settings: GameSettings): boolean {
    const cutoff = settings.round1CutoffScore ?? 0;
    return team.level1_score >= cutoff;
  }

  /**
   * Assert a team is qualified for Round 2, throwing otherwise. Used to guard
   * all Round 2 actions (clue unlock, media replay, final submission).
   */
  private static assertRound2Qualified(teamId: string): Team {
    const db = getDb();
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as Team | undefined;
    if (!team) throw new Error('Team not found.');
    const { settings } = this.getGameSession();
    if (!this.isTeamQualifiedForRound2(team, settings)) {
      throw new Error('Your team did not meet the Round 1 cutoff and is not qualified for Round 2.');
    }
    return team;
  }

  /**
   * Get the current leaderboard
   */
  static getLeaderboard(options: { includeBanned?: boolean } = {}) {
    const { session, settings } = this.getGameSession();
    return calculateAuthoritativeLeaderboard(session.id, settings, options);
  }

  /**
   * Get a single team's OWN result only.
   *
   * Privacy: participants must never see other teams' scores, rankings, or
   * global standings (TechBrains requirement). This returns the requesting
   * team's own score/status with the competitive `rank` stripped out so that
   * no information about other teams can be inferred. The full ranked
   * leaderboard remains admin-only.
   */
  static getTeamResult(teamId: string) {
    const db = getDb();
    const team = db.prepare('SELECT is_banned FROM teams WHERE id = ?').get(teamId) as any;
    if (team?.is_banned) {
      return null;
    }
    const { session, settings } = this.getGameSession();
    const entry = calculateAuthoritativeLeaderboard(session.id, settings, { includeBanned: false }).find(
      (e) => e.team_id === teamId
    );
    if (!entry) return null;
    // Deliberately omit `rank` — relative standing is not exposed to participants.
    const { rank, ...ownResult } = entry;
    return ownResult;
  }

  // ===================================================================== //
  // Round 2 two-level credit pools
  // Basic implementation without complex configuration system
  // ===================================================================== //

  /** The teams column holding a given level's balance. */
  private static levelCreditColumn(levelNo: 1 | 2): 'level1_credits' | 'level2_credits' {
    if (levelNo !== 1 && levelNo !== 2) throw new Error('Round 2 level must be 1 or 2.');
    return levelNo === 1 ? 'level1_credits' : 'level2_credits';
  }

  /** Current balance of a team's level pool, or null if not yet initialized. */
  static getLevelBalance(teamId: string, levelNo: 1 | 2): number | null {
    const db = getDb();
    const col = this.levelCreditColumn(levelNo);
    const row = db.prepare(`SELECT ${col} AS bal FROM teams WHERE id = ?`).get(teamId) as { bal: number | null } | undefined;
    if (!row) throw new Error('Team not found.');
    return row.bal;
  }

  /**
   * Initialize a team's level credit pool from default settings.
   * Simplified version that uses initialCredits from settings.
   */
  static initLevelCredits(teamId: string, levelNo: 1 | 2, startingCredits?: number): number {
    const db = getDb();
    const col = this.levelCreditColumn(levelNo);
    const current = this.getLevelBalance(teamId, levelNo);
    if (current !== null) return current; // already initialized → no-op

    // Use provided starting credits or default from settings
    const { settings } = this.getGameSession();
    const start = startingCredits ?? settings.initialCredits ?? 200;
    const now = new Date().toISOString();

    const res = db.prepare(`UPDATE teams SET ${col} = ?, updated_at = ? WHERE id = ? AND ${col} IS NULL`)
      .run(start, now, teamId);
    // If another concurrent call won the race, read back the value it set.
    if (res.changes === 0) return this.getLevelBalance(teamId, levelNo) as number;
    return start;
  }

  /**
   * Server-authoritative, atomic, idempotent debit from a team's level pool.
   * Simplified version for basic two-level credit functionality.
   */
  static spendLevelCredits(
    teamId: string,
    levelNo: 1 | 2,
    amount: number,
    operationId: string,
    transactionType: string
  ): { charged: boolean; remaining: number } {
    if (!Number.isInteger(amount) || amount < 0) throw new Error('Spend amount must be a non-negative integer.');
    if (!operationId || typeof operationId !== 'string') throw new Error('operation_id is required for a credit spend.');

    const db = getDb();
    const col = this.levelCreditColumn(levelNo);
    const { activeRound } = this.getGameSession();
    if (!activeRound || activeRound.level !== 2) {
      throw new Error('Round 2 is not active; credits cannot be spent.');
    }

    // Idempotency: this exact operation already applied?
    const prior = db.prepare('SELECT id FROM credit_transactions WHERE team_id = ? AND operation_id = ?')
      .get(teamId, operationId);
    if (prior) {
      return { charged: false, remaining: this.getLevelBalance(teamId, levelNo) as number };
    }

    const balance = this.getLevelBalance(teamId, levelNo);
    if (balance === null) throw new Error(`Level ${levelNo} credits are not initialized for this team.`);
    if (balance < amount) {
      throw new Error(`Insufficient Level ${levelNo} credits. Required: ${amount}, Available: ${balance}.`);
    }

    const now = new Date().toISOString();
    const txId = uuidv4();
    const run = db.transaction(() => {
      // Conditional, atomic debit — never allows a negative balance.
      const res = db.prepare(`UPDATE teams SET ${col} = ${col} - ?, updated_at = ? WHERE id = ? AND ${col} >= ?`)
        .run(amount, now, teamId, amount);
      if (res.changes === 0) throw new Error('Insufficient credits (balance changed concurrently).');
      
      // Ledger insert — UNIQUE(team_id, operation_id) prevents duplicates
      db.prepare(`
        INSERT INTO credit_transactions (id, round_id, team_id, clue_id, amount, transaction_type, operation_id, created_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
      `).run(txId, activeRound.id, teamId, -amount, transactionType, operationId, now);
    });
    run();

    return { charged: true, remaining: balance - amount };
  }
}

/**
 * Vault Keypad PIN Normalization and Validation (Question 1)
 * Expected answer: 0728
 * Acceptable formats: 0728, 728, 7:28 (spaces/dashes stripped).
 * Permutations (e.g. 2780, 8270) are rejected.
 */
export function normalizeVaultPin(input: string): string {
  if (!input || typeof input !== 'string') return '';
  const cleaned = input.trim().replace(/[\s\-:]/g, '');
  if (cleaned === '728') return '0728';
  return cleaned;
}

export function isVaultPinCorrect(input: string): boolean {
  return normalizeVaultPin(input) === '0728';
}


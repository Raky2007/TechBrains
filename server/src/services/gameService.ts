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
  Conclusion,
  Evaluation,
  Level1AnswerChoice,
  PublicGameState,
  TeamPrivateState
} from '@nexus/shared';
import { calculateLevel1Score, calculateAuthoritativeLeaderboard } from './scoringService.js';
import { isRoundExpired, getAuthoritativeTimerState } from './timerService.js';
import { logAuditAction } from './auditService.js';

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

    const settings: GameSettings = JSON.parse(session.settings_json);
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
   * Allows participants/teams to start a round directly without requiring admin intervention
   */
  static participantStartLevel(teamId: string, level: 1 | 2): { round: Round; session: GameSession } {
    const { session, activeRound } = this.getGameSession();

    if (level === 1) {
      if (activeRound && activeRound.level === 1) {
        this.ensureTeamQuestionsAssigned(activeRound.id, teamId);
        return { round: activeRound, session };
      }
      // If round 2 or previous round was running, conclude it and restart Level 1
      if (activeRound) {
        this.endRound(teamId, activeRound.level as 1 | 2);
      }
      const db = getDb();
      db.prepare("UPDATE game_sessions SET status = 'idle', current_level = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), session.id);
      const result = this.startRound(teamId, 1);
      this.ensureTeamQuestionsAssigned(result.round.id, teamId);
      return result;
    }

    if (level === 2) {
      if (activeRound && activeRound.level === 2) {
        return { round: activeRound, session };
      }
      if (activeRound && activeRound.level === 1) {
        this.endRound(teamId, 1);
      }
      const refreshed = this.getGameSession();
      if (refreshed.session.status !== 'level1_ended') {
        const db = getDb();
        db.prepare("UPDATE game_sessions SET status = 'level1_ended', current_level = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), session.id);
      }
      return this.startRound(teamId, 2);
    }

    throw new Error(`Cannot start Level ${level} from current session status: ${session.status}`);
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
   * Publish final leaderboard results
   */
  static publishFinalResults(adminUserId: string): GameSession {
    const db = getDb();
    const { session } = this.getGameSession();
    const now = new Date().toISOString();

    const settings = JSON.parse(session.settings_json);
    settings.resultsPublished = true;

    db.prepare(`
      UPDATE game_sessions 
      SET status = 'completed', settings_json = ?, updated_at = ? 
      WHERE id = ?
    `).run(JSON.stringify(settings), now, session.id);

    logAuditAction(adminUserId, 'PUBLISH_RESULTS', 'game_sessions', session.id);
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
   * Submit or update Level 2 conclusion
   */
  static submitConclusion(teamId: string, text: string): Conclusion {
    const db = getDb();
    const { session, activeRound } = this.getGameSession();

    if (!activeRound || activeRound.level !== 2) {
      throw new Error('Level 2 round is not active for conclusion submission.');
    }

    const trimmed = text.trim();
    if (trimmed.length < 10) {
      throw new Error('Conclusion must be at least 10 characters long.');
    }

    const existing = db.prepare(`
      SELECT * FROM conclusions 
      WHERE round_id = ? AND team_id = ?
    `).get(activeRound.id, teamId) as Conclusion | undefined;

    const now = new Date().toISOString();

    if (existing) {
      db.prepare(`
        UPDATE conclusions 
        SET conclusion_text = ?, status = 'submitted', submitted_at = ?, updated_at = ? 
        WHERE id = ?
      `).run(trimmed, now, now, existing.id);
      return db.prepare('SELECT * FROM conclusions WHERE id = ?').get(existing.id) as Conclusion;
    } else {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO conclusions (id, round_id, team_id, conclusion_text, status, submitted_at, updated_at)
        VALUES (?, ?, ?, ?, 'submitted', ?, ?)
      `).run(id, activeRound.id, teamId, trimmed, now, now);
      return db.prepare('SELECT * FROM conclusions WHERE id = ?').get(id) as Conclusion;
    }
  }

  /**
   * Evaluate a team's Level 2 conclusion using rubrics
   */
  static evaluateConclusion(
    adminUserId: string,
    conclusionId: string,
    accuracyScore: number,
    reasoningScore: number,
    efficiencyScore: number,
    feedback: string | null = null
  ): Evaluation {
    const db = getDb();
    const conclusion = db.prepare('SELECT * FROM conclusions WHERE id = ?').get(conclusionId) as Conclusion | undefined;
    if (!conclusion) throw new Error('Conclusion not found.');

    const totalScore = Number((accuracyScore + reasoningScore + efficiencyScore).toFixed(2));
    const now = new Date().toISOString();

    const existingEval = db.prepare('SELECT id FROM evaluations WHERE conclusion_id = ?').get(conclusionId) as { id: string } | undefined;
    let evalId = existingEval?.id;

    const runTransaction = db.transaction(() => {
      if (existingEval) {
        db.prepare(`
          UPDATE evaluations 
          SET accuracy_score = ?, reasoning_score = ?, efficiency_score = ?, total_score = ?, feedback = ?, evaluator_id = ?, evaluated_at = ? 
          WHERE id = ?
        `).run(accuracyScore, reasoningScore, efficiencyScore, totalScore, feedback, adminUserId, now, existingEval.id);
      } else {
        evalId = uuidv4();
        db.prepare(`
          INSERT INTO evaluations (
            id, conclusion_id, accuracy_score, reasoning_score, efficiency_score, total_score, feedback, evaluator_id, evaluated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(evalId, conclusionId, accuracyScore, reasoningScore, efficiencyScore, totalScore, feedback, adminUserId, now);
      }

      // Update team's level2_score
      db.prepare(`
        UPDATE teams 
        SET level2_score = ?, updated_at = ? 
        WHERE id = ?
      `).run(totalScore, now, conclusion.team_id);
    });

    runTransaction();

    logAuditAction(adminUserId, 'EVALUATE_CONCLUSION', 'evaluations', evalId!, {
      conclusionId,
      teamId: conclusion.team_id,
      totalScore
    });

    return db.prepare('SELECT * FROM evaluations WHERE id = ?').get(evalId!) as Evaluation;
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

      if (activeCase) {
        const allClues = db.prepare('SELECT * FROM clues WHERE case_id = ? AND is_active = 1 ORDER BY display_order ASC').all(activeCase.id) as Clue[];
        const unlocks = db.prepare('SELECT clue_id, unlocked_at FROM clue_unlocks WHERE round_id = ? AND team_id = ?').all(activeRound.id, teamId) as { clue_id: string; unlocked_at: string }[];
        const unlockedMap = new Map(unlocks.map((u) => [u.clue_id, u.unlocked_at]));

        clientClues = allClues.map((c) => {
          const isUnlocked = unlockedMap.has(c.id);
          return {
            id: c.id,
            title: c.title,
            credit_cost: c.credit_cost,
            display_order: c.display_order,
            is_unlocked: isUnlocked,
            content: isUnlocked ? c.content : undefined, // Never leak locked content
            media_path: isUnlocked ? c.media_path : undefined,
            unlocked_at: unlockedMap.get(c.id)
          };
        });
      }

      const conclusion = db.prepare('SELECT * FROM conclusions WHERE round_id = ? AND team_id = ?').get(activeRound.id, teamId) as Conclusion | undefined;
      const evaluation = conclusion ? (db.prepare('SELECT * FROM evaluations WHERE conclusion_id = ?').get(conclusion.id) as Evaluation | undefined) : undefined;

      level2State = {
        case: activeCase ? {
          id: activeCase.id,
          title: activeCase.title,
          situation_description: activeCase.situation_description,
          media_path: activeCase.media_path,
          initial_credits: activeCase.initial_credits
        } : null,
        clues: clientClues,
        conclusion: conclusion ? {
          text: conclusion.conclusion_text,
          status: conclusion.status,
          submitted_at: conclusion.submitted_at
        } : null,
        evaluation: evaluation ? {
          accuracy_score: evaluation.accuracy_score,
          reasoning_score: evaluation.reasoning_score,
          efficiency_score: evaluation.efficiency_score,
          total_score: evaluation.total_score,
          feedback: evaluation.feedback
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

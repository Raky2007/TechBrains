import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, closeDb } from '../database/db.js';
import { GameService } from '../services/gameService.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { calculateAuthoritativeLeaderboard } from '../services/scoringService.js';
import { recoverRoundsOnStartup } from '../services/timerService.js';
import { isAiConfigured, sanitizeErrorMessage, getQueueStatus } from '../services/aiEvaluationService.js';
import { CONFIG } from '../config.js';
import { teamRegisterSchema } from '@nexus/shared';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_nexus_lifecycle.db');

describe('Critical Game Lifecycle, Credits, AI Evaluation, Leaderboard & Registration Fixes', () => {
  beforeEach(async () => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
    const wal = `${TEST_DB_PATH}-wal`;
    const shm = `${TEST_DB_PATH}-shm`;
    if (fs.existsSync(wal)) try { fs.unlinkSync(wal); } catch (e) {}
    if (fs.existsSync(shm)) try { fs.unlinkSync(shm); } catch (e) {}

    const db = getDb(TEST_DB_PATH);
    db.exec(`
      DELETE FROM audit_logs;
      DELETE FROM case_evaluations;
      DELETE FROM level2_question_submissions;
      DELETE FROM conclusions;
      DELETE FROM credit_transactions;
      DELETE FROM clue_unlocks;
      DELETE FROM team_answers;
      DELETE FROM team_question_assignments;
      DELETE FROM rounds;
      DELETE FROM teams;
      DELETE FROM game_sessions;
    `);

    await setupDatabase();
    await seedDatabase();
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
    const wal = `${TEST_DB_PATH}-wal`;
    const shm = `${TEST_DB_PATH}-shm`;
    if (fs.existsSync(wal)) try { fs.unlinkSync(wal); } catch (e) {}
    if (fs.existsSync(shm)) try { fs.unlinkSync(shm); } catch (e) {}
  });

  // =========================================================================
  // 1. Level 1 -> Level 2 Progression
  // =========================================================================

  it('1.1. Automatic Level 1 to Level 2 transition triggers only when all eligible teams complete Level 1', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    
    // Register two teams with roll numbers
    const { team: team1 } = GameService.registerTeam('Team Alpha', '21B91A0501', '21B91A0502');
    const { team: team2 } = GameService.registerTeam('Team Beta', '21B91A0503', '21B91A0504');

    GameService.startRound(admin.id, 1);
    const db = getDb();
    const l1Round = db.prepare('SELECT id FROM rounds WHERE level = 1 ORDER BY created_at DESC LIMIT 1').get() as { id: string };

    const questions = db.prepare('SELECT id, correct_answer FROM level1_questions WHERE is_active = 1').all() as any[];

    // Team 1 completes all questions
    for (const q of questions) {
      GameService.submitLevel1Answer(team1.id, q.id, q.correct_answer);
    }

    // Only Team 1 completed -> Game should NOT advance yet
    let metrics = GameService.getLevel1ProgressionMetrics();
    expect(metrics.completed_teams_count).toBe(1);
    expect(metrics.eligible_teams_count).toBe(2);
    expect(metrics.all_completed).toBe(false);

    let session = GameService.getGameSession().session;
    expect(session.status).toBe('level1_active');

    // Team 2 completes all questions
    for (const q of questions) {
      GameService.submitLevel1Answer(team2.id, q.id, q.correct_answer);
    }

    // Now BOTH eligible teams completed -> Session automatically transitions to Level 2 active!
    metrics = GameService.getLevel1ProgressionMetrics();
    expect(metrics.completed_teams_count).toBe(2);
    expect(metrics.all_completed).toBe(true);

    session = GameService.getGameSession().session;
    expect(session.status).toBe('level2_active');
    expect(session.current_level).toBe(2);

    // Active round is now Level 2
    const activeRound = GameService.getGameSession().activeRound;
    expect(activeRound).toBeDefined();
    expect(activeRound?.level).toBe(2);
    expect(activeRound?.status).toBe('active');
  });

  it('1.2. Zero eligible teams does not trigger vacuous progression', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    // Start Level 1 without any teams registered
    GameService.startRound(admin.id, 1);

    const metrics = GameService.getLevel1ProgressionMetrics();
    expect(metrics.eligible_teams_count).toBe(0);
    expect(metrics.all_completed).toBe(false);

    const session = GameService.getGameSession().session;
    expect(session.status).toBe('level1_active');
  });

  it('1.3. Unqualified teams are held on not_qualified and cannot access Level 2', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { team: passingTeam } = GameService.registerTeam('Passing Team', '21B91A0505', '21B91A0506');
    const { team: failingTeam } = GameService.registerTeam('Failing Team', '21B91A0507', '21B91A0508');

    // Set qualification cutoff to 4 (max L1 is 8)
    GameService.updateSettings(admin.id, { round1CutoffScore: 4 });

    GameService.startRound(admin.id, 1);
    const db = getDb();
    const questions = db.prepare('SELECT id, correct_answer FROM level1_questions WHERE is_active = 1').all() as any[];

    // Passing team answers correctly (points >= 20)
    for (const q of questions) {
      GameService.submitLevel1Answer(passingTeam.id, q.id, q.correct_answer);
    }
    // Failing team answers incorrectly (0 points)
    for (const q of questions) {
      const wrongAnswer = q.correct_answer === 'AI' ? 'HUMAN' : 'AI';
      GameService.submitLevel1Answer(failingTeam.id, q.id, wrongAnswer);
    }

    // Both completed -> Level 2 active
    const session = GameService.getGameSession().session;
    expect(session.status).toBe('level2_active');

    // Check stages
    const passingState = GameService.getTeamPrivateState(passingTeam.id);
    expect(passingState.stage).toBe('round2');
    expect(passingState.round2_qualified).toBe(true);

    const failingState = GameService.getTeamPrivateState(failingTeam.id);
    expect(failingState.stage).toBe('not_qualified');
    expect(failingState.round2_qualified).toBe(false);

    // Failing team cannot unlock clues in Level 2
    const clue = db.prepare('SELECT id FROM clues WHERE is_active = 1 LIMIT 1').get() as { id: string };
    expect(() => GameService.unlockLevel2Clue(failingTeam.id, clue.id)).toThrow(/not qualified/i);
  });

  // =========================================================================
  // 2. Registration & Player Roll Numbers
  // =========================================================================

  it('2.1. Registration validates required roll numbers', () => {
    // Shared Zod schema validation
    const valid = teamRegisterSchema.safeParse({
      team_name: 'Nexus Alpha',
      player1_roll: '21B91A0501',
      player2_roll: '21B91A0502'
    });
    expect(valid.success).toBe(true);

    const missingP1 = teamRegisterSchema.safeParse({
      team_name: 'Nexus Alpha',
      player2_roll: '21B91A0502'
    });
    expect(missingP1.success).toBe(false);

    const missingP2 = teamRegisterSchema.safeParse({
      team_name: 'Nexus Alpha',
      player1_roll: '21B91A0501'
    });
    expect(missingP2.success).toBe(false);
  });

  it('2.2. Roll numbers are safely stored and returned in team details and leaderboard', () => {
    const { team } = GameService.registerTeam('Vanguard', 'ROLL-A-101', 'ROLL-B-102');
    expect(team.player1_roll).toBe('ROLL-A-101');
    expect(team.player2_roll).toBe('ROLL-B-102');

    const db = getDb();
    const stored = db.prepare('SELECT player1_roll, player2_roll FROM teams WHERE id = ?').get(team.id) as any;
    expect(stored.player1_roll).toBe('ROLL-A-101');
    expect(stored.player2_roll).toBe('ROLL-B-102');

    const leaderboard = GameService.getLeaderboard({ includeBanned: true });
    const entry = leaderboard.find((e) => e.team_id === team.id);
    expect(entry).toBeDefined();
    expect(entry?.player1_roll).toBe('ROLL-A-101');
    expect(entry?.player2_roll).toBe('ROLL-B-102');
  });

  // =========================================================================
  // 3. Credits & Level 2 Deductions
  // =========================================================================

  it('3.1. Successful clue purchase deducts credits atomically and idempotently', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { team } = GameService.registerTeam('Credit Test Team', '21B91A0509', '21B91A0510');

    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    const db = getDb();
    const clue = db.prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;
    db.prepare('UPDATE clues SET required_level = 2 WHERE id = ?').run(clue.id);
    const initialCredits = team.current_credits; // 200

    const opId = 'op-clue-unique-123';
    const purchase = GameService.unlockLevel2Clue(team.id, clue.id, opId);
    expect(purchase.credits_spent).toBe(clue.credit_cost);
    expect(purchase.remaining_credits).toBe(initialCredits - clue.credit_cost);
    expect(purchase.already_unlocked).toBe(false);

    // Duplicate purchase with same opId should not charge twice
    const duplicate = GameService.unlockLevel2Clue(team.id, clue.id, opId);
    expect(duplicate.already_unlocked).toBe(true);
    expect(duplicate.credits_spent).toBe(0);
    expect(duplicate.remaining_credits).toBe(initialCredits - clue.credit_cost);

    // Authoritative balance in DB
    const updatedTeam = db.prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as any;
    expect(updatedTeam.current_credits).toBe(initialCredits - clue.credit_cost);
  });

  it('3.2. Pause and resume does not modify credits or reset balances', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { team } = GameService.registerTeam('Pause Team', '21B91A0511', '21B91A0512');

    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    const db = getDb();
    const clue = db.prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;
    db.prepare('UPDATE clues SET required_level = 2 WHERE id = ?').run(clue.id);
    GameService.unlockLevel2Clue(team.id, clue.id);

    const teamStateBeforePause = GameService.getTeamPrivateState(team.id);
    const balanceBeforePause = teamStateBeforePause.team.current_credits;

    // Pause round
    GameService.pauseRound(admin.id, 2);
    const teamStateDuringPause = GameService.getTeamPrivateState(team.id);
    expect(teamStateDuringPause.team.current_credits).toBe(balanceBeforePause);

    // Resume round
    GameService.resumeRound(admin.id, 2);
    const teamStateAfterResume = GameService.getTeamPrivateState(team.id);
    expect(teamStateAfterResume.team.current_credits).toBe(balanceBeforePause);
  });

  // =========================================================================
  // 4. AI Evaluation Reliability & Error Sanitization
  // =========================================================================

  it('4.1. Sanitizes API keys and authorization headers from error messages', () => {
    const dirtyError = 'HTTP 401: Unauthorized request with Bearer nvapi-secretkey1234567890abcdef. Failed to reach NVIDIA Nemotron API with key nvapi-secretkey1234567890abcdef.';
    const clean = sanitizeErrorMessage(dirtyError);

    expect(clean).not.toContain('nvapi-secretkey1234567890abcdef');
    expect(clean).toContain('[REDACTED');
  });

  it('4.2. In-memory queue status accurately reports queue metrics', () => {
    const queue = getQueueStatus();
    expect(queue).toBeDefined();
    expect(queue.concurrency).toBe(CONFIG.AI.CONCURRENCY);
    expect(typeof queue.pending).toBe('number');
    expect(typeof queue.processing).toBe('number');
  });

  it('4.3. Startup recovery restores orphaned processing jobs to pending', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { team } = GameService.registerTeam('Crash Recovery Team', '21B91A0513', '21B91A0514');

    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    const db = getDb();
    const subId = uuidv4();
    const now = new Date().toISOString();
    const round = GameService.getGameSession().activeRound!;

    // Simulate an orphaned job left in 'processing' status
    db.prepare(`
      INSERT INTO level2_question_submissions (
        id, round_id, team_id, question_number, pin_submitted, pin_normalized,
        is_correct, selected_suspect, explanation, score, max_score,
        evaluation_status, evaluation_data_json, submitted_at, updated_at
      ) VALUES (?, ?, ?, 2, NULL, NULL, NULL, 'Kabir', 'He was seen tampering with footage.', 0, 5, 'processing', NULL, ?, ?)
    `).run(subId, round.id, team.id, now, now);

    // Run startup recovery
    recoverRoundsOnStartup();

    const recovered = db.prepare('SELECT evaluation_status FROM level2_question_submissions WHERE id = ?').get(subId) as any;
    expect(recovered.evaluation_status).toBe('pending');
  });

  // =========================================================================
  // 5. Leaderboard Publishing & Banned Team Filtering
  // =========================================================================

  it('5.1. Leaderboard excludes banned teams from participant results while keeping them for admin audit', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { team: cleanTeam } = GameService.registerTeam('Honest Team', '21B91A0515', '21B91A0516');
    const { team: bannedTeam } = GameService.registerTeam('Cheater Team', '21B91A0517', '21B91A0518');

    // Ban Cheater Team
    GameService.banTeam(admin.id, bannedTeam.id, 'Collusion detected');

    // Participant view: includeBanned = false
    const participantLeaderboard = GameService.getLeaderboard({ includeBanned: false });
    expect(participantLeaderboard.some((e) => e.team_id === bannedTeam.id)).toBe(false);
    expect(participantLeaderboard.some((e) => e.team_id === cleanTeam.id)).toBe(true);

    // Admin view: includeBanned = true
    const adminLeaderboard = GameService.getLeaderboard({ includeBanned: true });
    const bannedEntry = adminLeaderboard.find((e) => e.team_id === bannedTeam.id);
    expect(bannedEntry).toBeDefined();
    expect(bannedEntry?.is_banned).toBe(true);
    expect(bannedEntry?.ban_reason).toBe('Collusion detected');
  });
});

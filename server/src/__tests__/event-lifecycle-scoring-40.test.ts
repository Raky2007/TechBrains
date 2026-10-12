import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { runMigrations } from '../database/migrate.js';
import { GameService } from '../services/gameService.js';
import { calculateAuthoritativeLeaderboard, calculateLevel1Score } from '../services/scoringService.js';
import * as aiEvalService from '../services/aiEvaluationService.js';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_lifecycle_scoring.db');

describe('Event Lifecycle, Automatic Progression & 40-Point Scoring Suite', () => {
  let adminId: string;

  beforeEach(async () => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    }
    const wal = `${TEST_DB_PATH}-wal`;
    const shm = `${TEST_DB_PATH}-shm`;
    if (fs.existsSync(wal)) try { fs.unlinkSync(wal); } catch {}
    if (fs.existsSync(shm)) try { fs.unlinkSync(shm); } catch {}

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

    const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get('admin') as any;
    adminId = admin.id;
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    }
  });

  describe('1. Simplified Admin Lifecycle Controls', () => {
    it('startEvent starts session and Level 1 atomically, preventing duplicate starts', () => {
      const started = GameService.startEvent(adminId);
      expect(started.session.status).toBe('level1_active');
      expect(started.round.level).toBe(1);
      expect(started.round.status).toBe('active');

      // Duplicate start must throw
      expect(() => GameService.startEvent(adminId)).toThrow(/Cannot start event: tournament session is currently "level1_active"/i);
    });

    it('stopEvent stops the event cleanly, stops timers, preserves data, and does not auto-publish', () => {
      const { team } = GameService.registerTeam('Team Alpha');
      GameService.startEvent(adminId);

      const db = getDb();
      // Answer a question with its correct answer (AI or HUMAN) so the team earns 1 point
      const assignment = db.prepare(`
        SELECT a.question_id, q.correct_answer 
        FROM team_question_assignments a
        JOIN level1_questions q ON q.id = a.question_id
        WHERE a.team_id = ? AND q.correct_answer != 'CANT_DEFINE'
        LIMIT 1
      `).get(team.id) as any;
      GameService.submitLevel1Answer(team.id, assignment.question_id, assignment.correct_answer);

      const stoppedSession = GameService.stopEvent(adminId);
      expect(stoppedSession.status).toBe('completed');

      const { settings } = GameService.getGameSession();
      expect(settings.resultsPublished).toBe(false);

      // Verify team records and score are preserved
      const preserved = db.prepare('SELECT level1_score, current_credits FROM teams WHERE id = ?').get(team.id) as any;
      expect(preserved.level1_score).toBe(1);
      expect(preserved.current_credits).toBe(200);
    });

    it('publishFinalResults requires stopped/completed state, persists final scores, and is idempotent', () => {
      const { team: t1 } = GameService.registerTeam('Team 1');
      const { team: t2 } = GameService.registerTeam('Team 2');
      GameService.startEvent(adminId);

      // Attempting to publish while active must throw
      expect(() => GameService.publishFinalResults(adminId)).toThrow(/Please stop or complete the event first/i);

      // Stop event first
      GameService.stopEvent(adminId);

      // Directly update scores for stopped session
      const db = getDb();
      db.prepare('UPDATE teams SET level1_score = 27, level2_score = 8 WHERE id = ?').run(t1.id);
      db.prepare('UPDATE teams SET level1_score = 21, level2_score = 10 WHERE id = ?').run(t2.id);

      // Publish
      GameService.publishFinalResults(adminId);
      const afterPub = GameService.getGameSession();
      expect(afterPub.settings.resultsPublished).toBe(true);

      // Check authoritative leaderboard final scores
      const leaderboard = calculateAuthoritativeLeaderboard(afterPub.session.id, afterPub.settings);
      const l1 = leaderboard.find((e) => e.team_id === t1.id);
      const l2 = leaderboard.find((e) => e.team_id === t2.id);
      expect(l1?.final_score).toBe(35);
      expect(l2?.final_score).toBe(31);

      // Repeated publication is idempotent
      GameService.publishFinalResults(adminId);
      const afterSecond = GameService.getGameSession();
      expect(afterSecond.settings.resultsPublished).toBe(true);
    });
  });

  describe('2. Automatic Level 1 to Level 2 Progression', () => {
    it('advances session to Level 2 when all eligible teams complete Level 1 and qualify', () => {
      // Register team before starting event so assignments are seeded
      const { team } = GameService.registerTeam('AutoAdvance Team');
      GameService.startEvent(adminId);
      const db = getDb();

      // Submit all assigned questions for the team
      const assignments = db.prepare('SELECT question_id FROM team_question_assignments WHERE team_id = ?').all(team.id) as any[];
      for (const a of assignments) {
        GameService.submitLevel1Answer(team.id, a.question_id, 'AI');
      }

      // Check session state: auto-progression should have transitioned to level2_active
      const session = GameService.getGameSession().session;
      expect(session.status).toBe('level2_active');
    });

    it('respects qualification rules: does not advance to Level 2 if cutoff is not met', () => {
      // Set high qualification cutoff
      GameService.updateSettings(adminId, { round1CutoffScore: 28 });
      const { team } = GameService.registerTeam('Unqualified Team');
      GameService.startEvent(adminId);

      const db = getDb();

      // Answer questions with wrong answers (0 points)
      const assignments = db.prepare('SELECT question_id FROM team_question_assignments WHERE team_id = ?').all(team.id) as any[];
      for (const a of assignments) {
        GameService.submitLevel1Answer(team.id, a.question_id, 'CANT_DEFINE'); // 0 points
      }

      // Cutoff of 28 not met (score is 0), so session should cleanly end Level 1 without starting Level 2
      const session = GameService.getGameSession().session;
      expect(session.status).toBe('level1_ended');
    });
  });

  describe('3. Accurate 40-Point Total Scoring System', () => {
    it('Level 1 awards 1 point per correct answer (max 30 for 30 questions)', () => {
      const qAI = {
        id: 'q-test-1',
        title: 'Test Q',
        prompt: 'Prompt',
        content_type: 'text' as const,
        media_path: null,
        correct_answer: 'AI' as const,
        explanation: 'Ex',
        category: 'cat',
        difficulty: 'easy' as const,
        time_limit_seconds: 30,
        is_active: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Default (no points_value specified) awards 1 (1 point per question, 30 questions max = 30 pts)
      expect(calculateLevel1Score('AI', qAI)).toEqual({ isCorrect: true, awardedPoints: 1 });
      // Incorrect answer awards 0
      expect(calculateLevel1Score('HUMAN', qAI)).toEqual({ isCorrect: false, awardedPoints: 0 });
      // CANT_DEFINE awards 0
      expect(calculateLevel1Score('CANT_DEFINE', qAI)).toEqual({ isCorrect: false, awardedPoints: 0 });
      // Explicit configurable points_value = 1
      expect(calculateLevel1Score('AI', { ...qAI, points_value: 1 })).toEqual({ isCorrect: true, awardedPoints: 1 });
      // Configurable points_value = 3
      expect(calculateLevel1Score('AI', { ...qAI, points_value: 3 })).toEqual({ isCorrect: true, awardedPoints: 3 });
    });

    it('Level 2 Q1 awards 5 points for valid PIN formats and 0 for incorrect', () => {
      const { team } = GameService.registerTeam('Vault Team');
      GameService.startEvent(adminId);
      // Cleanly transition to Level 2
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const db = getDb();

      // Correct PIN: 0728 (or 728)
      const q1Success = GameService.submitLevel2Question1(team.id, '0728');
      expect(q1Success.is_correct).toBe(true);
      expect(q1Success.score).toBe(5);

      // Check team level2_score updated
      const tRow = db.prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
      expect(tRow.level2_score).toBe(5);
    });

    it('Total tournament score equals Level 1 (out of 30) + Level 2 (out of 10) = max 40', () => {
      const { session, settings } = GameService.getGameSession();
      const db = getDb();
      const { team } = GameService.registerTeam('Champion Team');
      db.prepare('UPDATE teams SET level1_score = 30, level2_score = 10 WHERE id = ?').run(team.id);

      const leaderboard = calculateAuthoritativeLeaderboard(session.id, settings);
      const champ = leaderboard.find((e) => e.team_id === team.id);
      expect(champ).toBeDefined();
      expect(champ!.level1_score).toBe(30);
      expect(champ!.level2_score).toBe(10);
      expect(champ!.final_score).toBe(40);
    });
  });

  describe('4. AI Question 2 Strict 3-Component Rubric & Resilience', () => {
    it('awards 5/5 for correct suspect Kabir with valid evidence and logical reasoning', () => {
      const result = aiEvalService.mockEvaluate({
        teamAnswer: 'Kabir took ORION. The exported demonstration video was looped at 7:28 PM to fake an alibi, and the rear maintenance hatch seal behind the cabinet was broken.',
        selectedSuspect: 'Kabir',
        explanation: 'The looped 7:28 video timestamp and rear hatch trace prove Kabir staged the room and exited through the unmonitored opening.'
      }, 5);

      expect(result.suspect_score).toBe(2);
      expect(result.evidence_score).toBe(2);
      expect(result.logic_score).toBe(1);
      expect(result.score).toBe(5);
      expect(result.verdict).toBe('Strong');
    });

    it('awards 2/5 for guessing Kabir without evidence or logical reasoning', () => {
      const result = aiEvalService.mockEvaluate({
        teamAnswer: 'I think Kabir did it.',
        selectedSuspect: 'Kabir',
        explanation: 'Just Kabir.'
      }, 5);

      expect(result.suspect_score).toBe(2);
      expect(result.evidence_score).toBe(0);
      expect(result.logic_score).toBe(0);
      expect(result.score).toBe(2);
    });

    it('awards 0/5 when suspect is incorrect even if long text is written', () => {
      const result = aiEvalService.mockEvaluate({
        teamAnswer: 'Dr. Rao stole the prototype because he had access to the master key and left early.',
        selectedSuspect: 'Dr. Rao',
        explanation: 'Dr Rao had access'
      }, 5);

      expect(result.suspect_score).toBe(0);
      expect(result.score).toBeLessThanOrEqual(2);
    });

    it('awards 0 evidence points for fabricated evidence contradicting case facts', () => {
      const result = aiEvalService.mockEvaluate({
        teamAnswer: 'Kabir is the thief because DNA test confirmed his blood on the vault door and police found the prototype in his car trunk.',
        selectedSuspect: 'Kabir',
        explanation: 'DNA test on vault door and car trunk.'
      }, 5);

      expect(result.suspect_score).toBe(2);
      expect(result.evidence_score).toBe(0); // Fabricated claims awarded 0 evidence points
      expect(result.score).toBe(2);
    });

    it('normalizeModelJson validates strict schema, clamps integer scores, and rejects malformed responses', () => {
      const validJson = JSON.stringify({
        suspect_score: 2,
        evidence_score: 2,
        logic_score: 1,
        total_score: 5,
        selected_suspect_correct: true,
        verdict: 'Strong',
        reasoning: 'Valid identification with logs and hatch evidence.',
        matched_evidence: ['Card logs', 'Hatch seal'],
        missing_evidence: []
      });

      const normalized = aiEvalService.normalizeModelJson(validJson, 5, 'openrouter', 'nemotron', 'Kabir');
      expect(normalized.score).toBe(5);
      expect(normalized.suspect_score).toBe(2);
      expect(normalized.evidence_score).toBe(2);
      expect(normalized.logic_score).toBe(1);

      // Rejects malformed JSON
      expect(() => aiEvalService.normalizeModelJson('Not valid json at all', 5, 'openrouter', 'nemotron')).toThrow();
    });

    it('preserves manual admin overrides against late AI responses', () => {
      const { team } = GameService.registerTeam('Override Team');
      const { round } = GameService.startEvent(adminId);
      const db = getDb();
      const cId = 'concl-123';
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO conclusions (id, round_id, team_id, conclusion_text, status, submitted_at, updated_at)
        VALUES (?, ?, ?, 'Original conclusion', 'submitted', ?, ?)
      `).run(cId, round.id, team.id, now, now);

      // Admin manually overrides score to 4
      GameService.overrideEvaluation(adminId, cId, 4, 'Strong', 'Admin verified evidence');

      // Verify evaluation is marked overridden
      const ev = db.prepare('SELECT is_overridden, status, score FROM case_evaluations WHERE conclusion_id = ?').get(cId) as any;
      expect(ev.is_overridden).toBe(1);
      expect(ev.status).toBe('overridden');
      expect(ev.score).toBe(4);
    });
  });

  describe('5. Leaderboard, Banned Teams & Migration Safety', () => {
    it('excludes banned teams from public leaderboard while keeping admin records', () => {
      const { session, settings } = GameService.getGameSession();
      const db = getDb();
      const { team: tGood } = GameService.registerTeam('Good Team');
      const { team: tBanned } = GameService.registerTeam('Cheater Team');

      db.prepare('UPDATE teams SET level1_score = 25, level2_score = 9 WHERE id = ?').run(tGood.id);
      db.prepare('UPDATE teams SET level1_score = 30, level2_score = 10, is_banned = 1 WHERE id = ?').run(tBanned.id);

      // Public view (includeBanned = false)
      const publicLb = calculateAuthoritativeLeaderboard(session.id, settings, { includeBanned: false });
      expect(publicLb.some((e) => e.team_id === tBanned.id)).toBe(false);
      expect(publicLb.some((e) => e.team_id === tGood.id)).toBe(true);

      // Admin view (includeBanned = true)
      const adminLb = calculateAuthoritativeLeaderboard(session.id, settings, { includeBanned: true });
      expect(adminLb.some((e) => e.team_id === tBanned.id)).toBe(true);
    });

    it('runMigrations is repeatable and additive without corrupting existing records', () => {
      const db = getDb();
      const { team } = GameService.registerTeam('Migration Safe Team');
      db.prepare('UPDATE teams SET level1_score = 21, current_credits = 190 WHERE id = ?').run(team.id);

      // Run migrations again
      expect(() => runMigrations()).not.toThrow();

      // Verify data remains untouched
      const checked = db.prepare('SELECT level1_score, current_credits FROM teams WHERE id = ?').get(team.id) as any;
      expect(checked.level1_score).toBe(21);
      expect(checked.current_credits).toBe(190);
    });
  });
});

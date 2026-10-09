import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { GameService } from '../services/gameService.js';
import { AdminUser, Level1Question, Clue } from '@nexus/shared';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_locking_nexus.db');

describe('Point 10: Section / Level Locking & Progression Enforcement', () => {
  let adminId: string;

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
      DELETE FROM evaluations;
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

    const admin = db.prepare('SELECT id FROM admin_users LIMIT 1').get() as AdminUser;
    adminId = admin.id;
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  it('1. Rejects Round 1 answers when session is idle (Level 1 locked before admin starts)', () => {
    const { team } = GameService.registerTeam('Pre-Round Squad');
    const db = getDb();
    const q = db.prepare('SELECT id FROM level1_questions WHERE is_active = 1 LIMIT 1').get() as Level1Question;

    expect(() => {
      GameService.submitLevel1Answer(team.id, q.id, 'AI');
    }).toThrow(/Level 1 is not currently active/i);

    // Verify team score is still 0
    const refreshed = db.prepare('SELECT level1_score FROM teams WHERE id = ?').get(team.id) as any;
    expect(refreshed.level1_score).toBe(0);
  });

  it('2. Enforces per-question timeout lock in Level 1 (cannot answer timed-out questions)', () => {
    const { team } = GameService.registerTeam('Slow Timers');
    GameService.startRound(adminId, 1);

    const privateState = GameService.getTeamPrivateState(team.id);
    const q = privateState.level1!.current_question!;
    expect(q).toBeDefined();

    // Artificially age the served assignment's deadline into the past
    const db = getDb();
    const pastIso = new Date(Date.now() - 5000).toISOString();
    db.prepare(`
      UPDATE team_question_assignments 
      SET deadline_at = ? 
      WHERE team_id = ? AND question_id = ?
    `).run(pastIso, team.id, q.id);

    // Attempting to submit after timeout must throw
    expect(() => {
      GameService.submitLevel1Answer(team.id, q.id, 'HUMAN');
    }).toThrow(/time is up|timed out/i);

    // Next getTeamPrivateState moves past the timed-out question without scoring
    const nextState = GameService.getTeamPrivateState(team.id);
    expect(nextState.team.level1_score).toBe(0);
    expect(nextState.level1!.current_question?.id).not.toBe(q.id);
  });

  it('3. Rejects Level 2 actions when Level 2 is not active (pre-round locking)', () => {
    const { team } = GameService.registerTeam('Eager Investigators');
    const db = getDb();
    const clue = db.prepare('SELECT id FROM clues WHERE is_active = 1 LIMIT 1').get() as Clue;

    // Clue unlock rejected while idle
    expect(() => {
      GameService.unlockLevel2Clue(team.id, clue.id);
    }).toThrow(/Level 2 is not currently active/i);

    // Media replay rejected while idle
    expect(() => {
      GameService.replayCaseMedia(team.id, 'op-lock-1');
    }).toThrow(/Level 2 is not currently active/i);

    // Final conclusion submission rejected while idle
    expect(() => {
      GameService.submitConclusion(team.id, 'Our forensic analysis indicates suspicious activity.');
    }).toThrow(/Level 2 is not currently active/i);
  });

  it('4. Enforces Round 1 cutoff qualification lockout for Level 2', () => {
    // Set qualification cutoff to 2 points
    GameService.updateSettings(adminId, { round1CutoffScore: 2 });

    const { team: passingTeam } = GameService.registerTeam('Passing Team');
    const { team: failingTeam } = GameService.registerTeam('Failing Team');

    // Run and finish Round 1
    const { round: r1 } = GameService.startRound(adminId, 1);
    const db = getDb();

    // Passing team answers 5 assigned questions correctly (scores 5 points)
    const passingAssigned = db.prepare(`
      SELECT q.id, q.correct_answer 
      FROM team_question_assignments tqa
      JOIN level1_questions q ON q.id = tqa.question_id
      WHERE tqa.round_id = ? AND tqa.team_id = ?
      ORDER BY tqa.question_order ASC
      LIMIT 5
    `).all(r1.id, passingTeam.id) as Level1Question[];

    for (const q of passingAssigned) {
      GameService.submitLevel1Answer(passingTeam.id, q.id, q.correct_answer);
    }

    // Failing team answers assigned questions incorrectly (scores 0 points)
    const failingAssigned = db.prepare(`
      SELECT q.id, q.correct_answer 
      FROM team_question_assignments tqa
      JOIN level1_questions q ON q.id = tqa.question_id
      WHERE tqa.round_id = ? AND tqa.team_id = ?
      ORDER BY tqa.question_order ASC
      LIMIT 5
    `).all(r1.id, failingTeam.id) as Level1Question[];

    for (const q of failingAssigned) {
      const wrongChoice = q.correct_answer === 'AI' ? 'HUMAN' : 'AI';
      GameService.submitLevel1Answer(failingTeam.id, q.id, wrongChoice);
    }

    // End Round 1 and Start Round 2
    GameService.endRound(adminId, 1);
    GameService.startRound(adminId, 2);

    const clue = db.prepare('SELECT id FROM clues WHERE is_active = 1 LIMIT 1').get() as Clue;

    // Failing team is locked out of Round 2
    expect(() => {
      GameService.unlockLevel2Clue(failingTeam.id, clue.id);
    }).toThrow(/not qualified/i);

    expect(() => {
      GameService.replayCaseMedia(failingTeam.id, 'op-lock-fail');
    }).toThrow(/not qualified/i);

    expect(() => {
      GameService.submitConclusion(failingTeam.id, 'Unauthorized conclusion from unqualified team.');
    }).toThrow(/not qualified/i);

    // Passing team can unlock clues and submit conclusion
    const unlockResult = GameService.unlockLevel2Clue(passingTeam.id, clue.id);
    expect(unlockResult.credits_spent).toBeGreaterThan(0);

    const conclusionResult = GameService.submitConclusion(passingTeam.id, 'Evidence confirms the rogue AI modified telemetry data.');
    expect(conclusionResult.status).toBe('submitted');
  });

  it('5. Enforces irreversible lock on Level 2 after conclusion submission', () => {
    const { team } = GameService.registerTeam('Decisive Detectives');
    GameService.startRound(adminId, 1);
    GameService.endRound(adminId, 1);
    GameService.startRound(adminId, 2);

    const db = getDb();
    const clues = db.prepare('SELECT id FROM clues WHERE is_active = 1 ORDER BY display_order ASC LIMIT 2').all() as Clue[];

    // Unlock first clue
    GameService.unlockLevel2Clue(team.id, clues[0].id);

    // Submit final irreversible conclusion
    GameService.submitConclusion(team.id, 'Our definitive conclusion based on evidence retrieved.');

    // Further clue unlocks must be blocked
    expect(() => {
      GameService.unlockLevel2Clue(team.id, clues[1].id);
    }).toThrow(/final answer has been submitted/i);

    // Media replay must be blocked
    expect(() => {
      GameService.replayCaseMedia(team.id, 'op-lock-submitted');
    }).toThrow(/final answer has been submitted/i);

    // Re-submission must be blocked
    expect(() => {
      GameService.submitConclusion(team.id, 'Attempting to change my previous conclusion narrative.');
    }).toThrow(/already been submitted/i);
  });

  it('6. Ensures locked levels never leak protected content in team private state', () => {
    // Cutoff set to 2
    GameService.updateSettings(adminId, { round1CutoffScore: 2 });
    const { team: unqualifiedTeam } = GameService.registerTeam('Unqualified Squad');

    GameService.startRound(adminId, 1);
    GameService.endRound(adminId, 1);
    GameService.startRound(adminId, 2);

    const unqualifiedState = GameService.getTeamPrivateState(unqualifiedTeam.id);
    expect(unqualifiedState.round2_qualified).toBe(false);
    expect(unqualifiedState.stage).toBe('not_qualified');
    // Level 2 case and clues are omitted completely
    expect(unqualifiedState.level2).toBeUndefined();
  });
});

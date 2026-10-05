import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, closeDb } from '../database/db.js';
import { GameService } from '../services/gameService.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { calculateLevel1Score, calculateAuthoritativeLeaderboard } from '../services/scoringService.js';
import { getAuthoritativeTimerState, isRoundExpired, recoverRoundsOnStartup } from '../services/timerService.js';
import { Level1Question } from '@nexus/shared';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_nexus.db');

describe('Authoritative Game Logic & Acceptance Criteria', () => {
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

  it('1. A team can register and reconnect without creating a duplicate team', () => {
    const { team, token } = GameService.registerTeam('Cyber Valkyries');
    expect(team).toBeDefined();
    expect(team.team_name).toBe('Cyber Valkyries');
    expect(team.current_credits).toBe(200);

    // Re-authenticate
    const reconnected = GameService.authenticateTeam(token);
    expect(reconnected).toBeDefined();
    expect(reconnected?.id).toBe(team.id);

    // Duplicate registration with same name (case-insensitive) must be rejected
    expect(() => {
      GameService.registerTeam('cyber valkyries');
    }).toThrow(/already registered/i);
  });

  it('2. Question randomization: each team receives a persisted question assignment', () => {
    const { team: t1 } = GameService.registerTeam('Team Alpha');
    const { team: t2 } = GameService.registerTeam('Team Beta');

    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { round } = GameService.startRound(admin.id, 1);

    const db = getDb();
    const t1Assignments = db.prepare('SELECT question_id, question_order FROM team_question_assignments WHERE round_id = ? AND team_id = ? ORDER BY question_order ASC').all(round.id, t1.id);
    const t2Assignments = db.prepare('SELECT question_id, question_order FROM team_question_assignments WHERE round_id = ? AND team_id = ? ORDER BY question_order ASC').all(round.id, t2.id);

    expect(t1Assignments.length).toBeGreaterThan(0);
    expect(t2Assignments.length).toBe(t1Assignments.length);
  });

  it('3. Level 1 scoring rules: Correct = +1, Incorrect = 0, Cant Define = 0', () => {
    const qAI: Level1Question = {
      id: uuidv4(),
      title: 'Test AI Q',
      prompt: 'Test',
      content_type: 'text',
      media_path: null,
      correct_answer: 'AI',
      explanation: 'test',
      category: 'Test',
      difficulty: 'easy',
      is_active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const qHuman: Level1Question = {
      ...qAI,
      id: uuidv4(),
      correct_answer: 'HUMAN'
    };

    // Correct AI: +1
    expect(calculateLevel1Score('AI', qAI)).toEqual({ isCorrect: true, awardedPoints: 1 });
    // Incorrect: 0
    expect(calculateLevel1Score('HUMAN', qAI)).toEqual({ isCorrect: false, awardedPoints: 0 });
    // Can't Define: 0
    expect(calculateLevel1Score('CANT_DEFINE', qAI)).toEqual({ isCorrect: false, awardedPoints: 0 });

    // Correct Human: +1
    expect(calculateLevel1Score('HUMAN', qHuman)).toEqual({ isCorrect: true, awardedPoints: 1 });
    // Incorrect: 0
    expect(calculateLevel1Score('AI', qHuman)).toEqual({ isCorrect: false, awardedPoints: 0 });
    // Can't Define: 0
    expect(calculateLevel1Score('CANT_DEFINE', qHuman)).toEqual({ isCorrect: false, awardedPoints: 0 });
  });

  it('4. Repeated answer submissions cannot award duplicate points', () => {
    const { team } = GameService.registerTeam('Test Duplicates');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { round } = GameService.startRound(admin.id, 1);

    const assignment = getDb().prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? LIMIT 1').get(round.id, team.id) as { question_id: string };
    const q = getDb().prepare('SELECT * FROM level1_questions WHERE id = ?').get(assignment.question_id) as Level1Question;

    // First submission
    const res1 = GameService.submitLevel1Answer(team.id, q.id, q.correct_answer);
    expect(res1.awarded_points).toBe(q.correct_answer === 'CANT_DEFINE' ? 0 : 1);

    // Repeated submission must fail
    expect(() => {
      GameService.submitLevel1Answer(team.id, q.id, q.correct_answer);
    }).toThrow(/already submitted/i);
  });

  it('5. Expired rounds reject answers', () => {
    const { team } = GameService.registerTeam('Test Expired');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { round } = GameService.startRound(admin.id, 1);

    // Force round deadline into the past
    const pastTime = new Date(Date.now() - 5000).toISOString();
    getDb().prepare('UPDATE rounds SET deadline_at = ? WHERE id = ?').run(pastTime, round.id);

    const assignment = getDb().prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? LIMIT 1').get(round.id, team.id) as { question_id: string };

    expect(() => {
      GameService.submitLevel1Answer(team.id, assignment.question_id, 'AI');
    }).toThrow(/time limit has expired/i);
  });

  it('6. Paused timers preserve remaining duration and resume accurately', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { round } = GameService.startRound(admin.id, 1);

    // Pause round
    const { round: pausedRound } = GameService.pauseRound(admin.id, 1);
    expect(pausedRound.status).toBe('paused');
    expect(pausedRound.remaining_seconds).toBeGreaterThan(0);

    const preservedSeconds = pausedRound.remaining_seconds!;

    // Check timer state while paused
    const timerState = getAuthoritativeTimerState(pausedRound);
    expect(timerState?.is_paused).toBe(true);
    expect(timerState?.remaining_seconds).toBe(preservedSeconds);

    // Resume round
    const { round: resumedRound } = GameService.resumeRound(admin.id, 1);
    expect(resumedRound.status).toBe('active');
    expect(resumedRound.paused_at).toBeNull();
  });

  it('7. Clue purchases deduct credits and reject duplicate charges', () => {
    const { team } = GameService.registerTeam('Investigator Squad');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    
    // Move game through Level 1 into Level 2
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    const { round: l2Round } = GameService.startRound(admin.id, 2);

    const clue = getDb().prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;
    expect(clue).toBeDefined();

    // Initial credits: 200
    expect(team.current_credits).toBe(200);

    // Unlock clue
    const unlockRes = GameService.unlockLevel2Clue(team.id, clue.id);
    expect(unlockRes.credits_spent).toBe(clue.credit_cost);
    expect(unlockRes.remaining_credits).toBe(200 - clue.credit_cost);
    expect(unlockRes.already_unlocked).toBe(false);

    // Duplicate unlock attempt must not double charge
    const duplicateRes = GameService.unlockLevel2Clue(team.id, clue.id);
    expect(duplicateRes.credits_spent).toBe(0);
    expect(duplicateRes.remaining_credits).toBe(200 - clue.credit_cost);
    expect(duplicateRes.already_unlocked).toBe(true);
  });

  it('8. Insufficient credits do not modify the balance', () => {
    const { team } = GameService.registerTeam('Broke Squad');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    // Set credits to 5
    getDb().prepare('UPDATE teams SET current_credits = 5 WHERE id = ?').run(team.id);

    const expensiveClue = getDb().prepare('SELECT * FROM clues WHERE credit_cost > 10 LIMIT 1').get() as any;

    expect(() => {
      GameService.unlockLevel2Clue(team.id, expensiveClue.id);
    }).toThrow(/insufficient credits/i);

    // Verify balance is untouched
    const checkTeam = getDb().prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as any;
    expect(checkTeam.current_credits).toBe(5);
  });

  it('9. Private team state hides locked clues and masks correct answers', () => {
    const { team } = GameService.registerTeam('Stealth Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

    // Test Level 1 masking
    GameService.startRound(admin.id, 1);
    const l1State = GameService.getTeamPrivateState(team.id);
    expect(l1State.level1?.current_question).toBeDefined();
    // Ensure correct_answer is NOT present on client question object
    expect((l1State.level1?.current_question as any).correct_answer).toBeUndefined();

    // Test Level 2 clue masking
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);
    const l2State = GameService.getTeamPrivateState(team.id);
    expect(l2State.level2?.clues.length).toBeGreaterThan(0);
    // Locked clues must NOT have content
    for (const c of l2State.level2!.clues) {
      expect(c.is_unlocked).toBe(false);
      expect(c.content).toBeUndefined();
    }
  });

  it('10. Conclusion submission and evaluation flow', () => {
    const { team } = GameService.registerTeam('Forensic Titans');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    const conclusionText = 'Forensic deduction: The rogue autonomous agent on Workstation 3 was triggered by a zero-width prompt injection in an external maintenance ticket.';
    const conclusion = GameService.submitConclusion(team.id, conclusionText);
    expect(conclusion.status).toBe('submitted');

    // Admin evaluates
    const evaluation = GameService.evaluateConclusion(admin.id, conclusion.id, 9.5, 4.5, 4.0, 'Exceptional evidence linking.');
    expect(evaluation.total_score).toBe(18.0);

    // Verify team level 2 score updated
    const updatedTeam = getDb().prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
    expect(updatedTeam.level2_score).toBe(18.0);
  });

  it('11. Final scores and leaderboard rankings calculate correctly with tie-breakers', () => {
    const db = getDb();
    const { session, settings } = GameService.getGameSession();

    // Setup 3 teams with specific scores
    const tA = GameService.registerTeam('Team Alpha');
    const tB = GameService.registerTeam('Team Beta');
    const tC = GameService.registerTeam('Team Charlie');

    // Team Alpha: L1=5, L2=15 -> Final = 20
    db.prepare('UPDATE teams SET level1_score = 5, level2_score = 15 WHERE id = ?').run(tA.team.id);
    // Team Beta: L1=6, L2=14 -> Final = 20 (Tie on final, but Alpha has higher L2 so Alpha ranks higher)
    db.prepare('UPDATE teams SET level1_score = 6, level2_score = 14 WHERE id = ?').run(tB.team.id);
    // Team Charlie: L1=4, L2=12 -> Final = 16
    db.prepare('UPDATE teams SET level1_score = 4, level2_score = 12 WHERE id = ?').run(tC.team.id);

    const leaderboard = calculateAuthoritativeLeaderboard(session.id, settings);

    expect(leaderboard[0].team_name).toBe('Team Alpha');
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[1].team_name).toBe('Team Beta');
    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[2].team_name).toBe('Team Charlie');
    expect(leaderboard[2].rank).toBe(3);
  });

  it('12. Teams cannot access another team\'s private clue unlocks', () => {
    const { team: t1 } = GameService.registerTeam('Team Private 1');
    const { team: t2 } = GameService.registerTeam('Team Private 2');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    const clue = getDb().prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;

    // Team 1 unlocks clue
    GameService.unlockLevel2Clue(t1.id, clue.id);

    // Team 2's private state must still show the clue as locked and masked
    const t2State = GameService.getTeamPrivateState(t2.id);
    const t2Clue = t2State.level2?.clues.find(c => c.id === clue.id);
    expect(t2Clue?.is_unlocked).toBe(false);
    expect(t2Clue?.content).toBeUndefined();
  });

  it('13. Startup recovery cleans up expired rounds', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { round } = GameService.startRound(admin.id, 1);

    // Simulate server crash while round deadline was in past
    const pastDeadline = new Date(Date.now() - 10000).toISOString();
    getDb().prepare('UPDATE rounds SET deadline_at = ? WHERE id = ?').run(pastDeadline, round.id);

    // Run recovery
    recoverRoundsOnStartup();

    const recoveredRound = getDb().prepare('SELECT status, ended_at FROM rounds WHERE id = ?').get(round.id) as any;
    expect(recoveredRound.status).toBe('ended');
    expect(recoveredRound.ended_at).toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, closeDb } from '../database/db.js';
import { GameService, normalizeVaultPin, isVaultPinCorrect } from '../services/gameService.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { calculateLevel1Score, calculateAuthoritativeLeaderboard } from '../services/scoringService.js';
import { getAuthoritativeTimerState, isRoundExpired, recoverRoundsOnStartup, checkAuthoritativeDeadlines, registerTimerCallbacks } from '../services/timerService.js';
import { CONFIG } from '../config.js';
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

  it('3. Level 1 scoring rules: Correct = +1, Incorrect = -1, Cant Determine = 0', () => {
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
      time_limit_seconds: 30,
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
    // Incorrect AI/Human: 0 (No negative marking in Level 1)
    expect(calculateLevel1Score('HUMAN', qAI)).toEqual({ isCorrect: false, awardedPoints: 0 });
    // Can't Determine: 0 (never penalised)
    expect(calculateLevel1Score('CANT_DEFINE', qAI)).toEqual({ isCorrect: false, awardedPoints: 0 });

    // Correct Human: +1
    expect(calculateLevel1Score('HUMAN', qHuman)).toEqual({ isCorrect: true, awardedPoints: 1 });
    // Incorrect AI/Human: 0 (No negative marking in Level 1)
    expect(calculateLevel1Score('AI', qHuman)).toEqual({ isCorrect: false, awardedPoints: 0 });
    // Can't Determine: 0
    expect(calculateLevel1Score('CANT_DEFINE', qHuman)).toEqual({ isCorrect: false, awardedPoints: 0 });

    // Correct "Can't Determine" when that is genuinely the correct answer: still 0.
    const qCant: Level1Question = { ...qAI, id: uuidv4(), correct_answer: 'CANT_DEFINE' };
    expect(calculateLevel1Score('CANT_DEFINE', qCant)).toEqual({ isCorrect: true, awardedPoints: 0 });
  });

  it('3b. Level 1 negative marking removed: incorrect answers award 0 and team score never falls below zero', () => {
    const { team } = GameService.registerTeam('No Negative Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { round } = GameService.startRound(admin.id, 1);

    const assignments = getDb()
      .prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? ORDER BY question_order ASC')
      .all(round.id, team.id) as { question_id: string }[];

    // Deliberately answer the first two AI/HUMAN questions wrongly
    let wrongApplied = 0;
    for (const a of assignments) {
      const q = getDb().prepare('SELECT * FROM level1_questions WHERE id = ?').get(a.question_id) as Level1Question;
      if (q.correct_answer === 'CANT_DEFINE') continue;
      const wrongAnswer = q.correct_answer === 'AI' ? 'HUMAN' : 'AI';
      const res = GameService.submitLevel1Answer(team.id, q.id, wrongAnswer);
      expect(res.awarded_points).toBe(0);
      expect(res.is_correct).toBe(false);
      wrongApplied++;
      if (wrongApplied === 2) break;
    }

    const updated = getDb().prepare('SELECT level1_score FROM teams WHERE id = ?').get(team.id) as { level1_score: number };
    expect(updated.level1_score).toBe(0);
    expect(updated.level1_score).toBeGreaterThanOrEqual(0);
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

    // Level 1 credits are initialized to default amount (200) when first used
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

    // Initialize level 1 credits to a small amount
    GameService.initLevelCredits(team.id, 1, 5);

    const expensiveClue = getDb().prepare('SELECT * FROM clues WHERE credit_cost > 10 LIMIT 1').get() as any;

    expect(() => {
      GameService.unlockLevel2Clue(team.id, expensiveClue.id);
    }).toThrow(/insufficient.*Level 1 credits/i);

    // Verify level 1 balance is untouched
    expect(GameService.getLevelBalance(team.id, 1)).toBe(5);
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

  it('10. Final submission + AI evaluation (mock) + manual override precedence', async () => {
    const prevProvider = CONFIG.AI.PROVIDER;
    CONFIG.AI.PROVIDER = 'mock';
    try {
      const { team } = GameService.registerTeam('Forensic Titans');
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

      GameService.startRound(admin.id, 1);
      GameService.endRound(admin.id, 1);
      GameService.startRound(admin.id, 2);

      const conclusionText =
        'The rogue autonomous agent on the engineering workstation was triggered by a zero-width prompt injection embedded in an external maintenance ticket; the badge was cloned and the CCTV feed looped.';
      const conclusion = GameService.submitConclusion(team.id, conclusionText);
      expect(conclusion.status).toBe('submitted');

      // AI evaluation (mock provider) completes and sets the authoritative score.
      const ev = await GameService.runAiEvaluation(conclusion.id);
      expect(ev.status).toBe('completed');
      expect(ev.source).toBe('ai');
      expect(ev.score).not.toBeNull();
      expect(ev.score!).toBeGreaterThanOrEqual(0);
      expect(ev.score!).toBeLessThanOrEqual(ev.max_score);

      const afterAi = getDb().prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
      expect(afterAi.level2_score).toBe(ev.score);

      // Manual override takes precedence and updates the authoritative score.
      const o = GameService.overrideEvaluation(admin.id, conclusion.id, 15, 'Strong', 'Clear linkage of evidence.');
      expect(o.is_overridden).toBe(1);
      expect(o.source).toBe('manual');
      expect(o.score).toBe(15);
      const afterOverride = getDb().prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
      expect(afterOverride.level2_score).toBe(15);

      // A subsequent AI run must NOT clobber the manual override.
      const re = await GameService.runAiEvaluation(conclusion.id);
      expect(re.is_overridden).toBe(1);
      expect(re.score).toBe(15);
    } finally {
      CONFIG.AI.PROVIDER = prevProvider;
    }
  });

  it('10b. AI evaluation marks status failed when no provider is configured (submission preserved)', async () => {
    const prevProvider = CONFIG.AI.PROVIDER;
    CONFIG.AI.PROVIDER = 'none';
    try {
      const { team } = startLevel2WithTeam('No Provider');
      const conclusion = GameService.submitConclusion(team.id, 'Our final conclusion about the SCADA breach and the prompt injection vector.');
      const ev = await GameService.runAiEvaluation(conclusion.id);
      expect(ev.status).toBe('failed');
      expect(ev.error_message).toBeTruthy();
      // Submission itself is preserved and still locked.
      const c = getDb().prepare('SELECT status FROM conclusions WHERE id = ?').get(conclusion.id) as any;
      expect(c.status).toBe('submitted');
    } finally {
      CONFIG.AI.PROVIDER = prevProvider;
    }
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

  // ---- TechBrains Round 2 media replay economy (Phase 3) ----
  function startLevel2WithTeam(name: string) {
    const { team } = GameService.registerTeam(name);
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    const { round } = GameService.startRound(admin.id, 2);
    return { team, round };
  }

  function forceMediaHidden(roundId: string) {
    // Push round start far enough back that the initial viewing window has elapsed.
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    getDb().prepare('UPDATE rounds SET started_at = ? WHERE id = ?').run(past, roundId);
    // Remove any replay windows so media is genuinely hidden.
    getDb().prepare('DELETE FROM media_replays WHERE round_id = ?').run(roundId);
  }

  it('14. Media is visible during the initial window (no charge to view)', () => {
    const { team } = startLevel2WithTeam('Window Watchers');
    const state = GameService.getTeamPrivateState(team.id);
    expect(state.level2?.media.is_visible).toBe(true);
    expect(state.level2?.media.initial_window_elapsed).toBe(false);
    expect(state.level2?.media.replay_count).toBe(0);
  });

  it('15. After the initial window, replay charges credits and reopens viewing', () => {
    const { team, round } = startLevel2WithTeam('Replay Rangers');
    forceMediaHidden(round.id);

    let state = GameService.getTeamPrivateState(team.id);
    expect(state.level2?.media.is_visible).toBe(false);
    expect(state.level2?.media.initial_window_elapsed).toBe(true);

    const activeCase = getDb().prepare('SELECT replay_cost FROM level2_cases WHERE is_active = 1 LIMIT 1').get() as { replay_cost: number };
    const res = GameService.replayCaseMedia(team.id, 'op-replay-0001');
    expect(res.credits_spent).toBe(activeCase.replay_cost);
    expect(res.remaining_credits).toBe(200 - activeCase.replay_cost);

    // Media visible again after paying.
    state = GameService.getTeamPrivateState(team.id);
    expect(state.level2?.media.is_visible).toBe(true);
    expect(state.level2?.media.replay_count).toBe(1);
  });

  it('16. Duplicate replay with the same operation_id does not double charge', () => {
    const { team, round } = startLevel2WithTeam('Idempotent Investigators');
    forceMediaHidden(round.id);

    const first = GameService.replayCaseMedia(team.id, 'op-dupe-1');
    expect(first.credits_spent).toBeGreaterThan(0);
    const after = getDb().prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as { current_credits: number };

    const second = GameService.replayCaseMedia(team.id, 'op-dupe-1');
    expect(second.credits_spent).toBe(0);
    expect(second.already_charged).toBe(true);

    const afterDup = getDb().prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as { current_credits: number };
    expect(afterDup.current_credits).toBe(after.current_credits);
  });

  it('17. Replay is rejected when the team has insufficient credits', () => {
    const { team, round } = startLevel2WithTeam('Broke Replayers');
    forceMediaHidden(round.id);
    getDb().prepare('UPDATE teams SET current_credits = 5 WHERE id = ?').run(team.id);

    expect(() => GameService.replayCaseMedia(team.id, 'op-broke-1')).toThrow(/insufficient credits/i);
    const check = getDb().prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as { current_credits: number };
    expect(check.current_credits).toBe(5);
  });

  it('18. Replay is rejected after the final answer is submitted', () => {
    const { team, round } = startLevel2WithTeam('Locked Out');
    GameService.submitConclusion(team.id, 'Our final conclusion is that the agent was hijacked via prompt injection.');
    forceMediaHidden(round.id);
    expect(() => GameService.replayCaseMedia(team.id, 'op-locked-1')).toThrow(/final answer/i);
  });

  // ---- TechBrains final-answer immutability (Phase 4) ----
  it('19. First final submission succeeds; second submission is rejected', () => {
    const { team } = startLevel2WithTeam('One Shot');
    const first = GameService.submitConclusion(team.id, 'Our conclusion: the autonomous agent was hijacked via prompt injection.');
    expect(first.status).toBe('submitted');
    expect(() =>
      GameService.submitConclusion(team.id, 'Actually we changed our mind about the conclusion entirely.')
    ).toThrow(/already been submitted/i);
  });

  it('20. Clue purchase is rejected after the final answer is submitted', () => {
    const { team } = startLevel2WithTeam('Spend After Lock');
    const clue = getDb().prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;
    GameService.submitConclusion(team.id, 'Final answer: the badge was cloned and the agent executed the attack.');
    expect(() => GameService.unlockLevel2Clue(team.id, clue.id)).toThrow(/final answer/i);
  });

  it('21. Database trigger blocks any UPDATE of a submitted conclusion (defense in depth)', () => {
    const { team } = startLevel2WithTeam('Immutable Ink');
    const c = GameService.submitConclusion(team.id, 'Final: zero-width prompt injection triggered breaker isolation.');
    expect(() =>
      getDb().prepare(`UPDATE conclusions SET conclusion_text = 'tampered' WHERE id = ?`).run(c.id)
    ).toThrow(/IMMUTABLE_CONCLUSION/);
  });

  // ---- TechBrains leaderboard authorization (Phase 8) ----
  it('22. Admin token verification cannot be bypassed by a forged/presence cookie', async () => {
    const { verifyAdminToken } = await import('../middleware/auth.js');
    const { hashToken } = await import('../utils/crypto.js');

    // Forged / mere-presence tokens are rejected.
    expect(verifyAdminToken(undefined)).toBeNull();
    expect(verifyAdminToken('anything')).toBeNull();
    expect(verifyAdminToken('not-a-real-id:deadbeef')).toBeNull();

    // A correctly signed token for a real admin is accepted.
    const admin = getDb().prepare('SELECT * FROM admin_users LIMIT 1').get() as any;
    const goodToken = `${admin.id}:${hashToken(admin.id + admin.password_hash)}`;
    expect(verifyAdminToken(goodToken)?.id).toBe(admin.id);

    // A valid id with a wrong signature is rejected.
    expect(verifyAdminToken(`${admin.id}:wrongsignature`)).toBeNull();
  });

  // ---- TechBrains concurrency & integrity (Phase 12) ----
  it('23. Rapid duplicate clue unlocks (same operation) charge exactly once', async () => {
    const { team } = startLevel2WithTeam('Rapid Clickers');
    const clue = getDb().prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;

    // Fire several unlocks for the same clue "simultaneously".
    await Promise.all(
      Array.from({ length: 6 }).map(() =>
        Promise.resolve().then(() => {
          try { GameService.unlockLevel2Clue(team.id, clue.id, 'op-same-clue'); } catch { /* ignore */ }
        })
      )
    );

    const unlocks = getDb().prepare('SELECT COUNT(*) as c FROM clue_unlocks WHERE team_id = ? AND clue_id = ?').get(team.id, clue.id) as any;
    const tx = getDb().prepare("SELECT COUNT(*) as c FROM credit_transactions WHERE team_id = ? AND transaction_type = 'clue_unlock'").get(team.id) as any;
    
    // Initialize level 1 pool and check that balance
    GameService.initLevelCredits(team.id, 1, 200);
    const level1Balance = GameService.getLevelBalance(team.id, 1);
    
    expect(unlocks.c).toBe(1);
    expect(tx.c).toBe(1);
    expect(level1Balance).toBe(200 - clue.credit_cost);
  });

  it('24. Credits can never go negative across many purchases and replays', async () => {
    const { team, round } = startLevel2WithTeam('Big Spenders');
    const clues = getDb().prepare('SELECT * FROM clues WHERE is_active = 1 ORDER BY credit_cost ASC').all() as any[];

    // Initialize level 1 credits for clue unlocking
    GameService.initLevelCredits(team.id, 1, 200);

    // Unlock every clue (uses level 1 credits)
    for (const c of clues) {
      try { GameService.unlockLevel2Clue(team.id, c.id, `op-${c.id}`); } catch { /* insufficient is fine */ }
    }
    
    // Media replays still use current_credits (legacy system)
    // Then hammer replays until credits run out.
    forceMediaHidden(round.id);
    for (let i = 0; i < 50; i++) {
      try { GameService.replayCaseMedia(team.id, `op-replay-${i}`); forceMediaHidden(round.id); } catch { /* insufficient is fine */ }
    }

    // Both level 1 credits and current_credits should be >= 0
    const level1Balance = GameService.getLevelBalance(team.id, 1);
    const t = getDb().prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as any;
    
    expect(level1Balance).toBeGreaterThanOrEqual(0);
    expect(t.current_credits).toBeGreaterThanOrEqual(0);
  });

  it('25. Only one of several concurrent final submissions is accepted', async () => {
    const { team } = startLevel2WithTeam('Race Condition');
    const results = await Promise.allSettled(
      Array.from({ length: 4 }).map(() =>
        Promise.resolve().then(() => GameService.submitConclusion(team.id, 'Our single final conclusion about the breach vector.'))
      )
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(ok).toBe(1);
    expect(rejected).toBe(3);

    const rows = getDb().prepare('SELECT COUNT(*) as c FROM conclusions WHERE team_id = ?').get(team.id) as any;
    expect(rows.c).toBe(1);
  });

  it('26. A team cannot see another team\'s answers via private state', () => {
    const { team: a } = GameService.registerTeam('Team A Priv');
    const { team: b } = GameService.registerTeam('Team B Priv');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    GameService.startRound(admin.id, 1);

    // Team A answers its first question.
    const qa = getDb().prepare('SELECT question_id FROM team_question_assignments WHERE team_id = ? ORDER BY question_order LIMIT 1').get(a.id) as any;
    GameService.submitLevel1Answer(a.id, qa.question_id, 'AI');

    const aState = GameService.getTeamPrivateState(a.id);
    const bState = GameService.getTeamPrivateState(b.id);
    expect(aState.level1?.answered_count).toBe(1);
    expect(bState.level1?.answered_count).toBe(0); // B sees only its own progress
  });

  // ================= TechBrains Two-Level Credit Pools =================
  
  it('CREDIT-POOL-1. Level credit pools initialize independently and can be managed separately', () => {
    const { team } = GameService.registerTeam('Credit Pool Team');
    
    // Initially null (not initialized)
    expect(GameService.getLevelBalance(team.id, 1)).toBeNull();
    expect(GameService.getLevelBalance(team.id, 2)).toBeNull();
    
    // Initialize with different amounts
    expect(GameService.initLevelCredits(team.id, 1, 300)).toBe(300);
    expect(GameService.initLevelCredits(team.id, 2, 500)).toBe(500);
    
    // Check balances
    expect(GameService.getLevelBalance(team.id, 1)).toBe(300);
    expect(GameService.getLevelBalance(team.id, 2)).toBe(500);
    
    // Re-init is idempotent (no change)
    expect(GameService.initLevelCredits(team.id, 1, 999)).toBe(300); // still 300
    expect(GameService.initLevelCredits(team.id, 2, 999)).toBe(500); // still 500
  });
  
  it('CREDIT-POOL-2. Level credit spending is isolated between pools', () => {
    const { team } = GameService.registerTeam('Spend Pool Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    
    // Need Round 2 active for spending
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);
    
    // Initialize both pools
    GameService.initLevelCredits(team.id, 1, 300);
    GameService.initLevelCredits(team.id, 2, 500);
    
    // Spend from level 1 pool
    const result1 = GameService.spendLevelCredits(team.id, 1, 50, 'op-1', 'clue_unlock');
    expect(result1.charged).toBe(true);
    expect(result1.remaining).toBe(250);
    
    // Level 2 pool should be untouched
    expect(GameService.getLevelBalance(team.id, 1)).toBe(250);
    expect(GameService.getLevelBalance(team.id, 2)).toBe(500);
    
    // Spend from level 2 pool
    const result2 = GameService.spendLevelCredits(team.id, 2, 100, 'op-2', 'clue_unlock');
    expect(result2.charged).toBe(true);
    expect(result2.remaining).toBe(400);
    
    // Final balances
    expect(GameService.getLevelBalance(team.id, 1)).toBe(250);
    expect(GameService.getLevelBalance(team.id, 2)).toBe(400);
  });
  
  it('CREDIT-POOL-3. Insufficient credits are rejected without modifying balance', () => {
    const { team } = GameService.registerTeam('Insufficient Pool Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);
    
    // Initialize with small amount
    GameService.initLevelCredits(team.id, 1, 50);
    
    // Try to spend more than available
    expect(() => {
      GameService.spendLevelCredits(team.id, 1, 100, 'op-fail', 'clue_unlock');
    }).toThrow(/insufficient.*Level 1 credits/i);
    
    // Balance should be unchanged
    expect(GameService.getLevelBalance(team.id, 1)).toBe(50);
  });

  it('CREDIT-POOL-4. Clue unlocking uses level-specific credit pools', () => {
    const { team } = GameService.registerTeam('Level Pool Clue Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    
    // Start Round 2
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);
    
    // Initialize both level pools with different amounts
    GameService.initLevelCredits(team.id, 1, 300);
    GameService.initLevelCredits(team.id, 2, 500);
    
    // Get a clue and set it to require level 1 credits
    const db = getDb();
    const clue = db.prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;
    
    // Set clue to require level 1 credits (default is already 1, but be explicit)
    db.prepare('UPDATE clues SET required_level = 1 WHERE id = ?').run(clue.id);
    
    // Unlock clue - should deduct from level 1 pool
    const result = GameService.unlockLevel2Clue(team.id, clue.id);
    
    expect(result.credits_spent).toBe(clue.credit_cost);
    expect(result.remaining_credits).toBe(300 - clue.credit_cost); // level 1 pool
    
    // Verify level pools
    expect(GameService.getLevelBalance(team.id, 1)).toBe(300 - clue.credit_cost); // decreased
    expect(GameService.getLevelBalance(team.id, 2)).toBe(500); // unchanged
    
    // Legacy current_credits should be unchanged
    const teamRow = db.prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as any;
    expect(teamRow.current_credits).toBe(200); // initial default, unchanged
  });

  // ================= TechBrains Round 1 per-question timer & qualification =================

  function latestL1RoundId(): string {
    return (getDb().prepare("SELECT id FROM rounds WHERE level = 1 ORDER BY created_at DESC LIMIT 1").get() as any).id;
  }

  it('R1-T1. Each Round 1 question carries its own persisted timer, surfaced server-side', () => {
    const { team } = GameService.registerTeam('Timer Persist');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    GameService.startRound(admin.id, 1);

    const state = GameService.getTeamPrivateState(team.id);
    const q = state.level1?.current_question;
    expect(q).toBeTruthy();
    // The per-question timer comes from the DB, not a hard-coded client value.
    const dbQ = getDb().prepare('SELECT time_limit_seconds FROM level1_questions WHERE id = ?').get(q!.id) as { time_limit_seconds: number };
    expect(q!.time_limit_seconds).toBe(dbQ.time_limit_seconds);
    expect(q!.time_limit_seconds).toBeGreaterThan(0);
    // The current question carries a server-authoritative deadline.
    expect(q!.deadline_at).toBeTruthy();
    // server_time is provided for client reconciliation.
    expect(state.level1?.server_time).toBeTruthy();
  });

  it('R1-T2. Correct answer is hidden before submission and returned only after acceptance', () => {
    const { team } = GameService.registerTeam('Reveal Rules');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    GameService.startRound(admin.id, 1);

    const state = GameService.getTeamPrivateState(team.id);
    const q = state.level1!.current_question!;
    // Hidden before submission (no leak via private state).
    expect((q as any).correct_answer).toBeUndefined();

    const dbQ = getDb().prepare('SELECT correct_answer FROM level1_questions WHERE id = ?').get(q.id) as { correct_answer: string };
    const res = GameService.submitLevel1Answer(team.id, q.id, 'AI');
    // Returned after acceptance, only in this team's own submit response.
    expect(res.correct_answer).toBe(dbQ.correct_answer);
  });

  it('R1-T3. A timed-out question gives 0, cannot be answered later, and is skipped', () => {
    const { team } = GameService.registerTeam('Timeout Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    GameService.startRound(admin.id, 1);

    // Serve the first question (stamps served_at + deadline_at).
    const first = GameService.getTeamPrivateState(team.id).level1!.current_question!;
    const roundId = latestL1RoundId();

    // Force this question's deadline into the past → authoritative timeout.
    getDb()
      .prepare('UPDATE team_question_assignments SET deadline_at = ? WHERE round_id = ? AND team_id = ? AND question_id = ?')
      .run(new Date(Date.now() - 1000).toISOString(), roundId, team.id, first.id);

    // It can no longer be answered.
    expect(() => GameService.submitLevel1Answer(team.id, first.id, 'AI')).toThrow(/time is up|timed out/i);

    // Timeout awards 0 (no team_answers row, score unchanged).
    const score = (getDb().prepare('SELECT level1_score FROM teams WHERE id = ?').get(team.id) as any).level1_score;
    expect(score).toBe(0);
    const answerRows = (getDb().prepare('SELECT COUNT(*) as c FROM team_answers WHERE team_id = ?').get(team.id) as any).c;
    expect(answerRows).toBe(0);

    // The server skips the timed-out question and serves the next one.
    const next = GameService.getTeamPrivateState(team.id).level1!.current_question;
    expect(next).toBeTruthy();
    expect(next!.id).not.toBe(first.id);
  });

  it('R1-T4. A refresh during the result window cannot re-answer an answered question', () => {
    const { team } = GameService.registerTeam('No Double Score');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    GameService.startRound(admin.id, 1);

    const q = GameService.getTeamPrivateState(team.id).level1!.current_question!;
    GameService.submitLevel1Answer(team.id, q.id, 'AI');

    // Simulated refresh: re-fetch state, then a duplicate submit must be rejected.
    const refreshed = GameService.getTeamPrivateState(team.id);
    expect(refreshed.level1?.current_question?.id).not.toBe(q.id); // advanced to next
    expect(() => GameService.submitLevel1Answer(team.id, q.id, 'HUMAN')).toThrow(/already submitted/i);
  });

  it('R1-T5. Qualification: score >= cutoff qualifies; score < cutoff does not', () => {
    const { team } = GameService.registerTeam('Cutoff Logic');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

    // Cutoff of 1 with a team score of 0 → not qualified.
    GameService.updateSettings(admin.id, { round1CutoffScore: 1 });
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);

    let t = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    let settings = GameService.getGameSession().settings;
    expect(settings.round1CutoffScore).toBe(1); // persisted
    expect(GameService.isTeamQualifiedForRound2(t, settings)).toBe(false);

    // Raise the team's score to meet the cutoff → qualified.
    getDb().prepare('UPDATE teams SET level1_score = 1 WHERE id = ?').run(team.id);
    t = getDb().prepare('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    expect(GameService.isTeamQualifiedForRound2(t, settings)).toBe(true);
  });

  it('R1-T6. An unqualified team is blocked from Round 2 (state + every mutation)', () => {
    const { team } = GameService.registerTeam('Blocked Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

    GameService.updateSettings(admin.id, { round1CutoffScore: 10 }); // team will have score 0
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    // Private state reports not-qualified and exposes NO Round 2 data.
    const state = GameService.getTeamPrivateState(team.id);
    expect(state.round2_qualified).toBe(false);
    expect(state.level2).toBeUndefined();

    // Every Round 2 mutation is rejected server-side.
    const clue = getDb().prepare('SELECT * FROM clues WHERE is_active = 1 LIMIT 1').get() as any;
    expect(() => GameService.unlockLevel2Clue(team.id, clue.id)).toThrow(/not qualified/i);
    expect(() => GameService.replayCaseMedia(team.id, 'op-unqual-1')).toThrow(/not qualified/i);
    expect(() => GameService.submitConclusion(team.id, 'A sufficiently long final answer for testing.')).toThrow(/not qualified/i);
  });

  it('R1-T7. A qualified team can enter Round 2 and receives case data', () => {
    const { team } = GameService.registerTeam('Allowed Team');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

    GameService.updateSettings(admin.id, { round1CutoffScore: 0 }); // score 0 >= 0 → qualified
    GameService.startRound(admin.id, 1);
    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    const state = GameService.getTeamPrivateState(team.id);
    expect(state.round2_qualified).toBe(true);
    expect(state.level2).toBeDefined();
    expect(state.level2?.clues.length).toBeGreaterThan(0);
  });

  // ================= TEAM-STATE ISOLATION (the P0 LAN concurrency bug) =================

  function answerAllForTeam(teamId: string, answer: 'AI' | 'HUMAN' | 'CANT_DEFINE' = 'AI') {
    const roundId = latestL1RoundId();
    const qs = getDb()
      .prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? ORDER BY question_order ASC')
      .all(roundId, teamId) as { question_id: string }[];
    for (const q of qs) GameService.submitLevel1Answer(teamId, q.question_id, answer);
    return qs.length;
  }

  it('ISO-1. One team completing Round 1 does NOT change any other team', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { team: A } = GameService.registerTeam('Iso A');
    const { team: B } = GameService.registerTeam('Iso B');
    const { team: C } = GameService.registerTeam('Iso C');
    const { team: D } = GameService.registerTeam('Iso D');
    GameService.startRound(admin.id, 1);

    // B answers 3, C answers 6, D answers 0, then A answers everything.
    const roundId = latestL1RoundId();
    const take = (teamId: string, n: number) => {
      const qs = getDb()
        .prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? ORDER BY question_order ASC')
        .all(roundId, teamId) as { question_id: string }[];
      for (let i = 0; i < n; i++) GameService.submitLevel1Answer(teamId, qs[i].question_id, 'AI');
    };
    take(B.id, 3);
    take(C.id, 6);
    const total = answerAllForTeam(A.id);

    // A is done; everyone else is exactly where they left off — independently.
    const sA = GameService.getTeamPrivateState(A.id);
    const sB = GameService.getTeamPrivateState(B.id);
    const sC = GameService.getTeamPrivateState(C.id);
    const sD = GameService.getTeamPrivateState(D.id);

    expect(sA.stage).toBe('round1_done');
    expect(sA.level1?.is_completed).toBe(true);
    expect(sA.level1?.answered_count).toBe(total);

    expect(sB.stage).toBe('round1');
    expect(sB.level1?.is_completed).toBe(false);
    expect(sB.level1?.answered_count).toBe(3);
    expect(sB.level1?.current_question?.question_order).toBe(4);

    expect(sC.stage).toBe('round1');
    expect(sC.level1?.answered_count).toBe(6);
    expect(sC.level1?.current_question?.question_order).toBe(7);

    expect(sD.stage).toBe('round1');
    expect(sD.level1?.answered_count).toBe(0);
    expect(sD.level1?.current_question?.question_order).toBe(1);
  });

  it('ISO-2. Round 2 start moves ONLY qualified teams into round2; others are held', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    GameService.updateSettings(admin.id, { round1CutoffScore: 5 });
    const { team: A } = GameService.registerTeam('Q A'); // will score high
    const { team: B } = GameService.registerTeam('Q B'); // will score 0
    GameService.startRound(admin.id, 1);

    // A answers every question with the correct answer to clear the cutoff.
    const roundId = latestL1RoundId();
    const aqs = getDb()
      .prepare('SELECT tqa.question_id, q.correct_answer FROM team_question_assignments tqa JOIN level1_questions q ON q.id = tqa.question_id WHERE tqa.round_id = ? AND tqa.team_id = ? ORDER BY tqa.question_order ASC')
      .all(roundId, A.id) as { question_id: string; correct_answer: 'AI' | 'HUMAN' | 'CANT_DEFINE' }[];
    for (const q of aqs) GameService.submitLevel1Answer(A.id, q.question_id, q.correct_answer);

    GameService.endRound(admin.id, 1);
    GameService.startRound(admin.id, 2);

    const sA = GameService.getTeamPrivateState(A.id);
    const sB = GameService.getTeamPrivateState(B.id);
    expect(sA.round2_qualified).toBe(true);
    expect(sA.stage).toBe('round2');
    expect(sA.level2).toBeDefined();

    expect(sB.round2_qualified).toBe(false);
    expect(sB.stage).toBe('not_qualified');
    expect(sB.level2).toBeUndefined();
  });

  it('ISO-3. 30+ concurrent teams progress independently with zero cross-contamination', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const N = 32;
    const teams = Array.from({ length: N }).map((_, i) => GameService.registerTeam(`Scale ${i}`).team);
    GameService.startRound(admin.id, 1);

    // Baseline: every team is at question 1 with score 0.
    for (const t of teams) {
      const s = GameService.getTeamPrivateState(t.id);
      expect(s.stage).toBe('round1');
      expect(s.level1?.answered_count).toBe(0);
    }

    // Exactly ONE team (index 0) completes Round 1.
    const total = answerAllForTeam(teams[0].id);

    // The completing team is done; all other 31 teams are untouched.
    const s0 = GameService.getTeamPrivateState(teams[0].id);
    expect(s0.stage).toBe('round1_done');
    expect(s0.level1?.answered_count).toBe(total);

    for (let i = 1; i < N; i++) {
      const s = GameService.getTeamPrivateState(teams[i].id);
      expect(s.stage).toBe('round1'); // NOT round1_done / round2
      expect(s.level1?.is_completed).toBe(false);
      expect(s.level1?.answered_count).toBe(0);
      expect(s.level1?.current_question?.question_order).toBe(1);
      const score = (getDb().prepare('SELECT level1_score FROM teams WHERE id = ?').get(teams[i].id) as any).level1_score;
      expect(score).toBe(0);
    }

    // And the DB rows are strictly partitioned by team (no shared answers).
    const answerTeams = getDb().prepare('SELECT DISTINCT team_id FROM team_answers').all() as { team_id: string }[];
    expect(answerTeams.length).toBe(1);
    expect(answerTeams[0].team_id).toBe(teams[0].id);
  });

  it('ISO-4. Reconnect/refresh recovers a team\'s own state from the server, unchanged by others', () => {
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { team: A } = GameService.registerTeam('Recon A');
    const { team: B, token: tokenB } = GameService.registerTeam('Recon B');
    GameService.startRound(admin.id, 1);

    // B answers 2 questions, then A completes everything.
    const roundId = latestL1RoundId();
    const bqs = getDb().prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? ORDER BY question_order ASC').all(roundId, B.id) as { question_id: string }[];
    GameService.submitLevel1Answer(B.id, bqs[0].question_id, 'AI');
    GameService.submitLevel1Answer(B.id, bqs[1].question_id, 'AI');
    answerAllForTeam(A.id);

    // B "reconnects": re-authenticate by its token and re-read server state.
    const reconnected = GameService.authenticateTeam(tokenB);
    expect(reconnected?.id).toBe(B.id);
    const sB = GameService.getTeamPrivateState(B.id);
    expect(sB.stage).toBe('round1');
    expect(sB.level1?.answered_count).toBe(2);
    expect(sB.level1?.current_question?.question_order).toBe(3);
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

  describe('Lifecycle Bug Fixes & Multi-Session Isolation (Phase B)', () => {
    it('LIFECYCLE-1. Expired round from an archived session cannot end a newly started level', async () => {
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
      const db = getDb();

      // Create a completed previous session with an active but expired round
      const oldSessionId = uuidv4();
      db.prepare(`
        INSERT INTO game_sessions (id, name, status, settings_json, created_at, updated_at)
        VALUES (?, 'Completed Session', 'completed', '{}', datetime('now', '-2 hours'), datetime('now', '-2 hours'))
      `).run(oldSessionId);

      const oldExpiredRoundId = uuidv4();
      db.prepare(`
        INSERT INTO rounds (id, game_session_id, level, status, started_at, deadline_at, settings_snapshot_json, created_at)
        VALUES (?, ?, 1, 'active', datetime('now', '-1 hour'), datetime('now', '-30 minutes'), '{}', datetime('now', '-1 hour'))
      `).run(oldExpiredRoundId, oldSessionId);

      // Now start Level 1 in the active session
      const { round: newRound } = GameService.startRound(admin.id, 1);
      expect(newRound.status).toBe('active');

      let callbackTriggeredRoundId: string | null = null;
      // Register mock callback like server/src/index.ts does
      const mockIo = { emit: () => {} } as any;
      registerTimerCallbacks(mockIo, async (expired) => {
        callbackTriggeredRoundId = expired.id;
        try {
          await GameService.endRound(null, expired.level, expired.id);
        } catch (e) {}
      });

      // Run deadline check
      await checkAuthoritativeDeadlines();

      // The old expired round MUST NOT trigger the callback
      expect(callbackTriggeredRoundId).toBeNull();

      // The new round MUST still be active
      const currentRound = db.prepare('SELECT status FROM rounds WHERE id = ?').get(newRound.id) as any;
      expect(currentRound.status).toBe('active');

      const gameState = GameService.getPublicGameState();
      expect(gameState.status).toBe('level1_active');
    });

    it('LIFECYCLE-2. Starting Level 1 does not immediately end it or start Level 2', async () => {
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
      const { round } = GameService.startRound(admin.id, 1);

      // Call deadline check multiple times immediately after starting
      await checkAuthoritativeDeadlines();
      await checkAuthoritativeDeadlines();

      const state = GameService.getPublicGameState();
      expect(state.status).toBe('level1_active');
      expect(state.round?.id).toBe(round.id);
      expect(state.round?.status).toBe('active');
      expect(state.round?.level).toBe(1);
    });

    it('LIFECYCLE-3. Deadline monitoring only processes eligible rounds in the authoritative active session', async () => {
      const db = getDb();
      // Insert another session with an expired round
      const foreignSessionId = uuidv4();
      db.prepare(`
        INSERT INTO game_sessions (id, name, status, settings_json, created_at, updated_at)
        VALUES (?, 'Foreign Session', 'completed', '{}', datetime('now', '-1 day'), datetime('now', '-1 day'))
      `).run(foreignSessionId);

      const foreignRoundId = uuidv4();
      db.prepare(`
        INSERT INTO rounds (id, game_session_id, level, status, started_at, deadline_at, settings_snapshot_json, created_at)
        VALUES (?, ?, 2, 'active', datetime('now', '-10 minutes'), datetime('now', '-5 minutes'), '{}', datetime('now', '-10 minutes'))
      `).run(foreignRoundId, foreignSessionId);

      let triggered = false;
      registerTimerCallbacks({ emit: () => {} } as any, async () => {
        triggered = true;
      });

      await checkAuthoritativeDeadlines();
      expect(triggered).toBe(false);
    });

    it('LIFECYCLE-4. Exact round targeting cannot terminate another round or session', () => {
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
      const { round } = GameService.startRound(admin.id, 1);

      // Attempting to end with a non-existent targetRoundId must fail
      expect(() => {
        GameService.endRound(admin.id, 1, '00000000-0000-0000-0000-000000000000');
      }).toThrow();

      // Attempting to end with wrong level must fail
      expect(() => {
        GameService.endRound(admin.id, 2, round.id);
      }).toThrow();

      // Verify original round was NOT terminated by the failed attempts
      const currentRound = getDb().prepare('SELECT status FROM rounds WHERE id = ?').get(round.id) as any;
      expect(currentRound.status).toBe('active');

      const gameState = GameService.getPublicGameState();
      expect(gameState.status).toBe('level1_active');
    });

    it('LIFECYCLE-5. Reset closes the appropriate active and paused rounds while preserving historical records', () => {
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
      const { round } = GameService.startRound(admin.id, 1);
      expect(round.status).toBe('active');

      // Reset game
      GameService.resetGame(admin.id);

      // Verify the round was marked ended
      const closedRound = getDb().prepare('SELECT status, ended_at FROM rounds WHERE id = ?').get(round.id) as any;
      expect(closedRound.status).toBe('ended');
      expect(closedRound.ended_at).toBeDefined();

      // Verify new session exists and game status is idle
      const state = GameService.getPublicGameState();
      expect(state.status).toBe('idle');
      expect(state.round).toBeNull();

      // Verify historical game_sessions records were preserved
      const sessionCount = (getDb().prepare('SELECT COUNT(*) as c FROM game_sessions').get() as any).c;
      expect(sessionCount).toBeGreaterThanOrEqual(2);
    });

    it('LIFECYCLE-6. Startup recovery preserves valid current-session state', () => {
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
      const { round } = GameService.startRound(admin.id, 1);

      // Run startup recovery when round has a future deadline
      recoverRoundsOnStartup();

      // Round must still be active!
      const roundInDb = getDb().prepare('SELECT status FROM rounds WHERE id = ?').get(round.id) as any;
      expect(roundInDb.status).toBe('active');

      const state = GameService.getPublicGameState();
      expect(state.status).toBe('level1_active');
    });

    it('LIFECYCLE-7. Duplicate expiration callbacks cannot corrupt state or award scores twice', async () => {
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
      const { team } = GameService.registerTeam('Duplicate Safe');
      const { round } = GameService.startRound(admin.id, 1);

      // Submit an answer
      const roundId = latestL1RoundId();
      const q = getDb().prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? LIMIT 1').get(roundId, team.id) as { question_id: string };
      GameService.submitLevel1Answer(team.id, q.question_id, 'AI');

      // First expiration / endRound call
      const ended1 = GameService.endRound(null, 1, round.id);
      expect(ended1.session.status).toBe('level1_ended');
      expect(ended1.round.status).toBe('ended');

      const initialScore = (getDb().prepare('SELECT level1_score FROM teams WHERE id = ?').get(team.id) as any).level1_score;

      // Second consecutive call (duplicate callback) must be rejected
      expect(() => {
        GameService.endRound(null, 1, round.id);
      }).toThrow();

      // Score and state must be intact and not double-counted
      const scoreAfter = (getDb().prepare('SELECT level1_score FROM teams WHERE id = ?').get(team.id) as any).level1_score;
      expect(scoreAfter).toBe(initialScore);

      const state = GameService.getPublicGameState();
      expect(state.status).toBe('level1_ended');
    });
  });

  describe('Level 2 Investigation — Q1 PIN & Q2 Nemotron AI', () => {
    let savedAiProvider: string;

    beforeEach(() => {
      savedAiProvider = CONFIG.AI.PROVIDER;
      CONFIG.AI.PROVIDER = 'mock';
    });

    afterEach(() => {
      CONFIG.AI.PROVIDER = savedAiProvider;
    });

    it('Q1-PIN-1. Correct PIN formats (0728, 728, 7:28) normalize and validate; permutations (2780, 8270) rejected', () => {
      // Valid accepted formats
      expect(normalizeVaultPin('0728')).toBe('0728');
      expect(isVaultPinCorrect('0728')).toBe(true);

      expect(normalizeVaultPin('728')).toBe('0728');
      expect(isVaultPinCorrect('728')).toBe(true);

      expect(normalizeVaultPin('7:28')).toBe('0728');
      expect(isVaultPinCorrect('7:28')).toBe(true);

      expect(normalizeVaultPin(' 07-28 ')).toBe('0728');
      expect(isVaultPinCorrect(' 07-28 ')).toBe(true);

      expect(normalizeVaultPin('07:28')).toBe('0728');
      expect(isVaultPinCorrect('07:28')).toBe(true);

      // Permutations of the same digits must NOT be accepted
      expect(isVaultPinCorrect('2780')).toBe(false);
      expect(isVaultPinCorrect('8270')).toBe(false);
      expect(isVaultPinCorrect('2870')).toBe(false);
      expect(isVaultPinCorrect('0827')).toBe(false);

      // Arbitrary inputs
      expect(isVaultPinCorrect('1234')).toBe(false);
      expect(isVaultPinCorrect('0000')).toBe(false);
      expect(isVaultPinCorrect('')).toBe(false);
    });

    it('Q1-PIN-2. Question 1 scores deterministically (5 pts if correct, 0 pts if incorrect) without invoking Nemotron', () => {
      const { team } = GameService.registerTeam('PIN Cracker Team');
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

      GameService.startRound(admin.id, 1);
      GameService.endRound(admin.id, 1);
      GameService.startRound(admin.id, 2);

      // Correct PIN submission: awards 5 points
      const result = GameService.submitLevel2Question1(team.id, '7:28');
      expect(result.is_submitted).toBe(true);
      expect(result.is_correct).toBe(true);
      expect(result.score).toBe(5);
      expect(result.max_score).toBe(5);

      // Verify stored score
      const updatedTeam = getDb().prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
      expect(updatedTeam.level2_score).toBe(5);

      // Duplicate submission is rejected
      expect(() => {
        GameService.submitLevel2Question1(team.id, '0728');
      }).toThrow(/already been submitted/i);
    });

    it('Q1-PIN-3. Incorrect Question 1 PIN awards 0 points', () => {
      const { team } = GameService.registerTeam('Wrong PIN Team');
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

      GameService.startRound(admin.id, 1);
      GameService.endRound(admin.id, 1);
      GameService.startRound(admin.id, 2);

      const result = GameService.submitLevel2Question1(team.id, '9999');
      expect(result.is_submitted).toBe(true);
      expect(result.is_correct).toBe(false);
      expect(result.score).toBe(0);

      const updatedTeam = getDb().prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
      expect(updatedTeam.level2_score).toBe(0);
    });

    it('Q2-NEMO-1. Question 2 invokes Nemotron evaluation and receives a validated 0-5 score with structured fields', async () => {
      const { team } = GameService.registerTeam('Forensic Team A');
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

      GameService.startRound(admin.id, 1);
      GameService.endRound(admin.id, 1);
      GameService.startRound(admin.id, 2);

      const exp = 'Kabir took ORION because the exported video at 7:45 was a looped copy of 7:28. The rear maintenance hatch had broken compound and the workstation badge matched K on the ledger.';
      const res = await GameService.submitLevel2Question2(team.id, 'Kabir', exp);

      expect(res.is_submitted).toBe(true);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(5);
      expect(res.max_score).toBe(5);

      expect(res.evaluation).toBeDefined();
      expect(res.evaluation?.selected_suspect_correct).toBe(true);
      expect(res.evaluation?.accuracy_summary).toBeTruthy();
      expect(res.evaluation?.closest_answer).toBeTruthy();
      expect(res.evaluation?.feedback).toBeTruthy();
      expect(res.evaluation?.status).toBe('completed');

      // Duplicate Q2 submission rejected
      await expect(
        GameService.submitLevel2Question2(team.id, 'Kabir', 'Another explanation.')
      ).rejects.toThrow(/already been submitted/i);
    });

    it('Q2-NEMO-2. Rubric gives 0-2 for incorrect suspect even with good observations', async () => {
      const { team } = GameService.registerTeam('Wrong Suspect Team');
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

      GameService.startRound(admin.id, 1);
      GameService.endRound(admin.id, 1);
      GameService.startRound(admin.id, 2);

      // Selected Meera (wrong suspect), but mentioned the video loop
      const exp = 'Meera took it because the video was looped at 7:28 and the door access log had no entry.';
      const res = await GameService.submitLevel2Question2(team.id, 'Meera', exp);

      expect(res.is_submitted).toBe(true);
      expect(res.evaluation?.selected_suspect_correct).toBe(false);
      // Rubric: Suspect score is 0. Maximum possible is partial marks (<= 3)
      expect(res.score).toBeLessThanOrEqual(3);
    });

    it('CLUES-ISO-1. Clues and credit deductions are completely isolated between Question 1 and Question 2', () => {
      const { team } = GameService.registerTeam('Clue Isolated Team');
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

      GameService.startRound(admin.id, 1);
      GameService.endRound(admin.id, 1);
      GameService.startRound(admin.id, 2);

      // Initialize team credit pool to 200
      GameService.initLevelCredits(team.id, 1, 200);

      const db = getDb();
      const q1Clue = db.prepare("SELECT * FROM clues WHERE question_number = 1 AND tier = 'simple' LIMIT 1").get() as any;
      const q2Clue = db.prepare("SELECT * FROM clues WHERE question_number = 2 AND tier = 'simple' LIMIT 1").get() as any;

      expect(q1Clue).toBeDefined();
      expect(q2Clue).toBeDefined();
      expect(q1Clue.credit_cost).toBe(50);
      expect(q2Clue.credit_cost).toBe(50);

      // Unlock Q1 simple clue
      const un1 = GameService.unlockLevel2Clue(team.id, q1Clue.id);
      expect(un1.credits_spent).toBe(50);
      expect(un1.remaining_credits).toBe(150);

      // Verify team state: Q1 clue is unlocked, Q2 clue is NOT unlocked
      const state = GameService.getTeamPrivateState(team.id);
      const clientQ1 = state.level2?.clues.find(c => c.id === q1Clue.id);
      const clientQ2 = state.level2?.clues.find(c => c.id === q2Clue.id);

      expect(clientQ1?.is_unlocked).toBe(true);
      expect(clientQ1?.content).toBeTruthy();

      expect(clientQ2?.is_unlocked).toBe(false);
      expect(clientQ2?.content).toBeUndefined(); // Never leak locked content
    });

    it('OVERRIDE-1. Manual admin score override takes precedence and updates both questions', () => {
      const { team } = GameService.registerTeam('Override Team');
      const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };

      GameService.startRound(admin.id, 1);
      GameService.endRound(admin.id, 1);
      GameService.startRound(admin.id, 2);

      // Submit Q1 (wrong) and legacy conclusion
      GameService.submitLevel2Question1(team.id, '1111'); // 0 pts
      const conclusion = GameService.submitConclusion(team.id, 'Kabir was the person who took ORION.');

      // Admin manual override: Q1 = 5, Q2 = 4
      GameService.overrideEvaluation(admin.id, conclusion.id, 4, 'Strong', 'Verified forensic evidence manually.', 5);

      const teamRow = getDb().prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
      expect(teamRow.level2_score).toBe(9); // 5 + 4 = 9
    });
  });
});


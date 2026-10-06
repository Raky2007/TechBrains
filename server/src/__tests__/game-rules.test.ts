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
    // Incorrect AI/Human: -1
    expect(calculateLevel1Score('HUMAN', qAI)).toEqual({ isCorrect: false, awardedPoints: -1 });
    // Can't Determine: 0 (never penalised)
    expect(calculateLevel1Score('CANT_DEFINE', qAI)).toEqual({ isCorrect: false, awardedPoints: 0 });

    // Correct Human: +1
    expect(calculateLevel1Score('HUMAN', qHuman)).toEqual({ isCorrect: true, awardedPoints: 1 });
    // Incorrect AI/Human: -1
    expect(calculateLevel1Score('AI', qHuman)).toEqual({ isCorrect: false, awardedPoints: -1 });
    // Can't Determine: 0
    expect(calculateLevel1Score('CANT_DEFINE', qHuman)).toEqual({ isCorrect: false, awardedPoints: 0 });

    // Correct "Can't Determine" when that is genuinely the correct answer: still 0.
    const qCant: Level1Question = { ...qAI, id: uuidv4(), correct_answer: 'CANT_DEFINE' };
    expect(calculateLevel1Score('CANT_DEFINE', qCant)).toEqual({ isCorrect: true, awardedPoints: 0 });
  });

  it('3b. Negative scoring is applied to the team total server-side and can go below zero', () => {
    const { team } = GameService.registerTeam('Negative Nellies');
    const admin = getDb().prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const { round } = GameService.startRound(admin.id, 1);

    const assignments = getDb()
      .prepare('SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ? ORDER BY question_order ASC')
      .all(round.id, team.id) as { question_id: string }[];

    // Deliberately answer the first two AI/HUMAN questions wrongly to force -1 each.
    let wrongApplied = 0;
    for (const a of assignments) {
      const q = getDb().prepare('SELECT * FROM level1_questions WHERE id = ?').get(a.question_id) as Level1Question;
      if (q.correct_answer === 'CANT_DEFINE') continue; // skip neutral questions
      const wrongAnswer = q.correct_answer === 'AI' ? 'HUMAN' : 'AI';
      const res = GameService.submitLevel1Answer(team.id, q.id, wrongAnswer);
      expect(res.awarded_points).toBe(-1);
      expect(res.is_correct).toBe(false);
      wrongApplied++;
      if (wrongApplied === 2) break;
    }

    const updated = getDb().prepare('SELECT level1_score FROM teams WHERE id = ?').get(team.id) as { level1_score: number };
    expect(updated.level1_score).toBe(-wrongApplied);
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
    const t = getDb().prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as any;
    expect(unlocks.c).toBe(1);
    expect(tx.c).toBe(1);
    expect(t.current_credits).toBe(200 - clue.credit_cost);
  });

  it('24. Credits can never go negative across many purchases and replays', async () => {
    const { team, round } = startLevel2WithTeam('Big Spenders');
    const clues = getDb().prepare('SELECT * FROM clues WHERE is_active = 1 ORDER BY credit_cost ASC').all() as any[];

    // Unlock every clue.
    for (const c of clues) {
      try { GameService.unlockLevel2Clue(team.id, c.id, `op-${c.id}`); } catch { /* insufficient is fine */ }
    }
    // Then hammer replays until credits run out.
    forceMediaHidden(round.id);
    for (let i = 0; i < 50; i++) {
      try { GameService.replayCaseMedia(team.id, `op-replay-${i}`); forceMediaHidden(round.id); } catch { /* insufficient is fine */ }
    }

    const t = getDb().prepare('SELECT current_credits FROM teams WHERE id = ?').get(team.id) as any;
    expect(t.current_credits).toBeGreaterThanOrEqual(0);

    // Ledger must reconcile: initial - sum(spends) == current balance.
    const spent = getDb().prepare('SELECT COALESCE(SUM(-amount),0) as s FROM credit_transactions WHERE team_id = ? AND amount < 0').get(team.id) as any;
    expect(200 - spent.s).toBe(t.current_credits);
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

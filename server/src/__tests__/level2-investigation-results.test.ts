import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';

import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { GameService, normalizeVaultPin, isVaultPinCorrect } from '../services/gameService.js';
import gameRoutes from '../routes/gameRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';
import authRoutes from '../routes/authRoutes.js';
import * as aiEvalService from '../services/aiEvaluationService.js';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_l2_results.db');

describe('Level 2 Investigation, Clues & Results Leaderboard', () => {
  let app: Express;
  let server: http.Server;
  let serverPort: number;
  let adminId: string;

  beforeEach(async () => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {
        // Ignored
      }
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

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);
    app.use('/api/game', gameRoutes);
    app.use('/api/admin', adminRoutes);

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch {
        // Ignored
      }
    }
  });

  describe('Part 2 — Question 1: Vault Keypad PIN Validation & Clues', () => {
    it('normalizes and accepts 0728, 728, 7:28, and ignores spaces and dashes', () => {
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
    });

    it('rejects incorrect PINs and permutations deterministically', () => {
      expect(isVaultPinCorrect('2780')).toBe(false);
      expect(isVaultPinCorrect('8270')).toBe(false);
      expect(isVaultPinCorrect('2870')).toBe(false);
      expect(isVaultPinCorrect('0827')).toBe(false);
      expect(isVaultPinCorrect('1234')).toBe(false);
      expect(isVaultPinCorrect('0000')).toBe(false);
      expect(isVaultPinCorrect('')).toBe(false);
    });

    it('awards 5 points for correct PIN and 0 points for incorrect PIN', () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team: team1 } = GameService.registerTeam('Team Alpha', 'P1', 'P2');
      const { team: team2 } = GameService.registerTeam('Team Beta', 'P3', 'P4');

      GameService.initLevelCredits(team1.id, 2, 200);
      GameService.initLevelCredits(team2.id, 2, 200);

      // Team 1 submits correct PIN '0728'
      const res1 = GameService.submitLevel2Question1(team1.id, '0728');
      expect(res1.is_correct).toBe(true);
      expect(res1.score).toBe(5);

      // Team 2 submits incorrect PIN '1234'
      const res2 = GameService.submitLevel2Question1(team2.id, '1234');
      expect(res2.is_correct).toBe(false);
      expect(res2.score).toBe(0);
    });

    it('Question 1 clues never reveal the PIN 0728 directly', () => {
      const db = getDb();
      const case1 = db.prepare("SELECT * FROM level2_cases WHERE title = 'The Vanishing Prototype'").get() as any;
      const q1Clues = db.prepare('SELECT * FROM clues WHERE case_id = ? AND question_number = 1').all(case1.id) as any[];
      expect(q1Clues.length).toBe(3);

      for (const clue of q1Clues) {
        expect(clue.content).not.toContain('0728');
        expect(clue.content).not.toContain('7:28');
        // Q1 High clue must not leak Question 2 suspect answer (Kabir)
        expect(clue.content.toLowerCase()).not.toContain('kabir');
      }
    });
  });

  describe('Part 3 — Question 2: Suspect Selection, Rubric & Clue Isolation', () => {
    it('isolates clues between Question 1 and Question 2 and enforces pricing', () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const db = getDb();
      const case1 = db.prepare("SELECT * FROM level2_cases WHERE title = 'The Vanishing Prototype'").get() as any;
      const { team } = GameService.registerTeam('Clue Team', 'P1', 'P2');
      db.prepare('UPDATE teams SET assigned_case_id = ? WHERE id = ?').run(case1.id, team.id);
      GameService.initLevelCredits(team.id, 2, 200);

      const q1Simple = db.prepare("SELECT * FROM clues WHERE case_id = ? AND question_number = 1 AND tier = 'simple'").get(case1.id) as any;
      const q1Med = db.prepare("SELECT * FROM clues WHERE case_id = ? AND question_number = 1 AND tier = 'medium'").get(case1.id) as any;
      const q1High = db.prepare("SELECT * FROM clues WHERE case_id = ? AND question_number = 1 AND tier = 'high'").get(case1.id) as any;

      const q2Simple = db.prepare("SELECT * FROM clues WHERE case_id = ? AND question_number = 2 AND tier = 'simple'").get(case1.id) as any;
      const q2Med = db.prepare("SELECT * FROM clues WHERE case_id = ? AND question_number = 2 AND tier = 'medium'").get(case1.id) as any;
      const q2High = db.prepare("SELECT * FROM clues WHERE case_id = ? AND question_number = 2 AND tier = 'high'").get(case1.id) as any;

      expect(q1Simple.credit_cost).toBe(10);
      expect(q1Med.credit_cost).toBe(50);
      expect(q1High.credit_cost).toBe(70);

      expect(q2Simple.credit_cost).toBe(30);
      expect(q2Med.credit_cost).toBe(60);
      expect(q2High.credit_cost).toBe(70);

      // Unlock Q1 Simple (10 CR)
      const u1 = GameService.unlockLevel2Clue(team.id, q1Simple.id, 'op-q1-1');
      expect(u1.credits_spent).toBe(10);
      expect(u1.remaining_credits).toBe(190);

      // State check: Q1 Simple is unlocked, Q2 Simple is locked
      const state = GameService.getTeamPrivateState(team.id);
      const clueMap = new Map(state.level2!.clues.map((c) => [c.id, c]));
      expect(clueMap.get(q1Simple.id)?.is_unlocked).toBe(true);
      expect(clueMap.get(q1Simple.id)?.content).toBeDefined();
      expect(clueMap.get(q2Simple.id)?.is_unlocked).toBe(false);
      expect(clueMap.get(q2Simple.id)?.content).toBeUndefined();

      // Idempotent duplicate purchase with same operation_id
      const u1Dup = GameService.unlockLevel2Clue(team.id, q1Simple.id, 'op-q1-1');
      expect(u1Dup.already_unlocked).toBe(true);
      expect(u1Dup.remaining_credits).toBe(190);
    });

    it('evaluates Question 2 suspect selection and evidence through AI rubric', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team } = GameService.registerTeam('Detective Team', 'P1', 'P2');
      GameService.initLevelCredits(team.id, 2, 200);

      vi.spyOn(aiEvalService, 'evaluateCaseAnswer').mockResolvedValueOnce({
        score: 5,
        max_score: 5,
        suspect_score: 2,
        evidence_score: 2,
        logic_score: 1,
        selected_suspect_correct: true,
        closest_answer: 'Kabir looped the 7:28 PM video footage and exported at 7:45 PM.',
        accuracy_summary: 'Full evidence identified and verified.',
        matched_evidence: ['Looped video at 7:28', 'Maintenance hatch seal broken', 'Workstation log at 7:20 PM'],
        missing_evidence: [],
        feedback: 'Excellent forensic deduction.',
        status: 'completed',
        verdict: 'Accurate',
        reasoning: 'Correct suspect and both key evidence points cited.',
        provider: 'openrouter',
        model: 'nemotron'
      });

      const res = await GameService.submitLevel2Question2(
        team.id,
        'Kabir',
        'Kabir looped the video footage from 7:28 PM and exported at 7:45 PM to fake an empty lab, while his workstation login was at 7:20 PM and key ledger badge matches.'
      );

      expect(res.score).toBe(5);
      expect(res.evaluation?.selected_suspect_correct).toBe(true);

      const db = getDb();
      const updatedTeam = db.prepare('SELECT level2_score FROM teams WHERE id = ?').get(team.id) as any;
      expect(updatedTeam.level2_score).toBe(5);
    });

    it('handles AI provider failures safely without crashing or setting score undefined', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team } = GameService.registerTeam('Failover Team', 'P1', 'P2');
      GameService.initLevelCredits(team.id, 2, 200);

      vi.spyOn(aiEvalService, 'evaluateCaseAnswer').mockRejectedValueOnce(new Error('OpenRouter API 503 Overloaded'));

      const res = await GameService.submitLevel2Question2(
        team.id,
        'Kabir',
        'Kabir managed recordings and looped the CCTV camera feed.'
      );

      expect(res.is_submitted).toBe(true);
      expect(res.score).toBe(0);
      expect(res.evaluation?.status).toBe('failed');
      expect(res.evaluation?.feedback).toContain('safely recorded');
    });
  });

  describe('Part 4 & Part 5 — Dedicated Completion Route, Publication Gating & Empty Leaderboard Fix', () => {
    it('GET /api/game/my-result returns score breakdown and is_published=false before admin publishes', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team, token } = GameService.registerTeam('Finish Team', 'P1', 'P2');
      GameService.initLevelCredits(team.id, 2, 200);

      // Submit Q1 (5 pts) and Q2 (2 pts)
      GameService.submitLevel2Question1(team.id, '0728');
      vi.spyOn(aiEvalService, 'evaluateCaseAnswer').mockResolvedValueOnce({
        score: 2,
        max_score: 5,
        suspect_score: 2,
        evidence_score: 0,
        logic_score: 0,
        selected_suspect_correct: true,
        closest_answer: 'Kabir',
        accuracy_summary: 'Correct suspect',
        matched_evidence: [],
        missing_evidence: ['Looped video'],
        feedback: 'Cite evidence',
        status: 'completed',
        verdict: 'Partial',
        reasoning: 'Suspect only',
        provider: 'openrouter',
        model: 'nemotron'
      });
      await GameService.submitLevel2Question2(team.id, 'Kabir', 'I think Kabir took ORION.');

      // Query /api/game/my-result
      const response = await fetch(`http://127.0.0.1:${serverPort}/api/game/my-result`, {
        headers: { 'x-team-token': token }
      });
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data.is_published).toBe(false);
      expect(data.has_completed_l2).toBe(true);
      expect(data.result).toBeDefined();
      expect(data.result.level2_score).toBe(7);
      expect(data.result.final_score).toBe(7);
      // Competitive rank is stripped from participant result
      expect(data.result.rank).toBeUndefined();
    });

    it('GET /api/game/leaderboard returns 200 with empty leaderboard when unpublished, preventing client 403 crash', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team, token } = GameService.registerTeam('Waiting Team', 'P1', 'P2');
      GameService.initLevelCredits(team.id, 2, 200);

      const response = await fetch(`http://127.0.0.1:${serverPort}/api/game/leaderboard`, {
        headers: { 'x-team-token': token }
      });
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data.is_published).toBe(false);
      expect(data.leaderboard).toEqual([]);
      expect(data.message).toContain('not been published yet');
    });

    it('GET /api/game/leaderboard returns authoritative rankings after admin publishes results', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team: t1, token: tok1 } = GameService.registerTeam('Team 1', 'P1', 'P2');
      const { team: t2 } = GameService.registerTeam('Team 2', 'P3', 'P4');
      const { team: bannedTeam } = GameService.registerTeam('Cheater Team', 'P5', 'P6');

      GameService.initLevelCredits(t1.id, 2, 200);
      GameService.initLevelCredits(t2.id, 2, 200);
      GameService.initLevelCredits(bannedTeam.id, 2, 200);

      // t1: 5 pts
      GameService.submitLevel2Question1(t1.id, '0728');
      // t2: 0 pts
      GameService.submitLevel2Question1(t2.id, '1111');
      // Ban bannedTeam
      GameService.banTeam(adminId, bannedTeam.id, 'Dishonesty');

      // Stop event before publishing final results (authoritative lifecycle gating)
      GameService.stopEvent(adminId);

      // Admin publishes results
      GameService.publishFinalResults(adminId);

      const response = await fetch(`http://127.0.0.1:${serverPort}/api/game/leaderboard`, {
        headers: { 'x-team-token': tok1 }
      });
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data.is_published).toBe(true);
      expect(data.leaderboard.length).toBe(2);

      // Banned team is excluded from public leaderboard
      const teamIds = data.leaderboard.map((e: any) => e.team_id);
      expect(teamIds).toContain(t1.id);
      expect(teamIds).toContain(t2.id);
      expect(teamIds).not.toContain(bannedTeam.id);

      // Check ranking order: Team 1 has 5 pts (Rank 1), Team 2 has 0 pts (Rank 2)
      expect(data.leaderboard[0].team_id).toBe(t1.id);
      expect(data.leaderboard[0].rank).toBe(1);
      expect(data.leaderboard[0].final_score).toBe(5);

      expect(data.leaderboard[1].team_id).toBe(t2.id);
      expect(data.leaderboard[1].rank).toBe(2);
      expect(data.leaderboard[1].final_score).toBe(0);
    });

    it('participant endpoints never expose reference answers or organizer guidance', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team } = GameService.registerTeam('Audit Team', 'P1', 'P2');
      GameService.initLevelCredits(team.id, 2, 200);

      const state = GameService.getTeamPrivateState(team.id);
      expect(state.level2?.case?.id).toBeDefined();

      const casePayload = state.level2?.case as any;
      expect(casePayload.reference_answer).toBeUndefined();
      expect(casePayload.evaluation_guidance).toBeUndefined();
      expect(casePayload.rubric_json).toBeUndefined();
    });
  });

  describe('Part 6 — Case 2: The Examination Paper Mystery', () => {
    it('validates Question 1 PIN 0824 and accepted format variations', () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const db = getDb();
      const case2 = db.prepare("SELECT * FROM level2_cases WHERE title = 'The Examination Paper Mystery'").get() as any;
      expect(case2).toBeDefined();
      expect(case2.q1_correct_pin).toBe('0824');

      // Test PIN variations
      const formats = ['0824', '08 24', '08-24', '08:24', '824'];
      for (let i = 0; i < formats.length; i++) {
        const { team } = GameService.registerTeam(`Case 2 Team ${i}`, `P1_${i}`, `P2_${i}`);
        db.prepare('UPDATE teams SET assigned_case_id = ? WHERE id = ?').run(case2.id, team.id);

        const res = GameService.submitLevel2Question1(team.id, formats[i]);
        expect(res.is_correct).toBe(true);
        expect(res.score).toBe(5);
      }

      // Test incorrect PIN
      const { team: teamWrong } = GameService.registerTeam('Case 2 Wrong Team', 'P1_W', 'P2_W');
      db.prepare('UPDATE teams SET assigned_case_id = ? WHERE id = ?').run(case2.id, teamWrong.id);
      const wrongRes = GameService.submitLevel2Question1(teamWrong.id, '9999');
      expect(wrongRes.is_correct).toBe(false);
      expect(wrongRes.score).toBe(0);
    });

    it('verifies Case 2 clues pricing and confidentiality', () => {
      const db = getDb();
      const case2 = db.prepare("SELECT * FROM level2_cases WHERE title = 'The Examination Paper Mystery'").get() as any;
      const clues = db.prepare('SELECT * FROM clues WHERE case_id = ? ORDER BY question_number ASC, credit_cost ASC').all(case2.id) as any[];

      expect(clues.length).toBe(6);

      // Q1 clues: 10, 20, 30
      const q1Clues = clues.filter(c => c.question_number === 1);
      expect(q1Clues.map(c => c.credit_cost)).toEqual([10, 20, 30]);

      // Q2 clues: 10, 20, 30
      const q2Clues = clues.filter(c => c.question_number === 2);
      expect(q2Clues.map(c => c.credit_cost)).toEqual([10, 20, 30]);

      // Q1 clues must not directly give away the full PIN 0824
      for (const clue of q1Clues) {
        expect(clue.content).not.toContain('0824');
      }
    });

    it('evaluates Question 2 hiding place and visual evidence with mock evaluator', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const db = getDb();
      const case2 = db.prepare("SELECT * FROM level2_cases WHERE title = 'The Examination Paper Mystery'").get() as any;
      const { team } = GameService.registerTeam('Hiding Place Team', 'P1', 'P2');
      db.prepare('UPDATE teams SET assigned_case_id = ? WHERE id = ?').run(case2.id, team.id);

      // Test mock evaluation for Case 2
      const evalResult = aiEvalService.mockEvaluate({
        caseTitle: case2.title,
        selectedSuspect: 'Inside a hollow compartment beneath the examination desk',
        teamAnswer: 'We observed a loose underside panel beneath the wooden desk with folded papers partly visible inside the hollow space.',
        explanation: 'We observed a loose underside panel beneath the wooden desk with folded papers partly visible inside the hollow space.'
      }, 5);

      expect(evalResult.score).toBe(5);
      expect(evalResult.suspect_score).toBe(2);
      expect(evalResult.evidence_score).toBe(2);
      expect(evalResult.logic_score).toBe(1);
    });
  });

  describe('Part 7 — Focused Verification of Level 2 Submission, Timer & Leaderboard + Level 1 Progression', () => {
    it('1. Level 2 submission: after both answers are submitted, the team is marked complete and its timer stops or freezes for that team', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      const { round: r2 } = GameService.startRound(adminId, 2);

      const { team: teamA } = GameService.registerTeam('Team Alpha L2', 'P1_A', 'P2_A');
      const { team: teamB } = GameService.registerTeam('Team Beta L2', 'P1_B', 'P2_B');
      GameService.initLevelCredits(teamA.id, 2, 200);
      GameService.initLevelCredits(teamB.id, 2, 200);

      // Team A submits Question 1
      GameService.submitLevel2Question1(teamA.id, '0728');
      expect(GameService.isTeamLevel2Completed(r2.id, teamA.id)).toBe(false);

      // Team A submits Question 2
      vi.spyOn(aiEvalService, 'evaluateCaseAnswer').mockResolvedValueOnce({
        score: 4,
        max_score: 5,
        suspect_score: 2,
        evidence_score: 2,
        logic_score: 0,
        selected_suspect_correct: true,
        closest_answer: 'Kabir',
        accuracy_summary: 'Identified Kabir with evidence',
        matched_evidence: ['Looped video'],
        missing_evidence: [],
        feedback: 'Good deduction',
        status: 'completed',
        verdict: 'Accepted',
        reasoning: 'Evidence linked',
        provider: 'openrouter',
        model: 'nemotron'
      });
      await GameService.submitLevel2Question2(teamA.id, 'Kabir', 'Kabir looped the video feed at 7:28.');

      // 1. Authoritative check marks investigation complete for Team A
      expect(GameService.isTeamLevel2Completed(r2.id, teamA.id)).toBe(true);

      const stateA = GameService.getTeamPrivateState(teamA.id);
      expect(stateA.level2?.is_completed).toBe(true);
      expect(stateA.level2?.completed_at).toBeDefined();
      expect(typeof stateA.level2?.frozen_remaining_seconds).toBe('number');
      expect(stateA.level2?.frozen_remaining_seconds).toBeGreaterThan(0);
      expect(stateA.stage).toBe('result');

      // 2. Global round timer for Team B is NOT stopped
      const stateB = GameService.getTeamPrivateState(teamB.id);
      expect(stateB.level2?.is_completed).toBe(false);
      expect(stateB.stage).toBe('round2');
      const { activeRound } = GameService.getGameSession();
      expect(activeRound?.status).toBe('active');

      // 3. Prevent duplicate submissions and further clue purchases
      const clue = getDb().prepare('SELECT id FROM clues WHERE case_id = ? LIMIT 1').get(stateA.level2?.case?.id) as any;
      expect(() => GameService.unlockLevel2Clue(teamA.id, clue.id)).toThrow(/final answer has been submitted/i);
      expect(() => GameService.submitLevel2Question1(teamA.id, '0728')).toThrow(/already been submitted/i);
      await expect(GameService.submitLevel2Question2(teamA.id, 'Kabir', 'Another explanation')).rejects.toThrow(/already been submitted/i);
    });

    it('2. Results navigation: participant sees score breakdown after submission, and leaderboard appears after publication', async () => {
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const { team, token } = GameService.registerTeam('Breakdown Team', 'P1_BD', 'P2_BD');
      GameService.initLevelCredits(team.id, 2, 200);

      // Set team Level 1 score to 20/30
      getDb().prepare('UPDATE teams SET level1_score = 20 WHERE id = ?').run(team.id);

      // Submit Q1 (5/5)
      GameService.submitLevel2Question1(team.id, '0728');

      // Submit Q2 with pending evaluation simulation
      const subId = 'test-sub-q2-pending';
      const now = new Date().toISOString();
      getDb().prepare(`
        INSERT INTO level2_question_submissions (
          id, round_id, team_id, question_number, is_correct, selected_suspect, explanation,
          score, max_score, evaluation_status, submitted_at, updated_at
        ) VALUES (?, (SELECT id FROM rounds WHERE level = 2 AND status = 'active'), ?, 2, NULL, 'Kabir', 'Kabir looped the feed', 0, 5, 'pending', ?, ?)
      `).run(subId, team.id, now, now);

      getDb().prepare(`
        INSERT INTO conclusions (id, round_id, team_id, conclusion_text, status, submitted_at, updated_at)
        VALUES (?, (SELECT id FROM rounds WHERE level = 2 AND status = 'active'), ?, 'Kabir', 'submitted', ?, ?)
      `).run('test-conc-pending', team.id, now, now);

      // Team stage transitions to 'result'
      const state = GameService.getTeamPrivateState(team.id);
      expect(state.stage).toBe('result');

      // GET /api/game/my-result returns full score breakdown
      const myResResponse = await fetch(`http://127.0.0.1:${serverPort}/api/game/my-result`, {
        headers: { 'x-team-token': token }
      });
      expect(myResResponse.status).toBe(200);
      const myRes = await myResResponse.json() as any;

      expect(myRes.has_completed_l2).toBe(true);
      expect(myRes.is_published).toBe(false);
      expect(myRes.result.level1_score).toBe(20); // out of 30
      expect(myRes.result.q1_score).toBe(5);       // out of 5
      expect(myRes.result.q2_score).toBe(0);       // pending eval
      expect(myRes.result.evaluation_status).toBe('pending');
      expect(myRes.result.level2_score).toBe(5);   // out of 10
      expect(myRes.result.final_score).toBe(25);   // out of 40

      // Before publication, leaderboard endpoint returns empty array
      const lbBefore = await fetch(`http://127.0.0.1:${serverPort}/api/game/leaderboard`, {
        headers: { 'x-team-token': token }
      });
      const lbBeforeData = await lbBefore.json() as any;
      expect(lbBeforeData.is_published).toBe(false);
      expect(lbBeforeData.leaderboard).toEqual([]);

      // Organizer ends round 2 and publishes final results
      GameService.endRound(adminId, 2);
      GameService.publishFinalResults(adminId);

      // After publication, leaderboard is available
      const lbAfter = await fetch(`http://127.0.0.1:${serverPort}/api/game/leaderboard`, {
        headers: { 'x-team-token': token }
      });
      const lbAfterData = await lbAfter.json() as any;
      expect(lbAfterData.is_published).toBe(true);
      expect(lbAfterData.leaderboard.length).toBeGreaterThan(0);
      const entry = lbAfterData.leaderboard.find((e: any) => e.team_id === team.id);
      expect(entry).toBeDefined();
      expect(entry.rank).toBe(1);
    });

    it('3. Level 1 progression: one team finishing early does not start Level 2 while another eligible team still has unanswered questions', () => {
      // Register two teams
      const { team: teamA } = GameService.registerTeam('Team Early Finisher', 'P1', 'P2');
      const { team: teamB } = GameService.registerTeam('Team Still Working', 'P3', 'P4');

      // Start Level 1
      const { round: r1 } = GameService.startRound(adminId, 1);
      const db = getDb();

      // Team A answers all of its assigned questions
      const tAQuestions = db.prepare(
        'SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ?'
      ).all(r1.id, teamA.id) as { question_id: string }[];

      expect(tAQuestions.length).toBeGreaterThan(0);

      for (const q of tAQuestions) {
        GameService.submitLevel1Answer(teamA.id, q.question_id, 'AI');
      }

      // Team B has NOT answered all questions
      const progressB = GameService.getTeamPrivateState(teamB.id);
      expect(progressB.level1?.is_completed).toBe(false);

      // Level 1 check must NOT advance
      const advanceResult = GameService.checkLevel1CompletionAndAdvance(r1.id);
      expect(advanceResult.advanced).toBe(false);
      expect(advanceResult.reason).toContain('Team Still Working');

      // Session must remain in Level 1
      const { session, activeRound } = GameService.getGameSession();
      expect(session.status).toBe('level1_active');
      expect(activeRound?.level).toBe(1);
    });

    it('4. Completion boundary: Level 2 starts only after all eligible teams finish or time out all their assigned Level 1 questions; repeated callbacks do not start it twice', () => {
      // Register two teams
      const { team: teamA } = GameService.registerTeam('Boundary Team A', 'P1', 'P2');
      const { team: teamB } = GameService.registerTeam('Boundary Team B', 'P3', 'P4');

      // Start Level 1
      const { round: r1 } = GameService.startRound(adminId, 1);
      const db = getDb();

      // Team A answers all of its assigned questions
      const tAQuestions = db.prepare(
        'SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ?'
      ).all(r1.id, teamA.id) as { question_id: string }[];

      for (const q of tAQuestions) {
        GameService.submitLevel1Answer(teamA.id, q.question_id, 'AI');
      }

      // Before Team B finishes its last question, Level 2 has not started
      const tBQuestions = db.prepare(
        'SELECT question_id FROM team_question_assignments WHERE round_id = ? AND team_id = ?'
      ).all(r1.id, teamB.id) as { question_id: string }[];

      for (let i = 0; i < tBQuestions.length - 1; i++) {
        GameService.submitLevel1Answer(teamB.id, tBQuestions[i].question_id, 'HUMAN');
      }

      // Still in Level 1 with 1 question remaining for Team B
      const midSession = GameService.getGameSession();
      expect(midSession.session.status).toBe('level1_active');

      // Team B submits final answer: this completes all eligible teams and triggers Level 2
      GameService.submitLevel1Answer(teamB.id, tBQuestions[tBQuestions.length - 1].question_id, 'HUMAN');

      const { session, activeRound } = GameService.getGameSession();
      expect(session.status).toBe('level2_active');
      expect(activeRound?.level).toBe(2);

      // Repeated callback / ticker invocation must NOT advance or start Level 2 twice
      const repeatedResult = GameService.checkLevel1CompletionAndAdvance(r1.id);
      expect(repeatedResult.advanced).toBe(false);

      // Round remains Level 2 with same ID
      const { activeRound: roundAfterRepeat } = GameService.getGameSession();
      expect(roundAfterRepeat?.id).toBe(activeRound?.id);
    });
  });
});

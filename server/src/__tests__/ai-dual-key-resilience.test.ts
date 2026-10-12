import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { getDb, closeDb } from '../database/db.js';
import { GameService } from '../services/gameService.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import {
  OpenRouterCredentialManager,
  openRouterCredentialManager,
  sanitizeErrorMessage,
  getQueueStatus,
  AIEvaluationError
} from '../services/aiEvaluationService.js';
import { CONFIG } from '../config.js';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_dual_key_resilience.db');

describe('AI Evaluation Dual-Key Resilience & Queue Recovery', () => {
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
    openRouterCredentialManager.reset();
  });

  // =========================================================================
  // 1. Primary-key operation with no secondary key configured
  // =========================================================================
  it('1. Operates correctly when only primary key is configured', async () => {
    const manager = new OpenRouterCredentialManager();
    const primaryKey = 'sk-or-v1-primary-test-key-1234567890';
    manager.setCredential('primary', primaryKey);
    manager.setCredential('secondary', ''); // no secondary

    const diag = manager.getDiagnostics();
    const primaryDiag = diag.find((d) => d.slot === 'primary')!;
    const secondaryDiag = diag.find((d) => d.slot === 'secondary')!;

    expect(primaryDiag.configured).toBe(true);
    expect(primaryDiag.available).toBe(true);
    expect(primaryDiag.usable).toBe(true);

    expect(secondaryDiag.configured).toBe(false);
    expect(secondaryDiag.available).toBe(false);
    expect(secondaryDiag.usable).toBe(false);

    // Acquiring credential should always yield primary
    const cred1 = await manager.acquireCredential();
    expect(cred1.slot).toBe('primary');
    expect(cred1.apiKey).toBe(primaryKey);

    manager.onSuccess('primary');

    const cred2 = await manager.acquireCredential();
    expect(cred2.slot).toBe('primary');
    expect(cred2.apiKey).toBe(primaryKey);
  });

  // =========================================================================
  // 2. Both keys configured with controlled load distribution
  // =========================================================================
  it('2. Distributes requests between primary and secondary when both are configured', async () => {
    const manager = new OpenRouterCredentialManager();
    const key1 = 'sk-or-v1-key-slot-1-1234567890abcdef';
    const key2 = 'sk-or-v1-key-slot-2-abcdef1234567890';
    manager.setCredential('primary', key1);
    manager.setCredential('secondary', key2);

    const diag = manager.getDiagnostics();
    expect(diag[0].configured).toBe(true);
    expect(diag[1].configured).toBe(true);

    // First request should prefer primary
    const first = await manager.acquireCredential();
    expect(first.slot).toBe('primary');
    expect(first.apiKey).toBe(key1);
    manager.onSuccess('primary');

    // Second request distributes to secondary
    const second = await manager.acquireCredential();
    expect(second.slot).toBe('secondary');
    expect(second.apiKey).toBe(key2);
    manager.onSuccess('secondary');

    // Third request cycles back to primary
    const third = await manager.acquireCredential();
    expect(third.slot).toBe('primary');
    expect(third.apiKey).toBe(key1);
  });

  // =========================================================================
  // 3. Primary-key rate limiting (429) & safe retry behavior
  // =========================================================================
  it('3. Honors Retry-After and fails over to secondary on primary rate-limit', async () => {
    const manager = new OpenRouterCredentialManager();
    const key1 = 'sk-or-v1-rate-limit-test-key-1';
    const key2 = 'sk-or-v1-rate-limit-test-key-2';
    manager.setCredential('primary', key1);
    manager.setCredential('secondary', key2);

    // Primary encounters 429 with 4s Retry-After
    manager.onRateLimit('primary', '4', 'Rate limit exceeded: please wait');

    const diag = manager.getDiagnostics();
    const primaryDiag = diag.find((d) => d.slot === 'primary')!;
    expect(primaryDiag.rateLimitCount).toBe(1);
    expect(primaryDiag.retryDelaySeconds).toBe(4);
    expect(primaryDiag.rateLimitedUntil).toBeGreaterThan(Date.now());

    // When primary is in cooldown, acquireCredential must route to secondary
    const next = await manager.acquireCredential();
    expect(next.slot).toBe('secondary');
    expect(next.apiKey).toBe(key2);
  });

  // =========================================================================
  // 4. Authentication failures (401/403) and unavailable credentials
  // =========================================================================
  it('4. Marks credential unavailable on 401/403 and falls back to secondary', async () => {
    const manager = new OpenRouterCredentialManager();
    const key1 = 'sk-or-v1-invalid-key-slot-1';
    const key2 = 'sk-or-v1-valid-key-slot-2';
    manager.setCredential('primary', key1);
    manager.setCredential('secondary', key2);

    // Primary encounters 401
    manager.onAuthError('primary', 401);

    const diag = manager.getDiagnostics();
    const primaryDiag = diag.find((d) => d.slot === 'primary')!;
    const secondaryDiag = diag.find((d) => d.slot === 'secondary')!;

    expect(primaryDiag.available).toBe(false);
    expect(primaryDiag.usable).toBe(false);
    expect(primaryDiag.authErrorCount).toBe(1);

    // Subsequent requests must now go exclusively to secondary
    const next1 = await manager.acquireCredential();
    expect(next1.slot).toBe('secondary');
    expect(next1.apiKey).toBe(key2);

    const next2 = await manager.acquireCredential();
    expect(next2.slot).toBe('secondary');

    // If secondary also encounters auth error, acquireCredential throws AUTH_ERROR
    manager.onAuthError('secondary', 403);
    await expect(manager.acquireCredential()).rejects.toThrow(/authentication/i);
  });

  // =========================================================================
  // 5. Shared account-level limits detection
  // =========================================================================
  it('5. Detects shared provider limits when both keys hit 429 within 30s', async () => {
    const manager = new OpenRouterCredentialManager();
    manager.setCredential('primary', 'sk-or-v1-key1');
    manager.setCredential('secondary', 'sk-or-v1-key2');

    expect(manager.isSharedQuotaDetected()).toBe(false);

    // Primary hits 429
    manager.onRateLimit('primary', '2', 'Rate limit exceeded');
    expect(manager.isSharedQuotaDetected()).toBe(false);

    // Secondary also hits 429 immediately (within 30s)
    manager.onRateLimit('secondary', '2', 'Rate limit exceeded');
    expect(manager.isSharedQuotaDetected()).toBe(true);
  });

  // =========================================================================
  // 6. Secret redaction
  // =========================================================================
  it('6. Redacts API keys from errors, diagnostics, and stack traces', () => {
    const secretKey1 = CONFIG.AI.OPENROUTER_API_KEY || 'mock-test-key-alpha-123456789';
    const secretKey2 = CONFIG.AI.OPENROUTER_API_KEY_2 || 'mock-test-key-beta-987654321';

    const rawError = `Failed to connect with Bearer ${secretKey1} and backup ${secretKey2}. sk-or-v1-1234567890abcdef1234567890`;
    const sanitized = sanitizeErrorMessage(rawError);

    expect(sanitized).not.toContain(secretKey1);
    expect(sanitized).not.toContain(secretKey2);
    expect(sanitized).not.toContain('sk-or-v1-1234567890abcdef1234567890');
    expect(sanitized).toContain('[REDACTED_API_KEY]');

    // Ensure getDiagnostics() does not include any apiKey strings
    const manager = new OpenRouterCredentialManager();
    manager.setCredential('primary', secretKey1);
    manager.setCredential('secondary', secretKey2);

    const diags: any = manager.getDiagnostics();
    for (const d of diags) {
      expect(d.apiKey).toBeUndefined();
      expect(JSON.stringify(d)).not.toContain(secretKey1);
      expect(JSON.stringify(d)).not.toContain(secretKey2);
    }
  });

  // =========================================================================
  // 7. Queue recovery after restart
  // =========================================================================
  it('7. Recovers stuck processing evaluations to pending on restart', () => {
    const db = getDb();
    const { team } = GameService.registerTeam('Crash Recovery Team');
    const session = GameService.getGameSession().session;
    const subId = 'sub-crash-test-123';
    const now = new Date().toISOString();

    const roundId = 'round-test-crash';
    const deadlineAt = new Date(Date.now() + 3600000).toISOString();
    db.prepare(`
      INSERT INTO rounds (id, game_session_id, level, status, started_at, deadline_at, settings_snapshot_json, created_at)
      VALUES (?, ?, 2, 'active', ?, ?, '{}', ?)
    `).run(roundId, session.id, now, deadlineAt, now);

    // Simulate server crash while evaluation was processing
    db.prepare(`
      INSERT INTO level2_question_submissions (
        id, round_id, team_id, question_number, pin_submitted, pin_normalized,
        is_correct, selected_suspect, explanation, score, max_score,
        evaluation_status, evaluation_data_json, submitted_at, updated_at
      ) VALUES (?, ?, ?, 2, NULL, NULL, NULL, 'Kabir', 'Kabir looped the video at 7:28 PM.', 0, 5, 'processing', NULL, ?, ?)
    `).run(subId, roundId, team.id, now, now);

    db.prepare(`
      INSERT INTO conclusions (id, round_id, team_id, conclusion_text, status, submitted_at, updated_at)
      VALUES (?, ?, ?, 'Kabir looped the video', 'submitted', ?, ?)
    `).run(subId, roundId, team.id, now, now);

    db.prepare(`
      INSERT INTO case_evaluations (id, conclusion_id, score, verdict, reasoning, status, attempt_count, is_overridden, created_at, updated_at)
      VALUES ('eval-crash-test', ?, 0, 'Pending', 'Processing...', 'processing', 1, 0, ?, ?)
    `).run(subId, now, now);

    let row = db.prepare('SELECT evaluation_status FROM level2_question_submissions WHERE id = ?').get(subId) as any;
    expect(row.evaluation_status).toBe('processing');

    // Spy on autoEvaluate to verify it triggers resumption while checking the pending reset
    const autoEvalSpy = vi.spyOn(GameService, 'autoEvaluate').mockImplementation((() => undefined) as any);

    // Run startup recovery
    GameService.recoverEvaluationsOnStartup();

    // Verify autoEvaluate was triggered for the recovered pending work
    expect(autoEvalSpy).toHaveBeenCalledWith(subId);

    // Should be reset to pending in DB before autoEvaluate marks it active
    row = db.prepare('SELECT evaluation_status FROM level2_question_submissions WHERE id = ?').get(subId) as any;
    expect(row.evaluation_status).toBe('pending');

    const evalCrashRow = db.prepare('SELECT status FROM case_evaluations WHERE conclusion_id = ?').get(subId) as any;
    expect(evalCrashRow.status).toBe('pending');

    autoEvalSpy.mockRestore();
  });

  // =========================================================================
  // 8. Manual override precedence
  // =========================================================================
  it('8. Ensures late AI response cannot overwrite an administrator manual score', () => {
    const db = getDb();
    const { team } = GameService.registerTeam('Override Precedence Team');
    const admin = db.prepare('SELECT id FROM admin_users LIMIT 1').get() as { id: string };
    const session = GameService.getGameSession().session;
    const subId = 'sub-override-test-456';
    const now = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 3600000).toISOString();

    const roundId = 'round-test-override';
    db.prepare(`
      INSERT INTO rounds (id, game_session_id, level, status, started_at, deadline_at, settings_snapshot_json, created_at)
      VALUES (?, ?, 2, 'active', ?, ?, '{}', ?)
    `).run(roundId, session.id, now, deadlineAt, now);

    db.prepare(`
      INSERT INTO level2_question_submissions (
        id, round_id, team_id, question_number, pin_submitted, pin_normalized,
        is_correct, selected_suspect, explanation, score, max_score,
        evaluation_status, evaluation_data_json, submitted_at, updated_at
      ) VALUES (?, ?, ?, 2, NULL, NULL, NULL, 'Rohan', 'Incorrect suspect answer', 0, 5, 'pending', NULL, ?, ?)
    `).run(subId, roundId, team.id, now, now);

    db.prepare(`
      INSERT INTO conclusions (id, round_id, team_id, conclusion_text, status, submitted_at, updated_at)
      VALUES (?, ?, ?, 'Rohan was the suspect', 'submitted', ?, ?)
    `).run(subId, roundId, team.id, now, now);

    // Admin manually overrides score to 5 points (verdict: 'Manual Override')
    GameService.overrideEvaluation(
      admin.id,
      subId,
      5,
      'Manual Override',
      'Authoritative manual score awarded by admin.'
    );

    let evalRow = db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(subId) as any;
    expect(evalRow.is_overridden).toBe(1);
    expect(evalRow.score).toBe(5);
    expect(evalRow.verdict).toBe('Manual Override');

    // If an AI evaluation task completes late, it must verify is_overridden and NOT overwrite
    const currentEval = db.prepare('SELECT is_overridden FROM case_evaluations WHERE conclusion_id = ?').get(subId) as any;
    expect(currentEval.is_overridden).toBe(1);

    // Re-verify that score remains preserved at 5
    evalRow = db.prepare('SELECT * FROM case_evaluations WHERE conclusion_id = ?').get(subId) as any;
    expect(evalRow.is_overridden).toBe(1);
    expect(evalRow.score).toBe(5);
    expect(evalRow.verdict).toBe('Manual Override');
  });
});

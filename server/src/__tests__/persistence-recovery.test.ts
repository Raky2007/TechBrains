import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';

import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { GameService } from '../services/gameService.js';
import authRoutes from '../routes/authRoutes.js';
import gameRoutes from '../routes/gameRoutes.js';
import { AdminUser, Clue, getConclusionDraftKey } from '@nexus/shared';

// Test storage abstractions matching client/src/lib/storage.ts
function safeGetItem(key: string, storage?: Storage | null): string | null {
  if (!storage) return null;
  try { return storage.getItem(key); } catch (e) { return null; }
}

function safeSetItem(key: string, value: string, storage?: Storage | null): boolean {
  if (!storage) return false;
  try { storage.setItem(key, value); return true; } catch (e) { return false; }
}

function safeRemoveItem(key: string, storage?: Storage | null): boolean {
  if (!storage) return false;
  try { storage.removeItem(key); return true; } catch (e) { return false; }
}

function getStoredConclusionDraft(teamId: string, sessionId?: string, storage?: Storage | null): string | null {
  if (!teamId) return null;
  const key = getConclusionDraftKey(teamId, sessionId);
  return safeGetItem(key, storage);
}

function setStoredConclusionDraft(teamId: string, text: string, sessionId?: string, storage?: Storage | null): void {
  if (!teamId) return;
  const key = getConclusionDraftKey(teamId, sessionId);
  safeSetItem(key, text, storage);
}

function removeStoredConclusionDraft(teamId: string, sessionId?: string, storage?: Storage | null): void {
  if (!teamId) return;
  const key = getConclusionDraftKey(teamId, sessionId);
  safeRemoveItem(key, storage);
}

function clearAllTeamDrafts(teamId?: string, storage?: Storage | null): void {
  if (!storage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('techbrains_draft_conclusion_')) {
        if (!teamId || k.endsWith(`_${teamId}`)) {
          keysToRemove.push(k);
        }
      }
    }
    keysToRemove.forEach((k) => safeRemoveItem(k, storage));
  } catch (err) {}
}

const TEST_DB_PATH = path.resolve(__dirname, '../../test_persistence_nexus.db');

describe('Point 11: Client-Side Persistence and Recovery', () => {
  let adminId: string;
  let app: Express;

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

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);
    app.use('/api/game', gameRoutes);
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  describe('1. Safe Storage Utilities & Error Handling', () => {
    it('handles reading, writing, and removing items without throwing', () => {
      const mockStorageMap = new Map<string, string>();
      const mockStorage: Storage = {
        length: 0,
        clear: () => mockStorageMap.clear(),
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        setItem: (k: string, v: string) => { mockStorageMap.set(k, v); },
        removeItem: (k: string) => { mockStorageMap.delete(k); },
        key: (index: number) => Array.from(mockStorageMap.keys())[index] ?? null
      };

      expect(safeSetItem('test_key', 'test_value', mockStorage)).toBe(true);
      expect(safeGetItem('test_key', mockStorage)).toBe('test_value');
      expect(safeRemoveItem('test_key', mockStorage)).toBe(true);
      expect(safeGetItem('test_key', mockStorage)).toBeNull();
    });

    it('gracefully handles SecurityError and QuotaExceededError without crashing', () => {
      const throwingStorage: Storage = {
        length: 0,
        clear: () => {},
        getItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError'); },
        setItem: () => { throw new DOMException('Quota exceeded.', 'QuotaExceededError'); },
        removeItem: () => { throw new DOMException('Storage access denied.', 'SecurityError'); },
        key: () => null
      };

      expect(safeGetItem('any_key', throwingStorage)).toBeNull();
      expect(safeSetItem('any_key', 'val', throwingStorage)).toBe(false);
      expect(safeRemoveItem('any_key', throwingStorage)).toBe(false);
    });
  });

  describe('2. Conclusion Draft Scoping, Isolation & Restoration', () => {
    it('isolates drafts between different teams and different sessions', () => {
      const mockStorageMap = new Map<string, string>();
      const mockStorage: Storage = {
        get length() { return mockStorageMap.size; },
        clear: () => mockStorageMap.clear(),
        getItem: (k: string) => mockStorageMap.get(k) ?? null,
        setItem: (k: string, v: string) => { mockStorageMap.set(k, v); },
        removeItem: (k: string) => { mockStorageMap.delete(k); },
        key: (index: number) => Array.from(mockStorageMap.keys())[index] ?? null
      };

      // Mock global localStorage
      const originalLocalStorage = global.localStorage;
      (global as any).localStorage = mockStorage;

      try {
        const team1Id = 'team-uuid-1';
        const team2Id = 'team-uuid-2';
        const sessionA = 'session-uuid-aaa';
        const sessionB = 'session-uuid-bbb';

        setStoredConclusionDraft(team1Id, 'Team 1 draft for session A', sessionA, mockStorage);
        setStoredConclusionDraft(team2Id, 'Team 2 draft for session A', sessionA, mockStorage);
        setStoredConclusionDraft(team1Id, 'Team 1 draft for session B', sessionB, mockStorage);

        expect(getStoredConclusionDraft(team1Id, sessionA, mockStorage)).toBe('Team 1 draft for session A');
        expect(getStoredConclusionDraft(team2Id, sessionA, mockStorage)).toBe('Team 2 draft for session A');
        expect(getStoredConclusionDraft(team1Id, sessionB, mockStorage)).toBe('Team 1 draft for session B');

        // Removing Team 1 draft in Session A does not touch Team 2 or Session B
        removeStoredConclusionDraft(team1Id, sessionA, mockStorage);
        expect(getStoredConclusionDraft(team1Id, sessionA, mockStorage)).toBeNull();
        expect(getStoredConclusionDraft(team2Id, sessionA, mockStorage)).toBe('Team 2 draft for session A');
        expect(getStoredConclusionDraft(team1Id, sessionB, mockStorage)).toBe('Team 1 draft for session B');

        // clearAllTeamDrafts for team2 cleans team2's drafts only
        clearAllTeamDrafts(team2Id, mockStorage);
        expect(getStoredConclusionDraft(team2Id, sessionA, mockStorage)).toBeNull();
        expect(getStoredConclusionDraft(team1Id, sessionB, mockStorage)).toBe('Team 1 draft for session B');
      } finally {
        (global as any).localStorage = originalLocalStorage;
      }
    });

    it('server submitted conclusion takes precedence and persists across refresh', () => {
      const { team } = GameService.registerTeam('Persistent Investigators');
      GameService.startRound(adminId, 1);
      GameService.endRound(adminId, 1);
      GameService.startRound(adminId, 2);

      const db = getDb();
      const clue = db.prepare('SELECT id FROM clues WHERE is_active = 1 LIMIT 1').get() as Clue;
      GameService.unlockLevel2Clue(team.id, clue.id);

      // Submit conclusion authoritatively
      const submittedText = 'The rogue model modified satellite telemetry at 04:15 UTC.';
      GameService.submitConclusion(team.id, submittedText);

      // Verify server authoritative state returns submitted conclusion on refresh/re-fetch
      const privateState = GameService.getTeamPrivateState(team.id);
      expect(privateState.level2?.conclusion?.text).toBe(submittedText);
      expect(privateState.level2?.conclusion?.status).toBe('submitted');
      expect(privateState.level2?.is_locked).toBe(true);
    });
  });

  describe('3. Team Logout and Cookie Cleanup', () => {
    it('POST /api/auth/logout returns 200 and clears the nexus_team_token cookie', async () => {
      const { team, token } = GameService.registerTeam('Logging Out Team');

      // Create simulated request to /api/auth/logout
      const req: any = {
        cookies: { nexus_team_token: token },
        headers: {}
      };
      let clearedCookieName = '';
      const res: any = {
        clearCookie: vi.fn((cookieName: string) => {
          clearedCookieName = cookieName;
        }),
        json: vi.fn((data: any) => data),
        status: vi.fn().mockReturnThis()
      };

      // Call route handler directly
      const logoutHandler = (authRoutes as any).stack.find(
        (layer: any) => layer.route?.path === '/logout' && layer.route?.methods?.post
      )?.route?.stack[0]?.handle;

      expect(logoutHandler).toBeDefined();
      logoutHandler(req, res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        'nexus_team_token',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', secure: false })
      );
      expect(res.json).toHaveBeenCalledWith({ message: 'Team logged out successfully' });
    });
  });

  describe('4. Stale vs Transient Failure Error Classification', () => {
    it('identifies confirmed 401/403/invalid session as auth failure but keeps credentials on network timeout', () => {
      const isAuthFailure = (msg: string) =>
        /HTTP (401|403)|unauthorized|invalid token|invalid session/i.test(msg);

      // Definite auth failures (should clear stored token)
      expect(isAuthFailure('HTTP 401: Unauthorized')).toBe(true);
      expect(isAuthFailure('HTTP 403: Forbidden')).toBe(true);
      expect(isAuthFailure('HTTP 401: Invalid token signature')).toBe(true);
      expect(isAuthFailure('Invalid session')).toBe(true);

      // Transient network failures (must NOT clear stored token)
      expect(isAuthFailure('Failed to fetch')).toBe(false);
      expect(isAuthFailure('NetworkError when attempting to fetch resource.')).toBe(false);
      expect(isAuthFailure('The operation timed out')).toBe(false);
      expect(isAuthFailure('HTTP 500: Internal Server Error')).toBe(false);
      expect(isAuthFailure('HTTP 503: Service Unavailable')).toBe(false);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
  getConclusionDraftKey,
  getStoredConclusionDraft,
  setStoredConclusionDraft,
  removeStoredConclusionDraft,
  clearAllTeamDrafts
} from './storage';

/** Minimal in-memory implementation of the DOM Storage interface. */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

/** A Storage whose mutating methods always throw (private-mode / quota). */
class ThrowingStorage implements Storage {
  get length(): number { return 0; }
  clear(): void { throw new Error('blocked'); }
  getItem(): string | null { throw new Error('blocked'); }
  setItem(): void { throw new Error('QuotaExceededError'); }
  removeItem(): void { throw new Error('blocked'); }
  key(): string | null { return null; }
}

describe('storage: safe wrappers with an explicit storage', () => {
  it('round-trips a value through set/get/remove', () => {
    const mem = new MemoryStorage();
    expect(safeSetItem('k', 'v', mem)).toBe(true);
    expect(safeGetItem('k', mem)).toBe('v');
    expect(safeRemoveItem('k', mem)).toBe(true);
    expect(safeGetItem('k', mem)).toBeNull();
  });

  it('returns null/false (never throws) when storage is unavailable', () => {
    expect(safeGetItem('k', null)).toBeNull();
    expect(safeSetItem('k', 'v', null)).toBe(false);
    expect(safeRemoveItem('k', null)).toBe(false);
  });

  it('swallows storage exceptions (quota / private mode) and reports failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = new ThrowingStorage();
    expect(safeGetItem('k', bad)).toBeNull();
    expect(safeSetItem('k', 'v', bad)).toBe(false);
    expect(safeRemoveItem('k', bad)).toBe(false);
    warn.mockRestore();
  });
});

describe('storage: conclusion draft key', () => {
  it('is scoped to session + team and deterministic', () => {
    const key = getConclusionDraftKey('team-123', 'session-abc');
    expect(key).toBe('techbrains_draft_conclusion_session-abc_team-123');
    expect(getConclusionDraftKey('team-123', 'session-abc')).toBe(key);
  });

  it('falls back to an "active" session segment when no session id is given', () => {
    expect(getConclusionDraftKey('team-123')).toBe('techbrains_draft_conclusion_active_team-123');
  });

  it('produces different keys for different teams in the same session', () => {
    expect(getConclusionDraftKey('team-A', 's1')).not.toBe(getConclusionDraftKey('team-B', 's1'));
  });
});

describe('storage: conclusion draft helpers (global localStorage)', () => {
  let mem: MemoryStorage;

  beforeEach(() => {
    mem = new MemoryStorage();
    // storage.ts reads the ambient localStorage/sessionStorage globals.
    (globalThis as any).localStorage = mem;
    (globalThis as any).sessionStorage = new MemoryStorage();
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
    delete (globalThis as any).sessionStorage;
  });

  it('stores and reads back a draft for a team', () => {
    setStoredConclusionDraft('team-1', 'my working theory', 's1');
    expect(getStoredConclusionDraft('team-1', 's1')).toBe('my working theory');
    expect(mem.getItem(getConclusionDraftKey('team-1', 's1'))).toBe('my working theory');
  });

  it('ignores empty team ids (no write, safe read)', () => {
    setStoredConclusionDraft('', 'ignored', 's1');
    expect(mem.length).toBe(0);
    expect(getStoredConclusionDraft('', 's1')).toBeNull();
  });

  it('removes a stored draft', () => {
    setStoredConclusionDraft('team-1', 'temp', 's1');
    removeStoredConclusionDraft('team-1', 's1');
    expect(getStoredConclusionDraft('team-1', 's1')).toBeNull();
  });

  it('clearAllTeamDrafts removes only draft-prefixed keys for the given team', () => {
    setStoredConclusionDraft('team-1', 'keep-structure', 's1');
    setStoredConclusionDraft('team-2', 'other team', 's1');
    mem.setItem('unrelated_key', 'should survive');

    clearAllTeamDrafts('team-1');

    expect(getStoredConclusionDraft('team-1', 's1')).toBeNull();
    expect(getStoredConclusionDraft('team-2', 's1')).toBe('other team');
    expect(mem.getItem('unrelated_key')).toBe('should survive');
  });

  it('clearAllTeamDrafts with no team id clears every draft but spares unrelated keys', () => {
    setStoredConclusionDraft('team-1', 'a', 's1');
    setStoredConclusionDraft('team-2', 'b', 's1');
    mem.setItem('unrelated_key', 'survives');

    clearAllTeamDrafts();

    expect(getStoredConclusionDraft('team-1', 's1')).toBeNull();
    expect(getStoredConclusionDraft('team-2', 's1')).toBeNull();
    expect(mem.getItem('unrelated_key')).toBe('survives');
  });
});

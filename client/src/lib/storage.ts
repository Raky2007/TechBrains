import { getConclusionDraftKey } from '@nexus/shared';
export { getConclusionDraftKey };

function getLocalStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch (e) {}
  return null;
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch (e) {}
  return null;
}

export function safeGetItem(key: string, storage?: Storage | null): string | null {
  const target = storage !== undefined ? storage : getLocalStorage();
  if (!target) return null;
  try {
    return target.getItem(key);
  } catch (err) {
    console.warn(`[Storage] Failed to read key "${key}":`, err);
    return null;
  }
}

export function safeSetItem(key: string, value: string, storage?: Storage | null): boolean {
  const target = storage !== undefined ? storage : getLocalStorage();
  if (!target) return false;
  try {
    target.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[Storage] Failed to set key "${key}":`, err);
    return false;
  }
}

export function safeRemoveItem(key: string, storage?: Storage | null): boolean {
  const target = storage !== undefined ? storage : getLocalStorage();
  if (!target) return false;
  try {
    target.removeItem(key);
    return true;
  } catch (err) {
    console.warn(`[Storage] Failed to remove key "${key}":`, err);
    return false;
  }
}

export function getStoredConclusionDraft(teamId: string, sessionId?: string): string | null {
  if (!teamId) return null;
  const key = getConclusionDraftKey(teamId, sessionId);
  return safeGetItem(key, getLocalStorage()) || safeGetItem(key, getSessionStorage());
}

export function setStoredConclusionDraft(teamId: string, text: string, sessionId?: string): void {
  if (!teamId) return;
  const key = getConclusionDraftKey(teamId, sessionId);
  safeSetItem(key, text, getLocalStorage());
}

export function removeStoredConclusionDraft(teamId: string, sessionId?: string): void {
  if (!teamId) return;
  const key = getConclusionDraftKey(teamId, sessionId);
  safeRemoveItem(key, getLocalStorage());
  safeRemoveItem(key, getSessionStorage());
}

export function clearAllTeamDrafts(teamId?: string): void {
  try {
    const storages = [getLocalStorage(), getSessionStorage()].filter(Boolean) as Storage[];
    storages.forEach((storage) => {
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
    });
  } catch (err) {
    console.warn('[Storage] Error clearing drafts:', err);
  }
}

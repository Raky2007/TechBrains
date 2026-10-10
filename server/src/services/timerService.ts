import { getDb } from '../database/db.js';
import { Round, ServerAuthoritativeTimerState } from '@nexus/shared';
import type { Server as SocketIOServer } from 'socket.io';

let checkInterval: NodeJS.Timeout | null = null;
let ioInstance: SocketIOServer | null = null;
let onRoundExpiredCallback: ((round: Round) => Promise<void>) | null = null;

export function registerTimerCallbacks(
  io: SocketIOServer,
  onExpired: (round: Round) => Promise<void>
): void {
  ioInstance = io;
  onRoundExpiredCallback = onExpired;

  if (checkInterval) {
    clearInterval(checkInterval);
  }

  // Authoritative server-side ticker checking expiration once per second
  checkInterval = setInterval(async () => {
    await checkAuthoritativeDeadlines();
  }, 1000);
}

/**
 * Check active rounds and atomically trigger expiration when deadline is passed.
 * Scoped strictly to the authoritative active game session.
 */
export async function checkAuthoritativeDeadlines(): Promise<void> {
  try {
    const db = getDb();
    const activeSession = db.prepare('SELECT id FROM game_sessions ORDER BY created_at DESC LIMIT 1').get() as { id: string } | undefined;
    if (!activeSession) return;

    const activeRounds = db.prepare(`
      SELECT * FROM rounds 
      WHERE game_session_id = ? AND status = 'active'
    `).all(activeSession.id) as Round[];

    const now = Date.now();

    for (const round of activeRounds) {
      const deadline = new Date(round.deadline_at).getTime();
      if (deadline <= now) {
        console.log(`[TimerService] Round ${round.id} (Level ${round.level}) reached authoritative deadline. Finalizing round...`);
        if (onRoundExpiredCallback) {
          await onRoundExpiredCallback(round);
        }
      }
    }
  } catch (err) {
    console.error('[TimerService] Error checking deadlines:', err);
  }
}

/**
 * Checks if a specific round has expired according to authoritative server time.
 */
export function isRoundExpired(round: Round): boolean {
  if (round.status === 'ended') return true;
  if (round.status === 'paused') return false; // Paused timers are frozen
  return new Date(round.deadline_at).getTime() <= Date.now();
}

/**
 * Computes the remaining seconds and current timer state for client synchronization.
 */
export function getAuthoritativeTimerState(round: Round | null): ServerAuthoritativeTimerState | null {
  if (!round) return null;

  const now = Date.now();
  let remainingSeconds = 0;

  if (round.status === 'paused') {
    remainingSeconds = round.remaining_seconds || 0;
  } else if (round.status === 'active') {
    const deadline = new Date(round.deadline_at).getTime();
    remainingSeconds = Math.max(0, Math.floor((deadline - now) / 1000));
  } else {
    remainingSeconds = 0;
  }

  return {
    round_id: round.id,
    level: round.level,
    status: round.status,
    server_time: new Date().toISOString(),
    deadline_at: round.deadline_at,
    remaining_seconds: remainingSeconds,
    is_paused: round.status === 'paused'
  };
}

/**
 * Recovers timers on server reboot.
 * Cleans up stale active rounds from non-active sessions and only processes active session rounds.
 */
export function recoverRoundsOnStartup(): void {
  const db = getDb();
  const session = db.prepare('SELECT id FROM game_sessions ORDER BY created_at DESC LIMIT 1').get() as { id: string } | undefined;
  const now = Date.now();
  const endedAt = new Date().toISOString();

  // 1. Mark any active/paused rounds in archived sessions as ended without touching active session rounds
  if (session) {
    db.prepare(`UPDATE rounds SET status = 'ended', ended_at = ? WHERE status IN ('active', 'paused') AND game_session_id != ?`).run(endedAt, session.id);
  }

  // 2. Only inspect active rounds belonging to the authoritative active game session
  const activeRounds = session
    ? (db.prepare(`SELECT * FROM rounds WHERE game_session_id = ? AND status = 'active'`).all(session.id) as Round[])
    : [];

  for (const round of activeRounds) {
    const deadline = new Date(round.deadline_at).getTime();
    if (deadline <= now) {
      console.log(`[TimerService] Startup recovery: Round ${round.id} expired during server downtime. Marking ended.`);
      db.prepare(`UPDATE rounds SET status = 'ended', ended_at = ? WHERE id = ?`).run(endedAt, round.id);
      db.prepare(`UPDATE game_sessions SET status = ?, updated_at = ? WHERE id = ?`).run(
        round.level === 1 ? 'level1_ended' : 'level2_ended',
        endedAt,
        round.game_session_id
      );
    } else {
      console.log(`[TimerService] Startup recovery: Round ${round.id} is still active. Authoritative deadline: ${round.deadline_at}`);
    }
  }
}

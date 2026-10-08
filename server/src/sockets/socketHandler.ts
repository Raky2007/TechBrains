import { Server as SocketIOServer, Socket } from 'socket.io';
import { GameService } from '../services/gameService.js';
import { hashToken } from '../utils/crypto.js';
import { getDb } from '../database/db.js';
import { Team, AdminUser } from '@nexus/shared';

let ioInstance: SocketIOServer | null = null;

export function setupSocketIO(io: SocketIOServer): void {
  ioInstance = io;

  io.use((socket: Socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const teamToken = auth.teamToken;
      const adminToken = auth.adminToken;

      const db = getDb();

      if (adminToken && typeof adminToken === 'string') {
        const parts = adminToken.split(':');
        if (parts.length === 2) {
          const [adminId, signature] = parts;
          const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId) as AdminUser | undefined;
          if (admin && signature === hashToken(admin.id + admin.password_hash)) {
            socket.data.isAdmin = true;
            socket.data.adminUser = admin;
            return next();
          }
        }
      }

      if (teamToken && typeof teamToken === 'string') {
        const tokenHash = hashToken(teamToken);
        const team = db.prepare('SELECT * FROM teams WHERE access_token_hash = ?').get(tokenHash) as Team | undefined;
        if (team) {
          socket.data.isTeam = true;
          socket.data.team = team;
          return next();
        }
      }

      // Anonymous / public viewer allowed in general session room for public state
      socket.data.isAnonymous = true;
      next();
    } catch (err) {
      console.error('[Socket] Auth middleware error:', err);
      next();
    }
  });

  io.on('connection', (socket: Socket) => {
    const { session } = GameService.getGameSession();
    socket.join(`session:${session.id}`);

    if (socket.data.isAdmin) {
      socket.join('admin_channel');
      console.log(`[Socket] Admin connected: ${socket.id}`);
    } else if (socket.data.isTeam) {
      socket.join(`team:${socket.data.team.id}`);
      console.log(`[Socket] Team "${socket.data.team.team_name}" connected: ${socket.id}`);
    } else {
      console.log(`[Socket] Anonymous viewer connected: ${socket.id}`);
    }

    // Client heartbeat
    socket.on('nexus:ping', (cb) => {
      if (typeof cb === 'function') cb({ server_time: new Date().toISOString() });
    });

    socket.on('disconnect', () => {
      // Disconnection handled cleanly
    });
  });
}

/**
 * Authoritative broadcast of public game state to all connected devices
 */
export function broadcastGameState(): void {
  if (!ioInstance) return;
  const state = GameService.getPublicGameState();
  ioInstance.to(`session:${state.session_id}`).emit('game:state_changed', state);
}

/**
 * Broadcast round transition events
 */
export function broadcastRoundEvent(
  eventType: 'round:started' | 'round:paused' | 'round:resumed' | 'round:ended',
  data: any
): void {
  if (!ioInstance) return;
  const { session } = GameService.getGameSession();
  ioInstance.to(`session:${session.id}`).emit(eventType, data);
  // Also push updated overall game state
  broadcastGameState();
}

/**
 * Send private state update to a single team channel
 */
export function emitToTeam(teamId: string, event: string, payload: any): void {
  if (!ioInstance) return;
  ioInstance.to(`team:${teamId}`).emit(event, payload);
}

/**
 * Send real-time notification to administrators
 */
export function emitToAdmin(event: string, payload: any): void {
  if (!ioInstance) return;
  ioInstance.to('admin_channel').emit(event, payload);
}

/**
 * Broadcast that final results have been published.
 *
 * Privacy: the full ranked leaderboard (every team's scores) is sent ONLY to
 * the admin channel. Participants receive a scores-free `results:published`
 * signal on the session channel; each team then fetches its OWN result via
 * GET /api/game/my-result. This prevents leaking global standings or other
 * teams' scores to participants over Socket.IO.
 */
export function broadcastLeaderboard(leaderboard: any): void {
  if (!ioInstance) return;
  const { session } = GameService.getGameSession();
  // Full standings → administrators only.
  ioInstance.to('admin_channel').emit('leaderboard:published', leaderboard);
  // Scores-free signal → all participant terminals.
  ioInstance.to(`session:${session.id}`).emit('results:published', { is_published: true });
}

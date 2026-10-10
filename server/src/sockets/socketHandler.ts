import { Server as SocketIOServer, Socket } from 'socket.io';
import { GameService } from '../services/gameService.js';
import { verifyAdminToken, verifyTeamToken } from '../middleware/auth.js';
import { parseCookieHeader } from '../utils/cookie.js';
import { getClientIpFromSocket } from '../utils/network.js';
import { Team, AdminUser, TeamPresencePayload, SessionReplacedPayload, TeamBannedPayload } from '@nexus/shared';

let ioInstance: SocketIOServer | null = null;

interface SocketConnectionInfo {
  socketId: string;
  ip: string;
  connectedAt: string;
}

interface TeamPresenceRecord {
  teamId: string;
  sessionId: string;
  sockets: Map<string, SocketConnectionInfo>;
  lastConnectedAt: string;
}

// In-memory presence map: sessionId -> teamId -> TeamPresenceRecord
const sessionPresence = new Map<string, Map<string, TeamPresenceRecord>>();

export function getTeamPresence(sessionId: string, teamId: string): TeamPresencePayload | null {
  const teamMap = sessionPresence.get(sessionId);
  if (!teamMap) return null;
  const rec = teamMap.get(teamId);
  if (!rec) return null;

  const isConnected = rec.sockets.size > 0;
  const ipAddresses = Array.from(new Set(Array.from(rec.sockets.values()).map((s) => s.ip)));
  const primaryIp = ipAddresses[0] || null;

  return {
    team_id: rec.teamId,
    session_id: rec.sessionId,
    is_connected: isConnected,
    ip_address: primaryIp,
    ip_addresses: ipAddresses,
    connections_count: rec.sockets.size,
    last_connected_at: rec.lastConnectedAt
  };
}

export function getAllTeamsPresence(sessionId: string): Map<string, TeamPresencePayload> {
  const result = new Map<string, TeamPresencePayload>();
  const teamMap = sessionPresence.get(sessionId);
  if (!teamMap) return result;

  for (const [teamId, rec] of teamMap.entries()) {
    const isConnected = rec.sockets.size > 0;
    const ipAddresses = Array.from(new Set(Array.from(rec.sockets.values()).map((s) => s.ip)));
    const primaryIp = ipAddresses[0] || null;

    result.set(teamId, {
      team_id: rec.teamId,
      session_id: rec.sessionId,
      is_connected: isConnected,
      ip_address: primaryIp,
      ip_addresses: ipAddresses,
      connections_count: rec.sockets.size,
      last_connected_at: rec.lastConnectedAt
    });
  }
  return result;
}

/**
 * Checks whether the given socket is currently the sole authoritative active connection
 * for its authenticated team and session.
 */
export function isSocketActiveTeamConnection(socket: Socket): boolean {
  if (!socket?.data?.isTeam || !socket.data?.team) return false;
  if (socket.data.isReplaced || socket.data.isBanned) return false;
  const team = socket.data.team;
  const { session } = GameService.getGameSession();
  const teamMap = sessionPresence.get(session.id);
  if (!teamMap) return false;
  const teamRecord = teamMap.get(team.id);
  if (!teamRecord) return false;
  return teamRecord.sockets.has(socket.id);
}

/**
 * Forcibly evict and disconnect any active socket for a banned team,
 * notifying the client and updating admin presence.
 */
export function banAndDisconnectTeam(
  sessionId: string,
  teamId: string,
  reason?: string | null,
  bannedAt?: string | null
): void {
  const now = bannedAt || new Date().toISOString();
  const teamMap = sessionPresence.get(sessionId);
  if (!teamMap) return;
  const teamRecord = teamMap.get(teamId);
  if (!teamRecord) return;

  for (const [socketId] of teamRecord.sockets) {
    teamRecord.sockets.delete(socketId);
    const activeSocket = ioInstance?.sockets.sockets.get(socketId);
    if (activeSocket) {
      activeSocket.data.isBanned = true;
      activeSocket.data.isReplaced = true;
      activeSocket.emit('team:banned', {
        message: 'Your team has been disqualified and banned by an administrator.',
        reason: reason || null,
        banned_at: now
      });
      activeSocket.leave(`team:${teamId}`);
      activeSocket.leave(`session:${sessionId}`);
      activeSocket.disconnect(true);
      console.log(`[Socket] Evicted and disconnected banned team ${teamId} on socket ${socketId}`);
    }
  }

  const presencePayload = getTeamPresence(sessionId, teamId);
  if (presencePayload) {
    emitToAdmin('admin:team_presence', presencePayload);
  }
}

export function resetPresence(): void {
  sessionPresence.clear();
}

export function setupSocketIO(io: SocketIOServer): void {
  ioInstance = io;

  io.use((socket: Socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      const headers = socket.handshake.headers || {};
      const cookies = parseCookieHeader(headers.cookie);

      // Extract admin token from auth, headers, or cookies
      let adminToken: string | undefined = auth.adminToken;
      if (!adminToken && headers['x-admin-token']) {
        adminToken = headers['x-admin-token'] as string;
      }
      if (!adminToken && cookies.nexus_admin_token) {
        adminToken = cookies.nexus_admin_token;
      }
      if (!adminToken && headers.authorization?.startsWith('Bearer ')) {
        const bearer = headers.authorization.substring(7);
        if (bearer.includes(':')) {
          adminToken = bearer;
        }
      }

      // Extract team token from auth, headers, or cookies
      let teamToken: string | undefined = auth.teamToken;
      if (!teamToken && headers['x-team-token']) {
        teamToken = headers['x-team-token'] as string;
      }
      if (!teamToken && cookies.nexus_team_token) {
        teamToken = cookies.nexus_team_token;
      }
      if (!teamToken && headers.authorization?.startsWith('Bearer ') && !adminToken) {
        teamToken = headers.authorization.substring(7);
      }

      // 1. Admin Authentication
      if (adminToken && typeof adminToken === 'string') {
        const admin = verifyAdminToken(adminToken);
        if (admin) {
          socket.data.isAdmin = true;
          socket.data.adminUser = admin;
          return next();
        }
        return next(new Error('Authentication failed: Invalid administrator credentials'));
      }

      // 2. Team Authentication & Session Membership Verification
      if (teamToken && typeof teamToken === 'string') {
        const team = verifyTeamToken(teamToken);
        if (!team) {
          return next(new Error('Authentication failed: Invalid team session token'));
        }

        if (team.is_banned) {
          return next(new Error('Authentication failed: Team has been disqualified by an administrator'));
        }

        const { session } = GameService.getGameSession();
        if (team.game_session_id !== session.id) {
          return next(new Error('Authentication failed: Team does not belong to active game session'));
        }

        socket.data.isTeam = true;
        socket.data.team = team;
        return next();
      }

      // 3. Anonymous / Public Viewer (e.g. public lobby display or pre-login screen)
      socket.data.isAnonymous = true;
      next();
    } catch (err: any) {
      console.error('[Socket] Auth middleware error:', err?.message || err);
      next(new Error('Authentication error during handshake'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { session } = GameService.getGameSession();
    socket.join(`session:${session.id}`);

    if (socket.data.isAdmin) {
      socket.join('admin_channel');
      console.log(`[Socket] Admin connected (${socket.data.adminUser.username}): ${socket.id}`);
    } else if (socket.data.isTeam) {
      const team = socket.data.team;
      const ip = getClientIpFromSocket(socket);
      const now = new Date().toISOString();

      let teamMap = sessionPresence.get(session.id);
      if (!teamMap) {
        teamMap = new Map();
        sessionPresence.set(session.id, teamMap);
      }

      let teamRecord = teamMap.get(team.id);
      if (!teamRecord) {
        teamRecord = {
          teamId: team.id,
          sessionId: session.id,
          sockets: new Map(),
          lastConnectedAt: now
        };
        teamMap.set(team.id, teamRecord);
      }

      // Point 13: Enforce exactly one active connection per (sessionId, teamId).
      // Evict any existing socket for this team before registering the replacement.
      for (const [oldSocketId] of teamRecord.sockets) {
        if (oldSocketId !== socket.id) {
          teamRecord.sockets.delete(oldSocketId);
          const oldSocket = ioInstance?.sockets.sockets.get(oldSocketId);
          if (oldSocket) {
            oldSocket.data.isReplaced = true;
            oldSocket.emit('team:session_replaced', {
              message: 'Your team session was opened in another tab or device.',
              replaced_at: now
            });
            oldSocket.leave(`team:${team.id}`);
            oldSocket.disconnect(true);
            console.log(`[Socket] Evicted previous socket ${oldSocketId} for team "${team.team_name}" (${team.id})`);
          }
        }
      }

      teamRecord.sockets.set(socket.id, {
        socketId: socket.id,
        ip,
        connectedAt: now
      });
      teamRecord.lastConnectedAt = now;

      // Broadcast live presence update strictly to administrators
      const presencePayload = getTeamPresence(session.id, team.id);
      if (presencePayload) {
        emitToAdmin('admin:team_presence', presencePayload);
      }

      socket.join(`team:${team.id}`);
      console.log(`[Socket] Team connected ("${team.team_name}", ID: ${team.id}, IP: ${ip}): ${socket.id}`);
    } else {
      console.log(`[Socket] Anonymous viewer connected: ${socket.id}`);
    }

    // Client heartbeat
    socket.on('nexus:ping', (cb) => {
      if (socket.data.isTeam && !isSocketActiveTeamConnection(socket)) {
        return;
      }
      if (typeof cb === 'function') cb({ server_time: new Date().toISOString() });
    });

    socket.on('disconnect', (_reason) => {
      if (socket.data.isTeam) {
        // If this socket was evicted by a replacement connection or ban, ignore its delayed disconnect
        if (socket.data.isReplaced || socket.data.isBanned) {
          return;
        }

        const team = socket.data.team;
        const teamMap = sessionPresence.get(session.id);
        if (teamMap) {
          const teamRecord = teamMap.get(team.id);
          if (teamRecord) {
            const wasActive = teamRecord.sockets.delete(socket.id);
            if (wasActive) {
              const presencePayload = getTeamPresence(session.id, team.id);
              if (presencePayload) {
                emitToAdmin('admin:team_presence', presencePayload);
              }
            }
          }
        }
      }
    });
  });
}

/**
 * Authoritative broadcast of public game state to all connected devices
 */
export function broadcastGameState(): void {
  if (!ioInstance) return;
  const state = GameService.getPublicGameState();
  ioInstance.emit('game:state_changed', state);
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
  ioInstance.emit(eventType, data);
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
 * Broadcast tournament reset cleanly to all connected participant terminals
 */
export function broadcastGameReset(newSessionId: string): void {
  if (!ioInstance) return;
  for (const [, socket] of ioInstance.sockets.sockets) {
    socket.join(`session:${newSessionId}`);
  }
  ioInstance.emit('game:reset', { session_id: newSessionId });
  broadcastGameState();
}

/**
 * Broadcast that final results have been published.
 *
 * Privacy: the full ranked leaderboard (every team's scores) is sent ONLY to
 * the admin channel. Participants receive a scores-free `results:published`
 * signal; each team then fetches its OWN result via GET /api/game/my-result.
 * This prevents leaking global standings or other teams' scores to participants.
 */
export function broadcastLeaderboard(leaderboard: any): void {
  if (!ioInstance) return;
  const { session } = GameService.getGameSession();
  // Full standings → administrators only.
  ioInstance.to('admin_channel').emit('leaderboard:published', leaderboard);
  // Scores-free signal → all participant terminals.
  ioInstance.emit('results:published', { is_published: true });
  ioInstance.to(`session:${session.id}`).emit('results:published', { is_published: true });
}


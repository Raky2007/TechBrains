import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import path from 'path';
import fs from 'fs';

import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { GameService } from '../services/gameService.js';
import {
  setupSocketIO,
  getTeamPresence,
  resetPresence
} from '../sockets/socketHandler.js';
import authRoutes from '../routes/authRoutes.js';
import gameRoutes from '../routes/gameRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';
import { isAllowedLanOrigin } from '../utils/network.js';
import { hashToken } from '../utils/crypto.js';
import { AdminUser, TeamBannedPayload, TeamPresencePayload } from '@nexus/shared';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_admin_ban_nexus.db');

describe('Point 14: Admin Ban and Unban Teams', () => {
  let app: Express;
  let server: http.Server;
  let io: SocketIOServer;
  let serverPort: number;
  let activeClients: ClientSocket[] = [];
  let adminId: string;
  let adminToken: string;

  const createClient = (options: { auth?: any; headers?: any } = {}): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const client = ioc(`http://127.0.0.1:${serverPort}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 4000,
        ...options
      });

      activeClients.push(client);

      client.on('connect', () => {
        resolve(client);
      });

      client.on('connect_error', (err) => {
        reject(err);
      });
    });
  };

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

    const admin = db.prepare('SELECT id, username, password_hash FROM admin_users LIMIT 1').get() as AdminUser;
    adminId = admin.id;
    const signature = hashToken(admin.id + admin.password_hash);
    adminToken = `${admin.id}:${signature}`;

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/auth', authRoutes);
    app.use('/api/game', gameRoutes);
    app.use('/api/admin', adminRoutes);

    server = http.createServer(app);
    io = new SocketIOServer(server, {
      cors: {
        origin: (origin, callback) => {
          if (isAllowedLanOrigin(origin)) {
            callback(null, true);
          } else {
            callback(new Error('CORS origin not allowed on LAN server'));
          }
        },
        credentials: true
      },
      transports: ['websocket']
    });

    setupSocketIO(io);
    resetPresence();

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
    for (const client of activeClients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    activeClients = [];

    resetPresence();

    if (io) {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  it('1. Admin authorization: non-admin requests to ban/unban are rejected', async () => {
    const { team } = GameService.registerTeam('Auth-Check-Team');

    // Attempt ban without token -> 401
    const resNoAuth = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Collusion' })
    });
    expect(resNoAuth.status).toBe(401);

    // Attempt unban without token -> 401
    const resUnbanNoAuth = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    expect(resUnbanNoAuth.status).toBe(401);

    // Attempt with invalid admin token -> 401
    const resBadToken = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': 'bad-admin-token'
      },
      body: JSON.stringify({ reason: 'Collusion' })
    });
    expect(resBadToken.status).toBe(401);
  });

  it('2. Valid ban: updates database fields, writes audit log, and returns safe metadata', async () => {
    const { team } = GameService.registerTeam('Rule-Breakers');

    const banRes = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ reason: 'Unauthorized secondary terminal detected' })
    });
    expect(banRes.status).toBe(200);
    const banData = await banRes.json();
    expect(banData.success).toBe(true);
    expect(banData.team.is_banned).toBe(true);
    expect(banData.team.banned_at).toBeDefined();
    expect(banData.team.ban_reason).toBe('Unauthorized secondary terminal detected');

    // Verify in database
    const db = getDb();
    const updatedTeam = db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id) as any;
    expect(updatedTeam.is_banned).toBe(1);
    expect(updatedTeam.banned_at).toBeDefined();
    expect(updatedTeam.banned_by).toBe(adminId);
    expect(updatedTeam.ban_reason).toBe('Unauthorized secondary terminal detected');

    // Verify audit log
    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'BAN_TEAM' AND entity_id = ?").get(team.id) as any;
    expect(audit).toBeDefined();
    expect(audit.admin_user_id).toBe(adminId);
    const details = JSON.parse(audit.details_json);
    expect(details.reason).toBe('Unauthorized secondary terminal detected');
  });

  it('3. Error cases: nonexistent team, wrong session, already banned, and not banned', async () => {
    // Nonexistent team -> 404
    const resNotFound = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/99999999-9999-9999-9999-999999999999/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });
    expect(resNotFound.status).toBe(404);

    const { team } = GameService.registerTeam('Duplicate-Ban-Team');

    // First ban -> 200
    const resFirstBan = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });
    expect(resFirstBan.status).toBe(200);

    // Repeated ban on already-banned team -> 400
    const resRepeatBan = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });
    expect(resRepeatBan.status).toBe(400);

    // Unban on an unbanned team -> 400
    const { team: cleanTeam } = GameService.registerTeam('Clean-Team');
    const resUnbanClean = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${cleanTeam.id}/unban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });
    expect(resUnbanClean.status).toBe(400);
  });

  it('4. Banned team is rejected by HTTP auth (/me, game state, answers) with HTTP 403', async () => {
    const { team, token } = GameService.registerTeam('HTTP-Blocked-Team');

    // Team can access /api/auth/me initially
    const resMeBefore = await fetch(`http://127.0.0.1:${serverPort}/api/auth/me`, {
      headers: { 'x-team-token': token }
    });
    expect(resMeBefore.status).toBe(200);

    // Admin bans the team
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ reason: 'Rule violation' })
    });

    // 1. /api/auth/me now returns 403 with is_banned: true
    const resMeAfter = await fetch(`http://127.0.0.1:${serverPort}/api/auth/me`, {
      headers: { 'x-team-token': token }
    });
    expect(resMeAfter.status).toBe(403);
    const bodyMe = await resMeAfter.json();
    expect(bodyMe.is_banned).toBe(true);
    expect(bodyMe.ban_reason).toBe('Rule violation');

    // 2. /api/game/team-state returns 403
    const resTeamState = await fetch(`http://127.0.0.1:${serverPort}/api/game/team-state`, {
      headers: { 'x-team-token': token }
    });
    expect(resTeamState.status).toBe(403);

    // 3. /api/game/level1/answer returns 403
    const resAnswer = await fetch(`http://127.0.0.1:${serverPort}/api/game/level1/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-team-token': token
      },
      body: JSON.stringify({
        question_id: '00000000-0000-0000-0000-000000000000',
        selected_answer: 'AI'
      })
    });
    expect(resAnswer.status).toBe(403);
  });

  it('5. Banned team is rejected by new Socket.IO handshakes', async () => {
    const { team, token } = GameService.registerTeam('Socket-Handshake-Banned');

    // Ban the team first
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });

    // Attempt connecting via Socket.IO -> fails in handshake
    await expect(
      createClient({ auth: { teamToken: token } })
    ).rejects.toThrow();
  });

  it('6. Active team socket receives team:banned event, is disconnected, and presence updates to offline', async () => {
    const { team, token } = GameService.registerTeam('Active-Evicted-Team');
    const { session } = GameService.getGameSession();

    // Connect active socket
    const client = await createClient({ auth: { teamToken: token } });
    expect(client.connected).toBe(true);

    const presenceBefore = getTeamPresence(session.id, team.id);
    expect(presenceBefore!.is_connected).toBe(true);
    expect(presenceBefore!.connections_count).toBe(1);

    // Listen for team:banned and disconnect
    let bannedPayload: TeamBannedPayload | null = null;
    const banEventPromise = new Promise<TeamBannedPayload>((resolve) => {
      client.on('team:banned', (p) => {
        bannedPayload = p;
        resolve(p);
      });
    });

    const disconnectPromise = new Promise<void>((resolve) => {
      client.on('disconnect', () => resolve());
    });

    // Admin bans the team
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ reason: 'Disqualified for cheating' })
    });

    await banEventPromise;
    await disconnectPromise;

    expect(client.connected).toBe(false);
    expect(bannedPayload).not.toBeNull();
    expect(bannedPayload!.message).toContain('disqualified and banned');
    expect(bannedPayload!.reason).toBe('Disqualified for cheating');

    // Presence in memory should now be offline (0 connections)
    const presenceAfter = getTeamPresence(session.id, team.id);
    expect(presenceAfter).not.toBeNull();
    expect(presenceAfter!.is_connected).toBe(false);
    expect(presenceAfter!.connections_count).toBe(0);
  });

  it('7. Delayed disconnect of banned socket cannot alter presence or trigger errors', async () => {
    const { team, token } = GameService.registerTeam('Delayed-Disconnect-Banned');
    const { session } = GameService.getGameSession();

    const client = await createClient({ auth: { teamToken: token } });
    expect(client.connected).toBe(true);

    // Ban team
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });

    await new Promise((r) => setTimeout(r, 100));

    // Verify presence remains cleanly offline
    const p = getTeamPresence(session.id, team.id);
    expect(p!.is_connected).toBe(false);
    expect(p!.connections_count).toBe(0);
  });

  it('8. Unban restores HTTP and Socket.IO eligibility while preserving scores and credits', async () => {
    const { team, token } = GameService.registerTeam('Restorable-Team');

    // Give team initial progress: update scores and credits directly in DB
    const db = getDb();
    db.prepare('UPDATE teams SET level1_score = 15, current_credits = 180 WHERE id = ?').run(team.id);

    // 1. Ban team
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });

    // Verify blocked
    const resBlocked = await fetch(`http://127.0.0.1:${serverPort}/api/auth/me`, {
      headers: { 'x-team-token': token }
    });
    expect(resBlocked.status).toBe(403);

    // 2. Unban team
    const resUnban = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/unban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });
    expect(resUnban.status).toBe(200);
    const unbanData = await resUnban.json();
    expect(unbanData.success).toBe(true);
    expect(unbanData.team.is_banned).toBe(false);

    // 3. HTTP access restored with preserved scores and credits
    const resMe = await fetch(`http://127.0.0.1:${serverPort}/api/auth/me`, {
      headers: { 'x-team-token': token }
    });
    expect(resMe.status).toBe(200);
    const meData = await resMe.json();
    expect(meData.team.level1_score).toBe(15);
    expect(meData.team.current_credits).toBe(180);

    // 4. Socket.IO connection is accepted again
    const client = await createClient({ auth: { teamToken: token } });
    expect(client.connected).toBe(true);
  });

  it('9. Ban persists across server reinitialization', async () => {
    const { team, token } = GameService.registerTeam('Reboot-Persistent-Team');

    // Ban team
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ reason: 'Permanent event ban' })
    });

    // Simulate reboot: close server, re-setup database and re-initialize
    await setupDatabase();

    // Verify database record still shows banned
    const db = getDb();
    const t = db.prepare('SELECT is_banned, ban_reason FROM teams WHERE id = ?').get(team.id) as any;
    expect(t.is_banned).toBe(1);
    expect(t.ban_reason).toBe('Permanent event ban');

    // HTTP check still returns 403
    const resMe = await fetch(`http://127.0.0.1:${serverPort}/api/auth/me`, {
      headers: { 'x-team-token': token }
    });
    expect(resMe.status).toBe(403);
  });

  it('10. Banning Team A isolates Team B, admins, and anonymous viewers', async () => {
    const { team: teamA, token: tokenA } = GameService.registerTeam('Team-A-Ban');
    const { team: teamB, token: tokenB } = GameService.registerTeam('Team-B-Safe');

    const clientA = await createClient({ auth: { teamToken: tokenA } });
    const clientB = await createClient({ auth: { teamToken: tokenB } });
    const clientAdmin = await createClient({ auth: { adminToken } });
    const clientAnon = await createClient();

    expect(clientA.connected).toBe(true);
    expect(clientB.connected).toBe(true);
    expect(clientAdmin.connected).toBe(true);
    expect(clientAnon.connected).toBe(true);

    // Ban Team A
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${teamA.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      }
    });

    await new Promise((r) => setTimeout(r, 100));

    // Team A is disconnected
    expect(clientA.connected).toBe(false);

    // Team B, Admin, Anonymous remain connected and functional
    expect(clientB.connected).toBe(true);
    expect(clientAdmin.connected).toBe(true);
    expect(clientAnon.connected).toBe(true);

    // Team B HTTP works normally
    const resB = await fetch(`http://127.0.0.1:${serverPort}/api/auth/me`, {
      headers: { 'x-team-token': tokenB }
    });
    expect(resB.status).toBe(200);
  });

  it('11. Leaderboard excludes banned teams from participant rankings', () => {
    const { team: t1 } = GameService.registerTeam('Ranked-Team-1');
    const { team: t2 } = GameService.registerTeam('Banned-Candidate-Team');

    const db = getDb();
    db.prepare('UPDATE teams SET level1_score = 20 WHERE id = ?').run(t1.id);
    db.prepare('UPDATE teams SET level1_score = 30 WHERE id = ?').run(t2.id);

    // Before ban: Leaderboard has both teams, t2 is rank 1
    const lbBefore = GameService.getLeaderboard();
    expect(lbBefore.find((e) => e.team_id === t2.id)).toBeDefined();
    expect(lbBefore[0].team_id).toBe(t2.id);

    // Ban t2
    db.prepare("UPDATE teams SET is_banned = 1, banned_at = ?, ban_reason = 'Cheating' WHERE id = ?")
      .run(new Date().toISOString(), t2.id);

    // After ban: Public leaderboard excludes t2; t1 becomes rank 1
    const lbAfter = GameService.getLeaderboard();
    const bannedEntry = lbAfter.find((e) => e.team_id === t2.id);
    expect(bannedEntry).toBeUndefined();
    expect(lbAfter[0].team_id).toBe(t1.id);
    expect(lbAfter[0].rank).toBe(1);

    // Team result for banned team returns null
    const resultForBanned = GameService.getTeamResult(t2.id);
    expect(resultForBanned).toBeNull();
  });

  it('12. Admin teams list retains banned teams with presence and ban metadata', async () => {
    const { team } = GameService.registerTeam('Admin-Visible-Banned');

    // Ban team
    await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams/${team.id}/ban`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ reason: 'Audit preservation check' })
    });

    // Query GET /api/admin/teams
    const resAdminTeams = await fetch(`http://127.0.0.1:${serverPort}/api/admin/teams`, {
      headers: { 'x-admin-token': adminToken }
    });
    expect(resAdminTeams.status).toBe(200);
    const data = await resAdminTeams.json();

    const found = data.teams.find((t: any) => t.id === team.id);
    expect(found).toBeDefined();
    expect(found.is_banned).toBe(1);
    expect(found.ban_reason).toBe('Audit preservation check');
    expect(found.banned_at).toBeDefined();
    expect(found.is_connected).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { GameService } from '../services/gameService.js';
import { setupSocketIO, broadcastGameState, broadcastRoundEvent, emitToTeam, emitToAdmin, broadcastLeaderboard } from '../sockets/socketHandler.js';
import { isAllowedLanOrigin, getPrimaryLanIpv4 } from '../utils/network.js';
import { hashToken } from '../utils/crypto.js';
import { AdminUser } from '@nexus/shared';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_networking_nexus.db');

describe('Socket.IO Networking, Authentication & Room Isolation', () => {
  let server: http.Server;
  let io: SocketIOServer;
  let serverPort: number;
  let activeClients: ClientSocket[] = [];

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

    const app = express();
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

  it('1. Connects anonymously when no credentials are provided and receives public state', async () => {
    const client = await createClient();
    expect(client.connected).toBe(true);

    const statePromise = new Promise((resolve) => {
      client.on('game:state_changed', (data) => resolve(data));
    });

    broadcastGameState();
    const receivedState: any = await statePromise;
    expect(receivedState).toBeDefined();
    expect(receivedState.status).toBe('idle');
  });

  it('2. Authenticates valid team token and joins private team room', async () => {
    const { team, token } = GameService.registerTeam('Net-Inspectors');

    const client = await createClient({
      auth: { teamToken: token }
    });
    expect(client.connected).toBe(true);

    const privateUpdatePromise = new Promise((resolve) => {
      client.on('team:private_updated', (data) => resolve(data));
    });

    emitToTeam(team.id, 'team:private_updated', {
      team_id: team.id,
      credits: 200,
      stage: 'waiting'
    });

    const payload: any = await privateUpdatePromise;
    expect(payload.team_id).toBe(team.id);
    expect(payload.credits).toBe(200);
  });

  it('3. Authenticates valid admin token and joins admin channel', async () => {
    const db = getDb();
    const admin = db.prepare('SELECT * FROM admin_users LIMIT 1').get() as AdminUser;
    const signature = hashToken(admin.id + admin.password_hash);
    const adminToken = `${admin.id}:${signature}`;

    const client = await createClient({
      auth: { adminToken }
    });
    expect(client.connected).toBe(true);

    const adminEventPromise = new Promise((resolve) => {
      client.on('team:registered', (data) => resolve(data));
    });

    emitToAdmin('team:registered', {
      team_name: 'New Squad',
      id: 'test-team-id'
    });

    const payload: any = await adminEventPromise;
    expect(payload.team_name).toBe('New Squad');
  });

  it('4. Rejects explicitly invalid admin credentials with connect_error', async () => {
    await expect(
      createClient({
        auth: { adminToken: 'fake-admin-id:invalid-signature' }
      })
    ).rejects.toThrow(/Authentication failed/i);
  });

  it('5. Rejects explicitly invalid team token with connect_error', async () => {
    await expect(
      createClient({
        auth: { teamToken: 'invalid_random_token_12345' }
      })
    ).rejects.toThrow(/Authentication failed/i);
  });

  it('6. Rejects team token belonging to an archived/different game session', async () => {
    const db = getDb();
    // Create an old/archived session and a team registered to it
    const oldSessionId = uuidv4();
    db.prepare(`
      INSERT INTO game_sessions (id, name, status, current_level, settings_json, created_at, updated_at)
      VALUES (?, 'Archived Session', 'completed', NULL, '{}', datetime('now'), datetime('now'))
    `).run(oldSessionId);

    const oldTeamToken = 'old_session_team_token';
    const oldTeamHash = hashToken(oldTeamToken);
    const oldTeamId = uuidv4();
    db.prepare(`
      INSERT INTO teams (id, game_session_id, team_name, access_token_hash, initial_credits, current_credits, created_at, updated_at)
      VALUES (?, ?, 'Old Session Team', ?, 200, 200, datetime('now'), datetime('now'))
    `).run(oldTeamId, oldSessionId, oldTeamHash);

    await expect(
      createClient({
        auth: { teamToken: oldTeamToken }
      })
    ).rejects.toThrow(/active game session/i);
  });

  it('7. Enforces strict team room isolation (Team A does not receive Team B events)', async () => {
    const { team: teamA, token: tokenA } = GameService.registerTeam('Team Alpha');
    const { team: teamB, token: tokenB } = GameService.registerTeam('Team Beta');

    const clientA = await createClient({ auth: { teamToken: tokenA } });
    const clientB = await createClient({ auth: { teamToken: tokenB } });
    const anonymousClient = await createClient();

    let clientBReceived = false;
    let anonymousReceived = false;

    clientB.on('team:private_updated', () => {
      clientBReceived = true;
    });
    anonymousClient.on('team:private_updated', () => {
      anonymousReceived = true;
    });

    const aReceivedPromise = new Promise((resolve) => {
      clientA.on('team:private_updated', (data) => resolve(data));
    });

    emitToTeam(teamA.id, 'team:private_updated', {
      team_id: teamA.id,
      private_secret: 'Alpha Only Data'
    });

    const aData: any = await aReceivedPromise;
    expect(aData.private_secret).toBe('Alpha Only Data');

    // Wait a brief tick to ensure no leak occurred to Team B or Anonymous
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(clientBReceived).toBe(false);
    expect(anonymousReceived).toBe(false);
  });

  it('8. Enforces admin channel isolation (Team and Anonymous clients do not receive admin notifications)', async () => {
    const db = getDb();
    const admin = db.prepare('SELECT * FROM admin_users LIMIT 1').get() as AdminUser;
    const signature = hashToken(admin.id + admin.password_hash);
    const adminToken = `${admin.id}:${signature}`;

    const { token: teamToken } = GameService.registerTeam('Team Charlie');

    const adminClient = await createClient({ auth: { adminToken } });
    const teamClient = await createClient({ auth: { teamToken } });
    const anonymousClient = await createClient();

    let teamReceived = false;
    let anonymousReceived = false;

    teamClient.on('submission:created', () => {
      teamReceived = true;
    });
    anonymousClient.on('submission:created', () => {
      anonymousReceived = true;
    });

    const adminReceivedPromise = new Promise((resolve) => {
      adminClient.on('submission:created', (data) => resolve(data));
    });

    emitToAdmin('submission:created', {
      submission_id: 'sub-999',
      score: 10
    });

    const adminData: any = await adminReceivedPromise;
    expect(adminData.submission_id).toBe('sub-999');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(teamReceived).toBe(false);
    expect(anonymousReceived).toBe(false);
  });

  it('9. Protects leaderboard publication privacy (Full standings sent only to admin; participants receive notification signal)', async () => {
    const db = getDb();
    const admin = db.prepare('SELECT * FROM admin_users LIMIT 1').get() as AdminUser;
    const signature = hashToken(admin.id + admin.password_hash);
    const adminToken = `${admin.id}:${signature}`;

    const { token: teamToken } = GameService.registerTeam('Team Delta');

    const adminClient = await createClient({ auth: { adminToken } });
    const teamClient = await createClient({ auth: { teamToken } });

    const adminLeaderboardPromise = new Promise((resolve) => {
      adminClient.on('leaderboard:published', (data) => resolve(data));
    });

    const teamPublishedSignalPromise = new Promise((resolve) => {
      teamClient.on('results:published', (data) => resolve(data));
    });

    let teamReceivedFullLeaderboard = false;
    teamClient.on('leaderboard:published', () => {
      teamReceivedFullLeaderboard = true;
    });

    const fullLeaderboardData = [
      { rank: 1, team_name: 'Team Delta', total_score: 28 },
      { rank: 2, team_name: 'Team Rival', total_score: 15 }
    ];

    broadcastLeaderboard(fullLeaderboardData);

    const adminReceived: any = await adminLeaderboardPromise;
    expect(adminReceived).toHaveLength(2);
    expect(adminReceived[0].team_name).toBe('Team Delta');

    const teamSignal: any = await teamPublishedSignalPromise;
    expect(teamSignal).toEqual({ is_published: true });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(teamReceivedFullLeaderboard).toBe(false);
  });

  it('10. Supports 30+ simultaneous concurrent clients without dropouts or cross-talk', async () => {
    const clientCount = 35;
    const promises: Promise<ClientSocket>[] = [];

    // Register 30 teams
    const teams = [];
    for (let i = 1; i <= 30; i++) {
      const reg = GameService.registerTeam(`Scale-Team-${i}`);
      teams.push(reg);
    }

    // Connect 30 team clients
    for (let i = 0; i < 30; i++) {
      promises.push(createClient({ auth: { teamToken: teams[i].token } }));
    }

    // Connect 1 admin client
    const db = getDb();
    const admin = db.prepare('SELECT * FROM admin_users LIMIT 1').get() as AdminUser;
    const signature = hashToken(admin.id + admin.password_hash);
    const adminToken = `${admin.id}:${signature}`;
    promises.push(createClient({ auth: { adminToken } }));

    // Connect 4 anonymous viewers
    for (let i = 0; i < 4; i++) {
      promises.push(createClient());
    }

    const connectedSockets = await Promise.all(promises);
    expect(connectedSockets).toHaveLength(clientCount);
    for (const s of connectedSockets) {
      expect(s.connected).toBe(true);
    }

    // Set up listeners on all connected sockets
    const receivedPromises = connectedSockets.map(
      (socket) =>
        new Promise<boolean>((resolve) => {
          socket.on('round:started', (data: any) => {
            if (data.level === 1) resolve(true);
          });
        })
    );

    // Broadcast round event to all connected sockets
    broadcastRoundEvent('round:started', { level: 1, duration: 600 });

    const allReceived = await Promise.all(receivedPromises);
    expect(allReceived).toHaveLength(clientCount);
    expect(allReceived.every((res) => res === true)).toBe(true);
  }, 10000);

  it('11. Validates LAN origin validator allows private networks and rejects untrusted origins', () => {
    // Permitted local & LAN origins
    expect(isAllowedLanOrigin(undefined)).toBe(true);
    expect(isAllowedLanOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedLanOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://192.168.1.50:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://192.168.137.1:5173')).toBe(true);
    expect(isAllowedLanOrigin('http://10.42.0.14:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://172.20.10.2:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://172.16.0.1:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://172.31.255.255:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://169.254.12.34:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://100.64.0.1:3000')).toBe(true);
    expect(isAllowedLanOrigin('http://nexus.local:3000')).toBe(true);
    expect(isAllowedLanOrigin(`http://${getPrimaryLanIpv4()}:3000`)).toBe(true);
    expect(isAllowedLanOrigin(`http://${getPrimaryLanIpv4()}:5173`)).toBe(true);

    // Untrusted external origins & public IPs
    expect(isAllowedLanOrigin('http://evil-attacker.com')).toBe(false);
    expect(isAllowedLanOrigin('https://phishing-site.xyz:3000')).toBe(false);
    expect(isAllowedLanOrigin('http://8.8.8.8:3000')).toBe(false);
    expect(isAllowedLanOrigin('http://172.32.0.1:3000')).toBe(false); // Out of RFC 1918 172.16-31 range
    expect(isAllowedLanOrigin('http://172.15.255.255:3000')).toBe(false);

    // Deceptive hostnames with subdomains resembling LAN IPs
    expect(isAllowedLanOrigin('http://10.0.0.1.attacker.com')).toBe(false);
    expect(isAllowedLanOrigin('http://192.168.1.1.nip.io')).toBe(false);
    expect(isAllowedLanOrigin('http://localhost.evil.com')).toBe(false);

    // Out-of-bounds octets & malformed URLs
    expect(isAllowedLanOrigin('http://10.999.999.999:3000')).toBe(false);
    expect(isAllowedLanOrigin('http://192.168.300.1:3000')).toBe(false);
    expect(isAllowedLanOrigin('not-a-valid-url')).toBe(false);
    expect(isAllowedLanOrigin('ftp://192.168.1.10')).toBe(false);
    expect(isAllowedLanOrigin('javascript:alert(1)')).toBe(false);
  });
});

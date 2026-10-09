import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import express from 'express';
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
  resetPresence,
  emitToTeam,
  isSocketActiveTeamConnection
} from '../sockets/socketHandler.js';
import { isAllowedLanOrigin } from '../utils/network.js';
import { hashToken } from '../utils/crypto.js';
import { AdminUser, SessionReplacedPayload, TeamPresencePayload } from '@nexus/shared';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_single_conn_nexus.db');

describe('Point 13: One Active Tab/Device per Team (Single Active Connection Enforcement)', () => {
  let server: http.Server;
  let io: SocketIOServer;
  let serverPort: number;
  let activeClients: ClientSocket[] = [];
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
    const signature = hashToken(admin.id + admin.password_hash);
    adminToken = `${admin.id}:${signature}`;

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

  it('1. First valid team socket connects and registers active presence with connection count 1', async () => {
    const { team, token } = GameService.registerTeam('Single-Active-Alpha');
    const { session } = GameService.getGameSession();

    const client1 = await createClient({ auth: { teamToken: token } });
    expect(client1.connected).toBe(true);

    const presence = getTeamPresence(session.id, team.id);
    expect(presence).not.toBeNull();
    expect(presence!.is_connected).toBe(true);
    expect(presence!.connections_count).toBe(1);
    expect(presence!.ip_address).toBe('127.0.0.1');
    expect(presence!.last_connected_at).toBeDefined();
  });

  it('2. A second valid socket replaces the first; the old socket receives team:session_replaced and is disconnected', async () => {
    const { team, token } = GameService.registerTeam('Replacement-Team');
    const { session } = GameService.getGameSession();

    const client1 = await createClient({ auth: { teamToken: token } });
    expect(client1.connected).toBe(true);

    let replacedPayload: SessionReplacedPayload | null = null;
    let client1Disconnected = false;

    const replacedPromise = new Promise<SessionReplacedPayload>((resolve) => {
      client1.on('team:session_replaced', (payload) => {
        replacedPayload = payload;
        resolve(payload);
      });
    });

    const disconnectPromise = new Promise<void>((resolve) => {
      client1.on('disconnect', (reason) => {
        client1Disconnected = true;
        // Verify socket.io client disconnect reason from server eviction
        expect(reason).toBe('io server disconnect');
        resolve();
      });
    });

    // Connect second socket for the exact same team
    const client2 = await createClient({ auth: { teamToken: token } });
    expect(client2.connected).toBe(true);

    // Wait for client1 eviction
    await replacedPromise;
    await disconnectPromise;

    expect(client1.connected).toBe(false);
    expect(client1Disconnected).toBe(true);
    expect(replacedPayload).not.toBeNull();
    expect(replacedPayload!.message).toContain('another tab or device');
    expect(replacedPayload!.replaced_at).toBeDefined();

    // Verify replacement socket remains the sole active connection with count 1
    const presence = getTeamPresence(session.id, team.id);
    expect(presence).not.toBeNull();
    expect(presence!.is_connected).toBe(true);
    expect(presence!.connections_count).toBe(1);
  });

  it('3. Invalid credentials cannot evict an existing valid team socket', async () => {
    const { team, token } = GameService.registerTeam('Secure-Team');
    const { session } = GameService.getGameSession();

    const client1 = await createClient({ auth: { teamToken: token } });
    expect(client1.connected).toBe(true);

    // Attempt connecting with invalid token
    await expect(
      createClient({ auth: { teamToken: 'invalid_forged_token_xyz' } })
    ).rejects.toThrow();

    // client1 must remain connected and uninterrupted
    expect(client1.connected).toBe(true);

    const presence = getTeamPresence(session.id, team.id);
    expect(presence!.is_connected).toBe(true);
    expect(presence!.connections_count).toBe(1);
  });

  it('4. An old socket delayed disconnect does not mark the team offline or reduce replacement presence', async () => {
    const { team, token } = GameService.registerTeam('Delayed-Disconnect-Team');
    const { session } = GameService.getGameSession();

    // Track admin presence broadcasts
    const adminClient = await createClient({ auth: { adminToken } });
    const presenceUpdates: TeamPresencePayload[] = [];
    adminClient.on('admin:team_presence', (p: TeamPresencePayload) => {
      if (p.team_id === team.id) {
        presenceUpdates.push(p);
      }
    });

    // 1. Connect client 1
    const client1 = await createClient({ auth: { teamToken: token } });
    expect(client1.connected).toBe(true);

    // 2. Connect client 2 (evicts client 1)
    const client2 = await createClient({ auth: { teamToken: token } });
    expect(client2.connected).toBe(true);

    // Wait for client 1 to complete its disconnect cycle
    await new Promise<void>((resolve) => {
      if (!client1.connected) return resolve();
      client1.on('disconnect', () => resolve());
    });

    // Give the server event loop a tick to ensure any delayed disconnect handlers ran
    await new Promise((r) => setTimeout(r, 100));

    // Client 2 must still be fully active and presence must still show connection count 1
    const finalPresence = getTeamPresence(session.id, team.id);
    expect(finalPresence!.is_connected).toBe(true);
    expect(finalPresence!.connections_count).toBe(1);

    // None of the presence updates sent to admin should have marked the team offline (is_connected: false)
    const offlineUpdates = presenceUpdates.filter((p) => !p.is_connected);
    expect(offlineUpdates.length).toBe(0);
  });

  it('5. The replacement socket receives private updates while replaced socket does not', async () => {
    const { team, token } = GameService.registerTeam('Private-Room-Team');

    const client1 = await createClient({ auth: { teamToken: token } });
    const client2 = await createClient({ auth: { teamToken: token } });

    let client1GotUpdate = false;
    let client2GotUpdate = false;

    client1.on('team:private_updated', () => { client1GotUpdate = true; });
    client2.on('team:private_updated', () => { client2GotUpdate = true; });

    const updatePromise = new Promise<void>((resolve) => {
      client2.on('team:private_updated', () => resolve());
    });

    emitToTeam(team.id, 'team:private_updated', { stage: 'round1' });
    await updatePromise;

    // Small delay to ensure no unexpected event delivery to client1
    await new Promise((r) => setTimeout(r, 50));

    expect(client2GotUpdate).toBe(true);
    expect(client1GotUpdate).toBe(false);
  });

  it('6. Disconnecting the active replacement socket marks the team offline with connection count 0', async () => {
    const { team, token } = GameService.registerTeam('Offline-Transition-Team');
    const { session } = GameService.getGameSession();

    const client1 = await createClient({ auth: { teamToken: token } });
    const client2 = await createClient({ auth: { teamToken: token } });

    // Client 2 is now active
    expect(getTeamPresence(session.id, team.id)!.connections_count).toBe(1);

    // Disconnect active socket
    client2.disconnect();

    await new Promise((r) => setTimeout(r, 50));

    const finalPresence = getTeamPresence(session.id, team.id);
    expect(finalPresence).not.toBeNull();
    expect(finalPresence!.is_connected).toBe(false);
    expect(finalPresence!.connections_count).toBe(0);
  });

  it('7. A replaced socket cannot execute protected inbound socket events (nexus:ping)', async () => {
    const { team, token } = GameService.registerTeam('Inbound-Check-Team');

    const client1 = await createClient({ auth: { teamToken: token } });

    // Verify active socket can ping successfully
    const pingActive = await new Promise<any>((resolve) => {
      client1.emit('nexus:ping', (res: any) => resolve(res));
    });
    expect(pingActive).toBeDefined();
    expect(pingActive.server_time).toBeDefined();

    // Find server-side socket object for client1
    const serverSocket1 = Array.from(io.sockets.sockets.values()).find((s) => s.id === client1.id);
    expect(serverSocket1).toBeDefined();
    expect(isSocketActiveTeamConnection(serverSocket1!)).toBe(true);

    // Now connect client2 (which marks serverSocket1 as replaced and evicts it)
    const client2 = await createClient({ auth: { teamToken: token } });
    expect(client2.connected).toBe(true);

    // Verification: helper reports false for the replaced socket
    expect(isSocketActiveTeamConnection(serverSocket1!)).toBe(false);

    // If a replaced server socket manually receives nexus:ping, it is dropped
    let pingReplied = false;
    serverSocket1!.emit = () => true as any; // prevent crash if attempted
    const listeners = (serverSocket1 as any).listeners('nexus:ping');
    for (const listener of listeners) {
      listener((_res: any) => { pingReplied = true; });
    }
    expect(pingReplied).toBe(false);
  });

  it('8. Simultaneous connection attempts result in strictly one active connection', async () => {
    const { team, token } = GameService.registerTeam('Concurrent-Team');
    const { session } = GameService.getGameSession();

    // Launch 3 simultaneous connection attempts
    const clients = await Promise.all([
      createClient({ auth: { teamToken: token } }),
      createClient({ auth: { teamToken: token } }),
      createClient({ auth: { teamToken: token } })
    ]);

    // Give event loop time to process evictions
    await new Promise((r) => setTimeout(r, 100));

    // Exactly one client should remain connected
    const connectedCount = clients.filter((c) => c.connected).length;
    expect(connectedCount).toBe(1);

    const presence = getTeamPresence(session.id, team.id);
    expect(presence!.is_connected).toBe(true);
    expect(presence!.connections_count).toBe(1);
  });

  it('9. Different teams and sessions remain strictly isolated', async () => {
    const { team: teamA, token: tokenA } = GameService.registerTeam('Team-Isolated-A');
    const { team: teamB, token: tokenB } = GameService.registerTeam('Team-Isolated-B');
    const { session } = GameService.getGameSession();

    const clientA1 = await createClient({ auth: { teamToken: tokenA } });
    const clientB1 = await createClient({ auth: { teamToken: tokenB } });

    // Both different teams connect simultaneously without evicting each other
    expect(clientA1.connected).toBe(true);
    expect(clientB1.connected).toBe(true);

    expect(getTeamPresence(session.id, teamA.id)!.connections_count).toBe(1);
    expect(getTeamPresence(session.id, teamB.id)!.connections_count).toBe(1);

    // Connecting a replacement for Team A only evicts Team A's socket
    const clientA2 = await createClient({ auth: { teamToken: tokenA } });
    await new Promise((r) => setTimeout(r, 50));

    expect(clientA1.connected).toBe(false);
    expect(clientA2.connected).toBe(true);
    expect(clientB1.connected).toBe(true); // Team B remains connected!

    expect(getTeamPresence(session.id, teamA.id)!.connections_count).toBe(1);
    expect(getTeamPresence(session.id, teamB.id)!.connections_count).toBe(1);
  });

  it('10. Admin and anonymous viewer connections are unaffected by team evictions', async () => {
    const { team, token } = GameService.registerTeam('Team-With-Viewers');

    const adminClient1 = await createClient({ auth: { adminToken } });
    const adminClient2 = await createClient({ auth: { adminToken } });
    const anonymousClient = await createClient();

    expect(adminClient1.connected).toBe(true);
    expect(adminClient2.connected).toBe(true);
    expect(anonymousClient.connected).toBe(true);

    // Connect first team socket, then replace with second team socket
    const client1 = await createClient({ auth: { teamToken: token } });
    const client2 = await createClient({ auth: { teamToken: token } });

    await new Promise((r) => setTimeout(r, 50));

    expect(client1.connected).toBe(false);
    expect(client2.connected).toBe(true);

    // Admins and anonymous viewer remain connected
    expect(adminClient1.connected).toBe(true);
    expect(adminClient2.connected).toBe(true);
    expect(anonymousClient.connected).toBe(true);
  });
});

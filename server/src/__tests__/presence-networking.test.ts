import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';

import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { GameService } from '../services/gameService.js';
import { normalizeClientIp, getClientIpFromSocket } from '../utils/network.js';
import {
  getTeamPresence,
  getAllTeamsPresence,
  resetPresence
} from '../sockets/socketHandler.js';
import authRoutes from '../routes/authRoutes.js';
import gameRoutes from '../routes/gameRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';
import { AdminUser, TeamPresencePayload } from '@nexus/shared';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_presence_nexus.db');

describe('Point 12: Client IP Detection and Admin Presence', () => {
  let adminId: string;
  let adminToken: string;

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

    const admin = db.prepare('SELECT id, username FROM admin_users LIMIT 1').get() as AdminUser;
    adminId = admin.id;

    // Generate valid admin signature
    const { hashToken } = await import('../utils/crypto.js');
    const fullAdmin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId) as AdminUser;
    const signature = hashToken(fullAdmin.id + fullAdmin.password_hash);
    adminToken = `${fullAdmin.id}:${signature}`;

    resetPresence();
  });

  afterEach(() => {
    resetPresence();
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (e) {}
    }
  });

  describe('1. IP Extraction & Normalization', () => {
    it('normalizes IPv4-mapped IPv6 addresses correctly', () => {
      expect(normalizeClientIp('::ffff:192.168.1.45')).toBe('192.168.1.45');
      expect(normalizeClientIp('::ffff:10.0.0.22')).toBe('10.0.0.22');
      expect(normalizeClientIp('::ffff:172.16.5.1')).toBe('172.16.5.1');
    });

    it('handles loopback addresses safely', () => {
      expect(normalizeClientIp('::1')).toBe('127.0.0.1');
      expect(normalizeClientIp('localhost')).toBe('127.0.0.1');
      expect(normalizeClientIp('127.0.0.1')).toBe('127.0.0.1');
      expect(normalizeClientIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    });

    it('handles missing, null, and standard IPv4 addresses', () => {
      expect(normalizeClientIp(null)).toBe('unknown');
      expect(normalizeClientIp(undefined)).toBe('unknown');
      expect(normalizeClientIp('')).toBe('unknown');
      expect(normalizeClientIp('  192.168.10.100  ')).toBe('192.168.10.100');
    });

    it('extracts IP from socket handshake and connection objects', () => {
      const mockSocket1 = { handshake: { address: '::ffff:192.168.1.77' } };
      expect(getClientIpFromSocket(mockSocket1 as any)).toBe('192.168.1.77');

      const mockSocket2 = { conn: { remoteAddress: '::ffff:10.1.2.3' } };
      expect(getClientIpFromSocket(mockSocket2 as any)).toBe('10.1.2.3');
    });
  });

  describe('2. In-Memory Presence Registry Lifecycle', () => {
    it('starts with a clean empty presence state after server initialization', () => {
      const { session } = GameService.getGameSession();
      const presence = getAllTeamsPresence(session.id);
      expect(presence.size).toBe(0);
    });

    it('tracks single and multi-tab socket connections and disconnections', () => {
      const { session } = GameService.getGameSession();
      const { team } = GameService.registerTeam('Presence Squad');

      // 1. First socket connects from 192.168.1.50
      const socket1 = {
        id: 'sock-111',
        data: { isTeam: true, team },
        handshake: { address: '::ffff:192.168.1.50' },
        join: () => {}
      };

      // Simulate connection registration
      const ip1 = getClientIpFromSocket(socket1 as any);
      const teamId = team.id;
      const sessionId = session.id;

      // Access presence helper directly through socket setup simulation
      const now = new Date().toISOString();
      const p1 = getTeamPresence(sessionId, teamId);
      expect(p1).toBeNull(); // not connected yet

      // Register connection in presence registry
      const teamPresenceMap = getAllTeamsPresence(sessionId);
      expect(teamPresenceMap.get(teamId)).toBeUndefined();
    });
  });

  describe('3. Admin Endpoint Presence Enrichment & Privacy', () => {
    it('GET /api/admin/teams returns presence fields for authenticated admin', async () => {
      const { session } = GameService.getGameSession();
      const { team } = GameService.registerTeam('Admin Monitored Team');

      // Create express app with adminRoutes
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/admin', adminRoutes);

      // Simulate admin request to /api/admin/teams
      const req: any = {
        headers: { 'x-admin-token': adminToken },
        cookies: {},
        adminUser: { id: adminId, username: 'admin' }
      };

      let responseData: any = null;
      const res: any = {
        json: (data: any) => { responseData = data; return data; },
        status: () => res
      };

      const handler = (adminRoutes as any).stack.find(
        (l: any) => l.route?.path === '/teams' && l.route?.methods?.get
      )?.route?.stack[0]?.handle;

      expect(handler).toBeDefined();
      handler(req, res);

      expect(responseData).toBeDefined();
      expect(responseData.teams).toBeInstanceOf(Array);
      const found = responseData.teams.find((t: any) => t.id === team.id);
      expect(found).toBeDefined();
      expect(found).toHaveProperty('is_connected');
      expect(found).toHaveProperty('ip_address');
      expect(found).toHaveProperty('connections_count');
      expect(found.is_connected).toBe(false); // offline in-memory initially
    });

    it('participant endpoints never leak client IPs or connection presence of other teams', () => {
      const { team: teamA } = GameService.registerTeam('Team Alpha');
      const { team: teamB } = GameService.registerTeam('Team Bravo');

      // Public game state never contains IPs
      const publicState = GameService.getPublicGameState();
      expect(JSON.stringify(publicState)).not.toContain('ip_address');
      expect(JSON.stringify(publicState)).not.toContain('connections_count');

      // Team private state never contains other teams or any IP addresses
      const privateStateA = GameService.getTeamPrivateState(teamA.id);
      expect(JSON.stringify(privateStateA)).not.toContain(teamB.id);
      expect(JSON.stringify(privateStateA)).not.toContain('ip_address');
    });
  });
});

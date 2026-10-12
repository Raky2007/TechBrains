import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import { getDb, closeDb } from '../database/db.js';
import { setupDatabase } from '../database/setup.js';
import { seedDatabase } from '../database/seed.js';
import { GameService } from '../services/gameService.js';
import { resetRateLimiter } from '../middleware/rateLimiter.js';
import { CONFIG } from '../config.js';

import authRoutes from '../routes/authRoutes.js';
import gameRoutes from '../routes/gameRoutes.js';
import adminRoutes from '../routes/adminRoutes.js';

const TEST_DB_PATH = path.resolve(__dirname, '../../test_api_routes.db');

/**
 * Build a minimal Express app that mounts the real routers against the test
 * database. No Socket.IO and no static serving — every socket emit helper is
 * null-safe when `io` was never initialized, so the HTTP layer runs standalone.
 */
function buildApp(): Express {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/game', gameRoutes);
  app.use('/api/admin', adminRoutes);
  return app;
}

function cleanupDbFiles(): void {
  for (const p of [TEST_DB_PATH, `${TEST_DB_PATH}-wal`, `${TEST_DB_PATH}-shm`]) {
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * Register a team with the roll numbers the schema requires, returning the
 * registration response so callers can read the token / team id.
 */
function registerTeam(app: Express, teamName: string) {
  return request(app)
    .post('/api/auth/register')
    .send({ team_name: teamName, player1_roll: 'R101', player2_roll: 'R102' });
}

/** Log in as the default seeded admin and return the admin bearer token. */
async function loginAdmin(app: Express): Promise<string> {
  const res = await request(app)
    .post('/api/auth/admin/login')
    .send({ username: CONFIG.ADMIN_USERNAME, password: CONFIG.ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();
  return res.body.token as string;
}

describe('HTTP API routes (auth, validation, permissions)', () => {
  let app: Express;

  beforeEach(async () => {
    closeDb();
    cleanupDbFiles();
    getDb(TEST_DB_PATH); // cache the test DB so routes' getDb() hits it
    await setupDatabase();
    await seedDatabase();
    resetRateLimiter(); // isolate each test from the shared in-memory limiter
    app = buildApp();
  });

  afterEach(() => {
    closeDb();
    cleanupDbFiles();
  });

  // ---- Public endpoints ---------------------------------------------------
  it('GET /api/game/state is public and returns authoritative session state', async () => {
    const res = await request(app).get('/api/game/state');
    expect(res.status).toBe(200);
    expect(res.body.session_id).toBeTruthy();
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('server_time');
  });

  // ---- Team registration & auth ------------------------------------------
  it('POST /api/auth/register creates a team and sets a cookie + token', async () => {
    const res = await registerTeam(app, 'Route Raiders');
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.team.team_name).toBe('Route Raiders');
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string | undefined;
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
    expect(cookieStr).toContain('nexus_team_token');
  });

  it('POST /api/auth/register rejects a duplicate team name (case-insensitive)', async () => {
    await registerTeam(app, 'Dup Team');
    const res = await registerTeam(app, 'dup team');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already registered/i);
  });

  it('POST /api/auth/register rejects an invalid (too short) team name via Zod', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ team_name: 'x', player1_roll: 'R101', player2_roll: 'R102' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('GET /api/game/team-state requires a team token (401 without one)', async () => {
    const res = await request(app).get('/api/game/team-state');
    expect(res.status).toBe(401);
  });

  it('GET /api/game/team-state succeeds with a valid team token', async () => {
    const reg = await registerTeam(app, 'Token Team');
    const token = reg.body.token as string;
    const res = await request(app)
      .get('/api/game/team-state')
      .set('x-team-token', token);
    expect(res.status).toBe(200);
    expect(res.body.team.team_name).toBe('Token Team');
    expect(res.body).toHaveProperty('stage');
  });

  it('GET /api/game/team-state rejects a bogus team token (401)', async () => {
    const res = await request(app)
      .get('/api/game/team-state')
      .set('x-team-token', 'not-a-real-token');
    expect(res.status).toBe(401);
  });

  // ---- Admin login & admin guard -----------------------------------------
  it('POST /api/auth/admin/login succeeds with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ username: CONFIG.ADMIN_USERNAME, password: CONFIG.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.admin.username.toLowerCase()).toBe(CONFIG.ADMIN_USERNAME.toLowerCase());
  });

  it('POST /api/auth/admin/login rejects a wrong password (401)', async () => {
    const res = await request(app)
      .post('/api/auth/admin/login')
      .send({ username: CONFIG.ADMIN_USERNAME, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/overview requires admin auth (401 without token)', async () => {
    const res = await request(app).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/overview rejects a team token (admin guard is separate)', async () => {
    const reg = await registerTeam(app, 'Not Admin');
    const res = await request(app)
      .get('/api/admin/overview')
      .set('x-admin-token', reg.body.token);
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/overview succeeds with a valid admin token', async () => {
    const adminToken = await loginAdmin(app);
    const res = await request(app)
      .get('/api/admin/overview')
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.session).toBeTruthy();
    expect(res.body.stats).toHaveProperty('registered_teams');
  });

  // ---- Ban gating ---------------------------------------------------------
  it('a banned team is rejected with 403 TEAM_BANNED on team routes', async () => {
    const reg = await registerTeam(app, 'Cheaters');
    const token = reg.body.token as string;
    const teamId = reg.body.team.id as string;

    const adminToken = await loginAdmin(app);
    const banRes = await request(app)
      .post(`/api/admin/teams/${teamId}/ban`)
      .set('x-admin-token', adminToken)
      .send({ reason: 'Multiple devices detected' });
    expect(banRes.status).toBe(200);

    const res = await request(app)
      .get('/api/game/team-state')
      .set('x-team-token', token);
    expect(res.status).toBe(403);
    expect(res.body.is_banned).toBe(true);
  });

  // ---- Leaderboard embargo ------------------------------------------------
  it('GET /api/game/leaderboard is embargoed for participants until published', async () => {
    const res = await request(app).get('/api/game/leaderboard');
    expect(res.status).toBe(200);
    expect(res.body.is_published).toBe(false);
    expect(res.body.leaderboard).toEqual([]);
  });

  it('GET /api/game/leaderboard returns full standings to a verified admin even pre-publish', async () => {
    await registerTeam(app, 'Standings Team');
    const adminToken = await loginAdmin(app);
    const res = await request(app)
      .get('/api/game/leaderboard')
      .set('x-admin-token', adminToken);
    expect(res.status).toBe(200);
    expect(res.body.is_published).toBe(true);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
    expect(res.body.leaderboard.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Level 1 answer gating ---------------------------------------------
  it('POST /api/game/level1/answer is rejected when no round is active', async () => {
    const reg = await registerTeam(app, 'Early Birds');
    const res = await request(app)
      .post('/api/game/level1/answer')
      .set('x-team-token', reg.body.token)
      // Valid UUID so Zod passes; the service then rejects because no round is active.
      .send({ question_id: uuidv4(), selected_answer: 'AI' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not currently active/i);
  });

  it('POST /api/game/level1/answer rejects a malformed payload via Zod (400)', async () => {
    const reg = await registerTeam(app, 'Bad Payload');
    const res = await request(app)
      .post('/api/game/level1/answer')
      .set('x-team-token', reg.body.token)
      .send({ selected_answer: 'MAYBE' }); // invalid choice + missing question_id
    expect(res.status).toBe(400);
  });

  // ---- Admin controls lifecycle ------------------------------------------
  it('POST /api/admin/controls start_event starts Level 1 for an admin', async () => {
    const adminToken = await loginAdmin(app);
    const res = await request(app)
      .post('/api/admin/controls')
      .set('x-admin-token', adminToken)
      .send({ action: 'start_event' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const state = await request(app).get('/api/game/state');
    expect(state.body.status).toBe('level1_active');
  });

  it('POST /api/admin/controls rejects an unknown action (400)', async () => {
    const adminToken = await loginAdmin(app);
    const res = await request(app)
      .post('/api/admin/controls')
      .set('x-admin-token', adminToken)
      .send({ action: 'self_destruct' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown control action/i);
  });
});

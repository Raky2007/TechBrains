import { Router, Request, Response } from 'express';
import { teamRegisterSchema, adminLoginSchema } from '@nexus/shared';
import { GameService } from '../services/gameService.js';
import { requireTeamAuth, requireAdminAuth } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import { getDb } from '../database/db.js';
import { verifyPassword, hashToken } from '../utils/crypto.js';
import { emitToAdmin } from '../sockets/socketHandler.js';
import { AdminUser } from '@nexus/shared';

const router = Router();

/**
 * Team Registration
 * Route: POST /api/auth/register
 */
router.post('/register', rateLimiter(10000, 10, 'Too many registration attempts. Please wait.'), async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = teamRegisterSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid team registration parameters.' });
      return;
    }

    const { team_name } = parseResult.data;
    const { team, token } = GameService.registerTeam(team_name);

    // Set HTTP-only secure cookie
    res.cookie('nexus_team_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // LAN HTTP deployment
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    emitToAdmin('team:registered', {
      id: team.id,
      team_name: team.team_name,
      created_at: team.created_at
    });

    res.status(201).json({
      message: 'Registration successful',
      team: {
        id: team.id,
        team_name: team.team_name,
        current_credits: team.current_credits,
        level1_score: team.level1_score,
        level2_score: team.level2_score
      },
      token // Return token for client-side storage fallback
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Registration failed.' });
  }
});

/**
 * Get current team profile
 * Route: GET /api/auth/me
 */
router.get('/me', requireTeamAuth, (req: Request, res: Response): void => {
  const team = req.team!;
  res.json({
    team: {
      id: team.id,
      team_name: team.team_name,
      current_credits: team.current_credits,
      level1_score: team.level1_score,
      level2_score: team.level2_score,
      created_at: team.created_at
    }
  });
});

/**
 * Team Logout
 * Route: POST /api/auth/logout
 */
router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('nexus_team_token', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false
  });
  res.json({ message: 'Team logged out successfully' });
});

/**
 * Admin Login
 * Route: POST /api/auth/admin/login
 */
router.post('/admin/login', rateLimiter(10000, 5, 'Too many login attempts. Please wait a moment.'), async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = adminLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const { username, password } = parseResult.data;
    const db = getDb();
    const admin = db.prepare('SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE').get(username) as AdminUser | undefined;

    if (!admin) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const passwordMatch = await verifyPassword(password, admin.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const signature = hashToken(admin.id + admin.password_hash);
    const token = `${admin.id}:${signature}`;

    res.cookie('nexus_admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Admin authentication successful',
      admin: {
        id: admin.id,
        username: admin.username
      },
      token
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Authentication service failure.' });
  }
});

/**
 * Get current admin profile
 * Route: GET /api/auth/admin/me
 */
router.get('/admin/me', requireAdminAuth, (req: Request, res: Response): void => {
  res.json({
    admin: {
      id: req.adminUser!.id,
      username: req.adminUser!.username
    }
  });
});

/**
 * Admin Logout
 * Route: POST /api/auth/admin/logout
 */
router.post('/admin/logout', (_req: Request, res: Response): void => {
  res.clearCookie('nexus_admin_token');
  res.json({ message: 'Logged out successfully' });
});

export default router;

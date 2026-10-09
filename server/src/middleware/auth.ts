import { Request, Response, NextFunction } from 'express';
import { getDb } from '../database/db.js';
import { hashToken } from '../utils/crypto.js';
import { Team, AdminUser } from '@nexus/shared';

declare global {
  namespace Express {
    interface Request {
      team?: Team;
      adminUser?: AdminUser;
    }
  }
}

/**
 * Verify a team token and return the Team, or null if invalid.
 */
export function verifyTeamToken(token?: string): Team | null {
  if (!token || typeof token !== 'string') return null;
  const tokenHash = hashToken(token);
  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE access_token_hash = ?').get(tokenHash) as Team | undefined;
  return team || null;
}

/**
 * Middleware to require a valid team session.
 */
export function requireTeamAuth(req: Request, res: Response, next: NextFunction): void {
  let token = req.cookies?.nexus_team_token || (req.headers['x-team-token'] as string);
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }

  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Team authentication required. Please register or rejoin.' });
    return;
  }

  const team = verifyTeamToken(token);
  if (!team) {
    res.status(401).json({ error: 'Invalid or expired team session token.' });
    return;
  }

  if (team.is_banned) {
    res.status(403).json({
      error: 'This team has been disqualified and banned by an administrator.',
      is_banned: true,
      ban_reason: team.ban_reason || 'Banned by administrator',
      banned_at: team.banned_at
    });
    return;
  }

  req.team = team;
  next();
}

/**
 * Read the admin token from an Express request (cookie or Bearer header).
 */
export function getAdminTokenFromRequest(req: Request): string | undefined {
  let token = req.cookies?.nexus_admin_token || (req.headers['x-admin-token'] as string);
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }
  return typeof token === 'string' ? token : undefined;
}

/**
 * Verify an admin token signature and return the AdminUser, or null if invalid.
 * This is the single source of truth for admin identity — never treat the mere
 * presence of a cookie as authorization.
 */
export function verifyAdminToken(token?: string): AdminUser | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split(':');
  if (parts.length !== 2) return null;

  const [adminId, signature] = parts;
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId) as AdminUser | undefined;
  if (!admin) return null;

  const expectedSignature = hashToken(admin.id + admin.password_hash);
  if (signature !== expectedSignature) return null;

  return admin;
}

/**
 * Middleware to require administrator authorization.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getAdminTokenFromRequest(req);
  if (!token) {
    res.status(401).json({ error: 'Administrator authentication required.' });
    return;
  }

  const admin = verifyAdminToken(token);
  if (!admin) {
    res.status(401).json({ error: 'Invalid or expired administrator credentials.' });
    return;
  }

  req.adminUser = admin;
  next();
}

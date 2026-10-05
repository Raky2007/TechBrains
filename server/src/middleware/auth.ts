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

  const tokenHash = hashToken(token);
  const db = getDb();
  const team = db.prepare('SELECT * FROM teams WHERE access_token_hash = ?').get(tokenHash) as Team | undefined;

  if (!team) {
    res.status(401).json({ error: 'Invalid or expired team session token.' });
    return;
  }

  req.team = team;
  next();
}

/**
 * Middleware to require administrator authorization.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  let token = req.cookies?.nexus_admin_token;
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.substring(7);
  }

  if (!token || typeof token !== 'string') {
    res.status(401).json({ error: 'Administrator authentication required.' });
    return;
  }

  // Token is formatted as userId:signatureHash
  const parts = token.split(':');
  if (parts.length !== 2) {
    res.status(401).json({ error: 'Malformed administrator token.' });
    return;
  }

  const [adminId, signature] = parts;
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId) as AdminUser | undefined;

  if (!admin) {
    res.status(401).json({ error: 'Administrator user not found.' });
    return;
  }

  // Verify signature against password hash
  const expectedSignature = hashToken(admin.id + admin.password_hash);
  if (signature !== expectedSignature) {
    res.status(401).json({ error: 'Invalid administrator credentials signature.' });
    return;
  }

  req.adminUser = admin;
  next();
}

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Generate a cryptographically secure random token for team sessions.
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a session token using SHA-256 for persistent database storage.
 * Prevents raw token leakage even if DB is compromised.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Hash a password using bcrypt with salt rounds 10.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

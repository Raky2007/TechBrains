import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db.js';
import { CONFIG } from '../config.js';
import { hashPassword } from '../utils/crypto.js';

export async function setupDatabase(): Promise<void> {
  const db = getDb();
  console.log(`[Database] Initialized SQLite at: ${CONFIG.DATABASE_PATH}`);

  // Check or create admin user
  const existingAdmin = db.prepare('SELECT id, username FROM admin_users WHERE username = ? COLLATE NOCASE').get(CONFIG.ADMIN_USERNAME);
  if (!existingAdmin) {
    const adminId = uuidv4();
    const passwordHash = await hashPassword(CONFIG.ADMIN_PASSWORD);
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO admin_users (id, username, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(adminId, CONFIG.ADMIN_USERNAME, passwordHash, now, now);
    
    console.log(`[Database] Created initial administrator: ${CONFIG.ADMIN_USERNAME}`);
  } else {
    console.log(`[Database] Administrator exists: ${CONFIG.ADMIN_USERNAME}`);
  }

  // Check or create primary game session
  const existingSession = db.prepare('SELECT id, status FROM game_sessions ORDER BY created_at DESC LIMIT 1').get();
  if (!existingSession) {
    const sessionId = uuidv4();
    const now = new Date().toISOString();
    const settingsJson = JSON.stringify(CONFIG.DEFAULT_SETTINGS);

    db.prepare(`
      INSERT INTO game_sessions (id, name, status, current_level, settings_json, created_at, updated_at)
      VALUES (?, ?, 'idle', NULL, ?, ?, ?)
    `).run(sessionId, 'NEXUS LAN Championship Session', settingsJson, now, now);

    console.log(`[Database] Created primary game session: ${sessionId}`);
  } else {
    console.log(`[Database] Current game session ready: ${(existingSession as any).id}`);
  }
}

// Allow direct CLI invocation
if (process.argv[1]?.endsWith('setup.ts') || process.argv[1]?.endsWith('setup.js')) {
  setupDatabase()
    .then(() => {
      console.log('[Database] Setup completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Database] Setup error:', err);
      process.exit(1);
    });
}

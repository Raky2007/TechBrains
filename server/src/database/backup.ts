import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db.js';
import { CONFIG } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function backupDatabaseAndUploads(): Promise<string> {
  const db = getDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, `../../backups/backup_${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const dbBackupPath = path.join(backupDir, 'nexus.db');
  console.log(`[Backup] Initiating authoritative SQLite backup to: ${dbBackupPath}...`);

  // Use better-sqlite3 native backup API to safely snapshot even with active WAL writes
  await db.backup(dbBackupPath);

  // Copy uploads folder if it exists
  const uploadsBackupDir = path.join(backupDir, 'uploads');
  if (fs.existsSync(CONFIG.UPLOAD_DIR)) {
    fs.cpSync(CONFIG.UPLOAD_DIR, uploadsBackupDir, { recursive: true });
    console.log(`[Backup] Copied uploads directory to backup.`);
  }

  // Write metadata
  const metadata = {
    timestamp: new Date().toISOString(),
    databasePath: CONFIG.DATABASE_PATH,
    backupPath: backupDir,
    gameSession: db.prepare('SELECT id, name, status, current_level FROM game_sessions ORDER BY created_at DESC LIMIT 1').get(),
    teamsCount: (db.prepare('SELECT COUNT(*) as count FROM teams').get() as any)?.count || 0,
    answersCount: (db.prepare('SELECT COUNT(*) as count FROM team_answers').get() as any)?.count || 0,
    conclusionsCount: (db.prepare('SELECT COUNT(*) as count FROM conclusions').get() as any)?.count || 0
  };

  fs.writeFileSync(path.join(backupDir, 'backup-metadata.json'), JSON.stringify(metadata, null, 2));

  console.log(`[Backup] Backup completed successfully in: ${backupDir}`);
  return backupDir;
}

// CLI direct run
if (process.argv[1]?.endsWith('backup.ts') || process.argv[1]?.endsWith('backup.js')) {
  backupDatabaseAndUploads()
    .then((dir) => {
      console.log(`Backup available at: ${dir}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Backup failed:', err);
      process.exit(1);
    });
}

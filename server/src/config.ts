import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { BRANDING } from '@nexus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from workspace root or server root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'nexus_forensics_2026!',
  SESSION_SECRET: process.env.SESSION_SECRET || 'nexus_lan_forensic_cryptographic_secret_key_88492019',
  
  DATABASE_PATH: path.resolve(__dirname, '../../', process.env.DATABASE_PATH || 'nexus.db'),
  UPLOAD_DIR: path.resolve(__dirname, '../uploads'),
  PUBLIC_DIR: path.resolve(__dirname, '../public'),
  
  MAX_UPLOAD_SIZE_BYTES: (parseInt(process.env.MAX_UPLOAD_SIZE_MB || '25', 10)) * 1024 * 1024,
  
  DEFAULT_SETTINGS: {
    level1DurationMinutes: parseInt(process.env.LEVEL1_DURATION_MINUTES || '10', 10),
    level2DurationMinutes: parseInt(process.env.LEVEL2_DURATION_MINUTES || '20', 10),
    initialCredits: parseInt(process.env.INITIAL_CREDITS || '200', 10),
    resultsPublished: false,
    tieBreakerRule: 'default' as const,
    randomizeQuestionOrder: true
  },
  
  BRANDING
};

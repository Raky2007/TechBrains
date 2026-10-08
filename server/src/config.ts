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

  // AI evaluation provider configuration (server-side only; keys never reach the client).
  // AI_PROVIDER: 'none' | 'mock' | 'anthropic' | 'openai'
  //  - 'none'  : no automatic evaluation; admins evaluate/override manually.
  //  - 'mock'  : deterministic offline heuristic (great for LAN demos & tests).
  //  - 'anthropic' / 'openai' : call the hosted provider over HTTPS.
  AI: {
    PROVIDER: (process.env.AI_PROVIDER || 'none').toLowerCase(),
    API_KEY: process.env.AI_API_KEY || '',
    MODEL: process.env.AI_MODEL || 'claude-sonnet-5-5',
    BASE_URL: process.env.AI_BASE_URL || '',
    TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS || '30000', 10),
    MAX_RETRIES: parseInt(process.env.AI_MAX_RETRIES || '1', 10)
  },

  DEFAULT_SETTINGS: {
    level1DurationMinutes: parseInt(process.env.LEVEL1_DURATION_MINUTES || '10', 10),
    level2DurationMinutes: parseInt(process.env.LEVEL2_DURATION_MINUTES || '20', 10),
    initialCredits: parseInt(process.env.INITIAL_CREDITS || '200', 10),
    round2MaxScore: parseInt(process.env.ROUND2_MAX_SCORE || '20', 10),
    round1CutoffScore: parseInt(process.env.ROUND1_CUTOFF_SCORE || '0', 10),
    resultsPublished: false,
    tieBreakerRule: 'default' as const,
    randomizeQuestionOrder: true
  },
  
  BRANDING
};

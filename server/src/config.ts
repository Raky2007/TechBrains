import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { BRANDING } from '@nexus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server root or workspace root (auto-reloaded)
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'nexus_forensics_2026!',
  SESSION_SECRET: process.env.SESSION_SECRET || 'nexus_lan_forensic_cryptographic_secret_key_88492019',
  
  CLIENT_URL: process.env.CLIENT_URL || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',

  DATABASE_PATH: path.resolve(__dirname, '../../', process.env.DATABASE_PATH || 'nexus.db'),
  UPLOAD_DIR: path.resolve(__dirname, '../uploads'),
  PUBLIC_DIR: path.resolve(__dirname, '../public'),
  
  MAX_UPLOAD_SIZE_BYTES: (parseInt(process.env.MAX_UPLOAD_SIZE_MB || '25', 10)) * 1024 * 1024,

  // AI evaluation provider configuration (server-side only; keys never reach the client).
  // Priority: explicit AI_PROVIDER (e.g. ollama), NVIDIA Nemotron NIM via NVIDIA_API_KEY, OpenRouter, fallback to AI_PROVIDER.
  AI: {
    PROVIDER: (process.env.AI_PROVIDER || 'ollama').toLowerCase(),
    API_KEY: (process.env.AI_API_KEY || process.env.NVIDIA_API_KEY || process.env.OPENAI_API_KEY || '').trim(),
    OPENROUTER_API_KEY: (process.env.OPENROUTER_API_KEY || '').trim(),
    OPENROUTER_API_KEY_2: (process.env.OPENROUTER_API_KEY_2 || '').trim(),
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || process.env.AI_MODEL || 'qwen3:8b',
    MODEL: process.env.OLLAMA_MODEL || process.env.AI_MODEL || 'qwen3:8b',
    BASE_URL: process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL || 'http://127.0.0.1:11434',
    TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS || '120000', 10),
    MAX_RETRIES: parseInt(process.env.AI_MAX_RETRIES || '2', 10),
    CONCURRENCY: Math.max(1, parseInt(process.env.AI_CONCURRENCY || '1', 10)),
    MAX_QUEUE_SIZE: Math.max(10, parseInt(process.env.AI_MAX_QUEUE_SIZE || '100', 10))
  },

  DEFAULT_SETTINGS: {
    level1DurationMinutes: parseInt(process.env.LEVEL1_DURATION_MINUTES || '10', 10),
    level2DurationMinutes: parseInt(process.env.LEVEL2_DURATION_MINUTES || '20', 10),
    initialCredits: parseInt(process.env.INITIAL_CREDITS || '200', 10),
    round2MaxScore: parseInt(process.env.ROUND2_MAX_SCORE || '10', 10),
    round1CutoffScore: parseInt(process.env.ROUND1_CUTOFF_SCORE || '0', 10),
    resultsPublished: false,
    tieBreakerRule: 'default' as const,
    randomizeQuestionOrder: true
  },

  /**
   * Level 1 must expose this many active questions before Level 2 may auto-start.
   * Tests default to 0 so seed fixtures (fewer than 30) still exercise progression.
   */
  LEVEL1_REQUIRED_QUESTIONS: parseInt(
    process.env.LEVEL1_REQUIRED_QUESTIONS || (process.env.NODE_ENV === 'test' ? '0' : '30'),
    10
  ),
  
  BRANDING
};

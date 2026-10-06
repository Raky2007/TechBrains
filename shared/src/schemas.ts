import { z } from 'zod';

export const teamRegisterSchema = z.object({
  team_name: z
    .string()
    .trim()
    .min(2, 'Team name must be at least 2 characters')
    .max(50, 'Team name must be at most 50 characters')
    .regex(/^[a-zA-Z0-9 _-]+$/, 'Team name can only contain letters, numbers, spaces, underscores, and hyphens')
});

export const level1AnswerSchema = z.object({
  question_id: z.string().uuid('Invalid question ID format'),
  selected_answer: z.enum(['AI', 'HUMAN', 'CANT_DEFINE'])
});

export const level2UnlockClueSchema = z.object({
  clue_id: z.string().uuid('Invalid clue ID format'),
  operation_id: z.string().min(8).max(100).optional()
});

export const level2ReplaySchema = z.object({
  /** Client-generated idempotency key: one per deliberate replay action. */
  operation_id: z.string().min(8).max(100)
});

export const level2SubmitConclusionSchema = z.object({
  conclusion_text: z
    .string()
    .trim()
    .min(10, 'Conclusion must be at least 10 characters long')
    .max(10000, 'Conclusion cannot exceed 10,000 characters')
});

export const adminLoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required')
});

export const adminCreateQuestionSchema = z.object({
  title: z.string().trim().min(2, 'Title is required').max(100),
  prompt: z.string().trim().min(2, 'Prompt is required'),
  content_type: z.enum(['image', 'video', 'text']),
  media_path: z.string().nullable().optional(),
  correct_answer: z.enum(['AI', 'HUMAN', 'CANT_DEFINE']),
  explanation: z.string().trim().nullable().optional(),
  category: z.string().trim().nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
  is_active: z.number().int().min(0).max(1).default(1)
});

export const adminUpdateQuestionSchema = adminCreateQuestionSchema.partial();

export const adminCreateCaseSchema = z.object({
  title: z.string().trim().min(3, 'Title is required').max(120),
  situation_description: z.string().trim().min(10, 'Situation description is required'),
  media_path: z.string().nullable().optional(),
  initial_credits: z.number().int().min(0).default(200),
  rubric_json: z.string().optional(),
  // TechBrains Round 2 media lifecycle + AI evaluation configuration
  viewing_duration_seconds: z.number().int().min(0).max(3600).default(60),
  replay_cost: z.number().int().min(0).max(100000).default(20),
  reference_answer: z.string().trim().nullable().optional(),
  evaluation_guidance: z.string().trim().nullable().optional(),
  is_active: z.number().int().min(0).max(1).default(1)
});

export const adminUpdateCaseSchema = adminCreateCaseSchema.partial();

export const adminCaseMediaSchema = z.object({
  case_id: z.string().uuid(),
  media_type: z.enum(['image', 'video', 'audio']),
  media_path: z.string().min(1, 'Media path is required'),
  caption: z.string().trim().nullable().optional(),
  display_order: z.number().int().min(1).default(1)
});

// Clues are TEXT ONLY in TechBrains — no media_path accepted.
export const adminCreateClueSchema = z.object({
  case_id: z.string().uuid(),
  title: z.string().trim().min(2, 'Title is required').max(100),
  content: z.string().trim().min(2, 'Clue content is required'),
  credit_cost: z.number().int().min(0, 'Credit cost cannot be negative'),
  display_order: z.number().int().min(1).default(1),
  is_active: z.number().int().min(0).max(1).default(1)
});

export const adminUpdateClueSchema = z.object({
  title: z.string().trim().min(2).max(100).optional(),
  content: z.string().trim().min(2).optional(),
  credit_cost: z.number().int().min(0).optional(),
  display_order: z.number().int().min(1).optional(),
  is_active: z.number().int().min(0).max(1).optional()
});

// Legacy NEXUS manual rubric (retained until Phase 6 replaces the route).
export const adminEvaluateSchema = z.object({
  conclusion_id: z.string().uuid(),
  accuracy_score: z.number().min(0).max(10, 'Accuracy score must be between 0 and 10'),
  reasoning_score: z.number().min(0).max(5, 'Reasoning score must be between 0 and 5'),
  efficiency_score: z.number().min(0).max(5, 'Efficiency score must be between 0 and 5'),
  feedback: z.string().trim().nullable().optional()
});

// Manual override / manual evaluation of an AI-evaluated final answer.
export const adminEvaluationOverrideSchema = z.object({
  conclusion_id: z.string().uuid(),
  score: z.number().min(0),
  verdict: z.string().trim().min(1, 'Verdict is required').max(100),
  reasoning: z.string().trim().nullable().optional()
});

export const adminSettingsSchema = z.object({
  level1DurationMinutes: z.number().int().min(1).max(180),
  level2DurationMinutes: z.number().int().min(1).max(180),
  initialCredits: z.number().int().min(10).max(10000),
  round2MaxScore: z.number().min(1).max(1000),
  resultsPublished: z.boolean(),
  tieBreakerRule: z.enum(['default', 'l2_first', 'l1_accuracy', 'time_first']),
  randomizeQuestionOrder: z.boolean()
});

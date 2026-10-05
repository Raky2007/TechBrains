/**
 * Nexus Shared Types and Interfaces
 */

export type GameStatus = 
  | 'idle' 
  | 'level1_active' 
  | 'level1_paused' 
  | 'level1_ended' 
  | 'level2_active' 
  | 'level2_paused' 
  | 'level2_ended' 
  | 'completed';

export type RoundStatus = 'active' | 'paused' | 'ended';

export type Level1AnswerChoice = 'AI' | 'HUMAN' | 'CANT_DEFINE';

export type ContentType = 'image' | 'video' | 'text';

export type ConclusionStatus = 'draft' | 'submitted' | 'reopened';

export interface GameSettings {
  level1DurationMinutes: number;
  level2DurationMinutes: number;
  initialCredits: number;
  resultsPublished: boolean;
  tieBreakerRule: 'default' | 'l2_first' | 'l1_accuracy' | 'time_first';
  randomizeQuestionOrder: boolean;
}

export interface RubricConfig {
  maxAccuracy: number;    // default: 10
  maxReasoning: number;   // default: 5
  maxEfficiency: number;  // default: 5
  maxTotal: number;       // default: 20
}

export interface GameSession {
  id: string;
  name: string;
  status: GameStatus;
  current_level: 1 | 2 | null;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  game_session_id: string;
  team_name: string;
  access_token_hash: string;
  level1_score: number;
  level2_score: number;
  initial_credits: number;
  current_credits: number;
  created_at: string;
  updated_at: string;
}

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface Level1Question {
  id: string;
  title: string;
  prompt: string;
  content_type: ContentType;
  media_path: string | null;
  correct_answer: Level1AnswerChoice;
  explanation: string | null;
  category: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  is_active: number; // 1 or 0
  created_at: string;
  updated_at: string;
}

/**
 * Question payload sent to client (NEVER includes correct_answer or explanation)
 */
export interface ClientLevel1Question {
  id: string;
  title: string;
  prompt: string;
  content_type: ContentType;
  media_path: string | null;
  category: string | null;
  difficulty: string | null;
  question_order: number;
  total_questions: number;
  is_answered: boolean;
  selected_answer?: Level1AnswerChoice;
  awarded_points?: number;
}

export interface Round {
  id: string;
  game_session_id: string;
  level: 1 | 2;
  status: RoundStatus;
  started_at: string;
  deadline_at: string;
  paused_at: string | null;
  remaining_seconds: number | null;
  settings_snapshot_json: string;
  created_at: string;
  ended_at: string | null;
}

export interface TeamQuestionAssignment {
  id: string;
  round_id: string;
  team_id: string;
  question_id: string;
  question_order: number;
}

export interface TeamAnswer {
  id: string;
  round_id: string;
  team_id: string;
  question_id: string;
  selected_answer: Level1AnswerChoice;
  is_correct: number;
  awarded_points: number;
  submitted_at: string;
}

export interface Level2Case {
  id: string;
  title: string;
  situation_description: string;
  media_path: string | null;
  initial_credits: number;
  is_active: number;
  rubric_json: string;
  created_at: string;
  updated_at: string;
}

export interface Clue {
  id: string;
  case_id: string;
  title: string;
  content: string;
  media_path: string | null;
  credit_cost: number;
  display_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/**
 * Clue list item sent to team (content and media_path hidden if locked)
 */
export interface ClientClue {
  id: string;
  title: string;
  credit_cost: number;
  display_order: number;
  is_unlocked: boolean;
  content?: string;
  media_path?: string | null;
  unlocked_at?: string;
}

export interface ClueUnlock {
  id: string;
  round_id: string;
  team_id: string;
  clue_id: string;
  credits_spent: number;
  unlocked_at: string;
}

export interface CreditTransaction {
  id: string;
  round_id: string;
  team_id: string;
  clue_id: string | null;
  amount: number;
  transaction_type: 'initial_grant' | 'clue_unlock' | 'admin_adjustment';
  operation_id: string;
  created_at: string;
}

export interface Conclusion {
  id: string;
  round_id: string;
  team_id: string;
  conclusion_text: string;
  status: ConclusionStatus;
  submitted_at: string;
  updated_at: string;
}

export interface Evaluation {
  id: string;
  conclusion_id: string;
  accuracy_score: number;
  reasoning_score: number;
  efficiency_score: number;
  total_score: number;
  feedback: string | null;
  evaluator_id: string;
  evaluated_at: string;
}

export interface AuditLog {
  id: string;
  admin_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details_json: string | null;
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  team_id: string;
  team_name: string;
  level1_score: number;
  level1_answered: number;
  level1_accuracy_percent: number;
  level2_score: number;
  final_score: number;
  credits_spent: number;
  credits_remaining: number;
  conclusion_submitted: boolean;
  evaluation_completed: boolean;
  final_submission_time: string | null;
}

export interface PublicGameState {
  session_id: string;
  status: GameStatus;
  current_level: 1 | 2 | null;
  round: {
    id: string;
    level: 1 | 2;
    status: RoundStatus;
    deadline_at: string;
    remaining_seconds: number;
    is_paused: boolean;
  } | null;
  settings: GameSettings;
  server_time: string;
}

export interface TeamPrivateState {
  team: {
    id: string;
    team_name: string;
    current_credits: number;
    level1_score: number;
    level2_score: number;
  };
  level1?: {
    current_question: ClientLevel1Question | null;
    answered_count: number;
    total_assigned: number;
    is_completed: boolean;
  };
  level2?: {
    case: {
      id: string;
      title: string;
      situation_description: string;
      media_path: string | null;
      initial_credits: number;
    } | null;
    clues: ClientClue[];
    conclusion: {
      text: string;
      status: ConclusionStatus;
      submitted_at: string | null;
    } | null;
    evaluation?: {
      accuracy_score: number;
      reasoning_score: number;
      efficiency_score: number;
      total_score: number;
      feedback: string | null;
    } | null;
  };
}

export interface ServerAuthoritativeTimerState {
  round_id: string;
  level: 1 | 2;
  status: RoundStatus;
  server_time: string;
  deadline_at: string;
  remaining_seconds: number;
  is_paused: boolean;
}

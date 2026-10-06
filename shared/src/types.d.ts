/**
 * Nexus Shared Types and Interfaces
 */
export type GameStatus = 'idle' | 'level1_active' | 'level1_paused' | 'level1_ended' | 'level2_active' | 'level2_paused' | 'level2_ended' | 'completed';
export type RoundStatus = 'active' | 'paused' | 'ended';
export type Level1AnswerChoice = 'AI' | 'HUMAN' | 'CANT_DEFINE';
export type ContentType = 'image' | 'video' | 'text';
export type ConclusionStatus = 'draft' | 'submitted' | 'reopened';
export interface GameSettings {
    level1DurationMinutes: number;
    level2DurationMinutes: number;
    initialCredits: number;
    /** Explicit, consistent maximum for the Round 2 evaluation score (default 20). */
    round2MaxScore: number;
    resultsPublished: boolean;
    tieBreakerRule: 'default' | 'l2_first' | 'l1_accuracy' | 'time_first';
    randomizeQuestionOrder: boolean;
}
export type EvaluationStatus = 'pending' | 'completed' | 'failed';
export type EvaluationSource = 'ai' | 'manual';
export type CaseMediaType = 'image' | 'video' | 'audio';
export interface RubricConfig {
    maxAccuracy: number;
    maxReasoning: number;
    maxEfficiency: number;
    maxTotal: number;
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
    is_active: number;
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
    viewing_duration_seconds: number;
    replay_cost: number;
    reference_answer: string | null;
    evaluation_guidance: string | null;
    created_at: string;
    updated_at: string;
}
export interface CaseMedia {
    id: string;
    case_id: string;
    media_type: CaseMediaType;
    media_path: string;
    caption: string | null;
    display_order: number;
    created_at: string;
}
export interface MediaReplay {
    id: string;
    round_id: string;
    team_id: string;
    case_id: string;
    credits_spent: number;
    operation_id: string;
    created_at: string;
}
export interface CaseEvaluation {
    id: string;
    conclusion_id: string;
    status: EvaluationStatus;
    score: number | null;
    max_score: number;
    verdict: string | null;
    reasoning: string | null;
    provider: string | null;
    model: string | null;
    source: EvaluationSource;
    is_overridden: number;
    error_message: string | null;
    attempt_count: number;
    evaluator_id: string | null;
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
 * Clue list item sent to team. TechBrains clues are TEXT ONLY — content is
 * hidden until the clue is unlocked by the team.
 */
export interface ClientClue {
    id: string;
    title: string;
    credit_cost: number;
    display_order: number;
    is_unlocked: boolean;
    content?: string;
    unlocked_at?: string;
}
/**
 * Case media item sent to team (only delivered while media is viewable)
 */
export interface ClientCaseMedia {
    id: string;
    media_type: CaseMediaType;
    media_path: string;
    caption: string | null;
    display_order: number;
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
    transaction_type: 'initial_grant' | 'clue_unlock' | 'media_replay' | 'admin_adjustment';
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
            initial_credits: number;
        } | null;
        /** Server-authoritative media lifecycle for this team. */
        media: {
            /** Whether the case media is viewable by this team right now. */
            is_visible: boolean;
            /** True once the initial free viewing window has elapsed. */
            initial_window_elapsed: boolean;
            /** ISO timestamp when the current viewing window closes (null if hidden). */
            viewing_ends_at: string | null;
            viewing_duration_seconds: number;
            replay_cost: number;
            replay_count: number;
            /** Media assets, only populated while is_visible is true. */
            items: ClientCaseMedia[];
        };
        clues: ClientClue[];
        /** True once this team has made its one irreversible final submission. */
        is_locked: boolean;
        conclusion: {
            text: string;
            status: ConclusionStatus;
            submitted_at: string | null;
        } | null;
        /** TechBrains AI/manual evaluation (null until evaluated). */
        evaluation?: {
            status: EvaluationStatus;
            score: number | null;
            max_score: number;
            verdict: string | null;
            reasoning: string | null;
            is_overridden: boolean;
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

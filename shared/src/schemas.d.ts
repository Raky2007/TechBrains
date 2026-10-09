import { z } from 'zod';
export declare const teamRegisterSchema: z.ZodObject<{
    team_name: z.ZodString;
}, "strip", z.ZodTypeAny, {
    team_name: string;
}, {
    team_name: string;
}>;
export declare const level1AnswerSchema: z.ZodObject<{
    question_id: z.ZodString;
    selected_answer: z.ZodEnum<["AI", "HUMAN", "CANT_DEFINE"]>;
}, "strip", z.ZodTypeAny, {
    question_id: string;
    selected_answer: "AI" | "HUMAN" | "CANT_DEFINE";
}, {
    question_id: string;
    selected_answer: "AI" | "HUMAN" | "CANT_DEFINE";
}>;
export declare const level2UnlockClueSchema: z.ZodObject<{
    clue_id: z.ZodString;
    operation_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    clue_id: string;
    operation_id?: string | undefined;
}, {
    clue_id: string;
    operation_id?: string | undefined;
}>;
export declare const level2ReplaySchema: z.ZodObject<{
    /** Client-generated idempotency key: one per deliberate replay action. */
    operation_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    operation_id: string;
}, {
    operation_id: string;
}>;
export declare const level2SubmitConclusionSchema: z.ZodObject<{
    conclusion_text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    conclusion_text: string;
}, {
    conclusion_text: string;
}>;
export declare const adminLoginSchema: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    username: string;
    password: string;
}, {
    username: string;
    password: string;
}>;
export declare const adminCreateQuestionSchema: z.ZodObject<{
    title: z.ZodString;
    prompt: z.ZodOptional<z.ZodString>;
    content_type: z.ZodEnum<["image", "video", "text"]>;
    media_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    correct_answer: z.ZodEnum<["AI", "HUMAN", "CANT_DEFINE"]>;
    time_limit_seconds: z.ZodDefault<z.ZodNumber>;
    explanation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    difficulty: z.ZodOptional<z.ZodNullable<z.ZodEnum<["easy", "medium", "hard"]>>>;
    is_active: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    title: string;
    content_type: "image" | "video" | "text";
    correct_answer: "AI" | "HUMAN" | "CANT_DEFINE";
    time_limit_seconds: number;
    is_active: number;
    prompt?: string | undefined;
    media_path?: string | null | undefined;
    explanation?: string | null | undefined;
    category?: string | null | undefined;
    difficulty?: "easy" | "medium" | "hard" | null | undefined;
}, {
    title: string;
    content_type: "image" | "video" | "text";
    correct_answer: "AI" | "HUMAN" | "CANT_DEFINE";
    prompt?: string | undefined;
    media_path?: string | null | undefined;
    time_limit_seconds?: number | undefined;
    explanation?: string | null | undefined;
    category?: string | null | undefined;
    difficulty?: "easy" | "medium" | "hard" | null | undefined;
    is_active?: number | undefined;
}>;
export declare const adminUpdateQuestionSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    content_type: z.ZodOptional<z.ZodEnum<["image", "video", "text"]>>;
    media_path: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    correct_answer: z.ZodOptional<z.ZodEnum<["AI", "HUMAN", "CANT_DEFINE"]>>;
    time_limit_seconds: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    explanation: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    category: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    difficulty: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEnum<["easy", "medium", "hard"]>>>>;
    is_active: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    title?: string | undefined;
    prompt?: string | undefined;
    content_type?: "image" | "video" | "text" | undefined;
    media_path?: string | null | undefined;
    correct_answer?: "AI" | "HUMAN" | "CANT_DEFINE" | undefined;
    time_limit_seconds?: number | undefined;
    explanation?: string | null | undefined;
    category?: string | null | undefined;
    difficulty?: "easy" | "medium" | "hard" | null | undefined;
    is_active?: number | undefined;
}, {
    title?: string | undefined;
    prompt?: string | undefined;
    content_type?: "image" | "video" | "text" | undefined;
    media_path?: string | null | undefined;
    correct_answer?: "AI" | "HUMAN" | "CANT_DEFINE" | undefined;
    time_limit_seconds?: number | undefined;
    explanation?: string | null | undefined;
    category?: string | null | undefined;
    difficulty?: "easy" | "medium" | "hard" | null | undefined;
    is_active?: number | undefined;
}>;
export declare const adminCreateCaseSchema: z.ZodObject<{
    title: z.ZodString;
    situation_description: z.ZodString;
    media_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    initial_credits: z.ZodDefault<z.ZodNumber>;
    rubric_json: z.ZodOptional<z.ZodString>;
    viewing_duration_seconds: z.ZodDefault<z.ZodNumber>;
    replay_cost: z.ZodDefault<z.ZodNumber>;
    reference_answer: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    evaluation_guidance: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    is_active: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    title: string;
    is_active: number;
    situation_description: string;
    initial_credits: number;
    viewing_duration_seconds: number;
    replay_cost: number;
    media_path?: string | null | undefined;
    rubric_json?: string | undefined;
    reference_answer?: string | null | undefined;
    evaluation_guidance?: string | null | undefined;
}, {
    title: string;
    situation_description: string;
    media_path?: string | null | undefined;
    is_active?: number | undefined;
    initial_credits?: number | undefined;
    rubric_json?: string | undefined;
    viewing_duration_seconds?: number | undefined;
    replay_cost?: number | undefined;
    reference_answer?: string | null | undefined;
    evaluation_guidance?: string | null | undefined;
}>;
export declare const adminUpdateCaseSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    situation_description: z.ZodOptional<z.ZodString>;
    media_path: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    initial_credits: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    rubric_json: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    viewing_duration_seconds: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    replay_cost: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    reference_answer: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    evaluation_guidance: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    is_active: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    title?: string | undefined;
    media_path?: string | null | undefined;
    is_active?: number | undefined;
    situation_description?: string | undefined;
    initial_credits?: number | undefined;
    rubric_json?: string | undefined;
    viewing_duration_seconds?: number | undefined;
    replay_cost?: number | undefined;
    reference_answer?: string | null | undefined;
    evaluation_guidance?: string | null | undefined;
}, {
    title?: string | undefined;
    media_path?: string | null | undefined;
    is_active?: number | undefined;
    situation_description?: string | undefined;
    initial_credits?: number | undefined;
    rubric_json?: string | undefined;
    viewing_duration_seconds?: number | undefined;
    replay_cost?: number | undefined;
    reference_answer?: string | null | undefined;
    evaluation_guidance?: string | null | undefined;
}>;
export declare const adminCaseMediaSchema: z.ZodObject<{
    case_id: z.ZodString;
    media_type: z.ZodEnum<["image", "video", "audio"]>;
    media_path: z.ZodString;
    caption: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    display_order: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    media_path: string;
    case_id: string;
    media_type: "image" | "video" | "audio";
    display_order: number;
    caption?: string | null | undefined;
}, {
    media_path: string;
    case_id: string;
    media_type: "image" | "video" | "audio";
    caption?: string | null | undefined;
    display_order?: number | undefined;
}>;
export declare const adminCreateClueSchema: z.ZodObject<{
    case_id: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    credit_cost: z.ZodNumber;
    display_order: z.ZodDefault<z.ZodNumber>;
    is_active: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    title: string;
    is_active: number;
    case_id: string;
    display_order: number;
    content: string;
    credit_cost: number;
}, {
    title: string;
    case_id: string;
    content: string;
    credit_cost: number;
    is_active?: number | undefined;
    display_order?: number | undefined;
}>;
export declare const adminUpdateClueSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    content: z.ZodOptional<z.ZodString>;
    credit_cost: z.ZodOptional<z.ZodNumber>;
    display_order: z.ZodOptional<z.ZodNumber>;
    is_active: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    title?: string | undefined;
    is_active?: number | undefined;
    display_order?: number | undefined;
    content?: string | undefined;
    credit_cost?: number | undefined;
}, {
    title?: string | undefined;
    is_active?: number | undefined;
    display_order?: number | undefined;
    content?: string | undefined;
    credit_cost?: number | undefined;
}>;
export declare const adminEvaluateSchema: z.ZodObject<{
    conclusion_id: z.ZodString;
    accuracy_score: z.ZodNumber;
    reasoning_score: z.ZodNumber;
    efficiency_score: z.ZodNumber;
    feedback: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    conclusion_id: string;
    accuracy_score: number;
    reasoning_score: number;
    efficiency_score: number;
    feedback?: string | null | undefined;
}, {
    conclusion_id: string;
    accuracy_score: number;
    reasoning_score: number;
    efficiency_score: number;
    feedback?: string | null | undefined;
}>;
export declare const adminEvaluationOverrideSchema: z.ZodObject<{
    conclusion_id: z.ZodString;
    score: z.ZodNumber;
    verdict: z.ZodString;
    reasoning: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    conclusion_id: string;
    score: number;
    verdict: string;
    reasoning?: string | null | undefined;
}, {
    conclusion_id: string;
    score: number;
    verdict: string;
    reasoning?: string | null | undefined;
}>;
export declare const adminSettingsSchema: z.ZodObject<{
    level1DurationMinutes: z.ZodOptional<z.ZodNumber>;
    level2DurationMinutes: z.ZodNumber;
    initialCredits: z.ZodNumber;
    round2MaxScore: z.ZodNumber;
    round1CutoffScore: z.ZodDefault<z.ZodNumber>;
    resultsPublished: z.ZodBoolean;
    tieBreakerRule: z.ZodEnum<["default", "l2_first", "l1_accuracy", "time_first"]>;
    randomizeQuestionOrder: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    level2DurationMinutes: number;
    initialCredits: number;
    round2MaxScore: number;
    round1CutoffScore: number;
    resultsPublished: boolean;
    tieBreakerRule: "default" | "l2_first" | "l1_accuracy" | "time_first";
    randomizeQuestionOrder: boolean;
    level1DurationMinutes?: number | undefined;
}, {
    level2DurationMinutes: number;
    initialCredits: number;
    round2MaxScore: number;
    resultsPublished: boolean;
    tieBreakerRule: "default" | "l2_first" | "l1_accuracy" | "time_first";
    randomizeQuestionOrder: boolean;
    level1DurationMinutes?: number | undefined;
    round1CutoffScore?: number | undefined;
}>;
export declare const adminBanTeamSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason?: string | undefined;
}, {
    reason?: string | undefined;
}>;

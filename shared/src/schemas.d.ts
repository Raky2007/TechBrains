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
    prompt: z.ZodString;
    content_type: z.ZodEnum<["image", "video", "text"]>;
    media_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    correct_answer: z.ZodEnum<["AI", "HUMAN", "CANT_DEFINE"]>;
    explanation: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    difficulty: z.ZodOptional<z.ZodNullable<z.ZodEnum<["easy", "medium", "hard"]>>>;
    is_active: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    title: string;
    prompt: string;
    content_type: "image" | "video" | "text";
    correct_answer: "AI" | "HUMAN" | "CANT_DEFINE";
    is_active: number;
    media_path?: string | null | undefined;
    explanation?: string | null | undefined;
    category?: string | null | undefined;
    difficulty?: "easy" | "medium" | "hard" | null | undefined;
}, {
    title: string;
    prompt: string;
    content_type: "image" | "video" | "text";
    correct_answer: "AI" | "HUMAN" | "CANT_DEFINE";
    media_path?: string | null | undefined;
    explanation?: string | null | undefined;
    category?: string | null | undefined;
    difficulty?: "easy" | "medium" | "hard" | null | undefined;
    is_active?: number | undefined;
}>;
export declare const adminUpdateQuestionSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodString>;
    content_type: z.ZodOptional<z.ZodEnum<["image", "video", "text"]>>;
    media_path: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    correct_answer: z.ZodOptional<z.ZodEnum<["AI", "HUMAN", "CANT_DEFINE"]>>;
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
    is_active: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    title: string;
    is_active: number;
    situation_description: string;
    initial_credits: number;
    media_path?: string | null | undefined;
    rubric_json?: string | undefined;
}, {
    title: string;
    situation_description: string;
    media_path?: string | null | undefined;
    is_active?: number | undefined;
    initial_credits?: number | undefined;
    rubric_json?: string | undefined;
}>;
export declare const adminCreateClueSchema: z.ZodObject<{
    case_id: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    media_path: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    credit_cost: z.ZodNumber;
    display_order: z.ZodDefault<z.ZodNumber>;
    is_active: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    title: string;
    is_active: number;
    case_id: string;
    content: string;
    credit_cost: number;
    display_order: number;
    media_path?: string | null | undefined;
}, {
    title: string;
    case_id: string;
    content: string;
    credit_cost: number;
    media_path?: string | null | undefined;
    is_active?: number | undefined;
    display_order?: number | undefined;
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
export declare const adminSettingsSchema: z.ZodObject<{
    level1DurationMinutes: z.ZodNumber;
    level2DurationMinutes: z.ZodNumber;
    initialCredits: z.ZodNumber;
    resultsPublished: z.ZodBoolean;
    tieBreakerRule: z.ZodEnum<["default", "l2_first", "l1_accuracy", "time_first"]>;
    randomizeQuestionOrder: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    level1DurationMinutes: number;
    level2DurationMinutes: number;
    initialCredits: number;
    resultsPublished: boolean;
    tieBreakerRule: "default" | "l2_first" | "l1_accuracy" | "time_first";
    randomizeQuestionOrder: boolean;
}, {
    level1DurationMinutes: number;
    level2DurationMinutes: number;
    initialCredits: number;
    resultsPublished: boolean;
    tieBreakerRule: "default" | "l2_first" | "l1_accuracy" | "time_first";
    randomizeQuestionOrder: boolean;
}>;

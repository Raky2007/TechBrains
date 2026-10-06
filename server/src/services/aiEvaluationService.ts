import { CONFIG } from '../config.js';

/**
 * Provider-independent AI evaluation service for the TechBrains Round 2 final
 * answer. The concrete provider is selected purely by configuration
 * (CONFIG.AI.PROVIDER) so no provider is hard-coded into the game architecture
 * and API keys never leave the server.
 */

export interface EvaluationInput {
  caseTitle: string;
  caseSituation: string;
  referenceAnswer: string | null;
  evaluationGuidance: string | null;
  teamAnswer: string;
  maxScore: number;
}

export interface EvaluationResult {
  score: number;      // clamped to [0, maxScore]
  verdict: string;    // short label, e.g. "Strong", "Partial", "Incorrect"
  reasoning: string;  // human-readable explanation
  provider: string;
  model: string | null;
}

/** Thrown when evaluation cannot be produced; caller records a 'failed' state. */
export class AIEvaluationError extends Error {
  constructor(message: string, public readonly code: string = 'AI_ERROR') {
    super(message);
    this.name = 'AIEvaluationError';
  }
}

export function isAiConfigured(): boolean {
  const p = CONFIG.AI.PROVIDER;
  if (p === 'none' || !p) return false;
  if (p === 'mock') return true;
  return !!CONFIG.AI.API_KEY; // hosted providers require a key
}

function clampScore(raw: unknown, maxScore: number): number {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) throw new AIEvaluationError('Model returned a non-numeric score', 'INVALID_OUTPUT');
  return Math.max(0, Math.min(maxScore, Math.round(n * 100) / 100));
}

/**
 * Extract the first JSON object from arbitrary model text and normalize it into
 * an EvaluationResult. Throws AIEvaluationError on malformed/invalid output.
 */
function normalizeModelJson(text: string, maxScore: number, provider: string, model: string | null): EvaluationResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new AIEvaluationError('Model response contained no JSON object', 'MALFORMED');
  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new AIEvaluationError('Model response was not valid JSON', 'MALFORMED');
  }
  if (parsed == null || typeof parsed !== 'object') {
    throw new AIEvaluationError('Model response JSON was not an object', 'INVALID_OUTPUT');
  }
  const score = clampScore(parsed.score, maxScore);
  const verdict = String(parsed.verdict ?? '').trim().slice(0, 100) || 'Evaluated';
  const reasoning = String(parsed.reasoning ?? parsed.explanation ?? '').trim() || 'No reasoning provided.';
  return { score, verdict, reasoning, provider, model };
}

function buildPrompt(input: EvaluationInput): string {
  return [
    'You are an impartial judge for a technical college competition ("TechBrains").',
    'Evaluate the TEAM ANSWER to an investigation case against the reference answer and guidance.',
    '',
    `CASE TITLE: ${input.caseTitle}`,
    '',
    'CASE SITUATION:',
    input.caseSituation,
    '',
    'REFERENCE / EXPECTED ANSWER:',
    input.referenceAnswer || '(none provided)',
    '',
    'EVALUATION GUIDANCE:',
    input.evaluationGuidance || '(none provided)',
    '',
    'TEAM ANSWER:',
    input.teamAnswer,
    '',
    `Score the team answer from 0 to ${input.maxScore} based on correctness, key points, and reasoning quality.`,
    'Respond with ONLY a JSON object of the form:',
    `{"score": <number 0-${input.maxScore}>, "verdict": "<short label>", "reasoning": "<2-4 sentence explanation>"}`
  ].join('\n');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new AIEvaluationError('AI provider request timed out', 'TIMEOUT');
    throw new AIEvaluationError(`AI provider request failed: ${err?.message || err}`, 'PROVIDER_FAILURE');
  } finally {
    clearTimeout(timer);
  }
}

// ---- Providers ----------------------------------------------------------

function mockEvaluate(input: EvaluationInput): EvaluationResult {
  // Deterministic offline heuristic: keyword overlap with the reference answer.
  const reference = (input.referenceAnswer || input.caseSituation || '').toLowerCase();
  const answer = input.teamAnswer.toLowerCase();
  const refTerms = Array.from(
    new Set(reference.split(/[^a-z0-9]+/).filter((w) => w.length >= 5))
  );
  if (refTerms.length === 0) {
    return { score: Math.round(input.maxScore / 2), verdict: 'Indeterminate', reasoning: 'No reference answer configured; assigned a neutral baseline score.', provider: 'mock', model: null };
  }
  const matched = refTerms.filter((t) => answer.includes(t));
  const ratio = matched.length / refTerms.length;
  const score = Math.max(0, Math.min(input.maxScore, Math.round(ratio * input.maxScore * 100) / 100));
  const verdict = ratio >= 0.66 ? 'Strong' : ratio >= 0.33 ? 'Partial' : 'Weak';
  return {
    score,
    verdict,
    reasoning: `Heuristic match of ${matched.length}/${refTerms.length} key reference terms (${Math.round(ratio * 100)}%). This is an offline mock evaluation; an administrator should review.`,
    provider: 'mock',
    model: null
  };
}

async function anthropicEvaluate(input: EvaluationInput): Promise<EvaluationResult> {
  const base = CONFIG.AI.BASE_URL || 'https://api.anthropic.com';
  const res = await fetchWithTimeout(
    `${base}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': CONFIG.AI.API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CONFIG.AI.MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildPrompt(input) }]
      })
    },
    CONFIG.AI.TIMEOUT_MS
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AIEvaluationError(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`, 'PROVIDER_FAILURE');
  }
  const data: any = await res.json().catch(() => { throw new AIEvaluationError('Anthropic response was not JSON', 'MALFORMED'); });
  const text = Array.isArray(data?.content) ? data.content.map((c: any) => c?.text || '').join('') : '';
  if (!text) throw new AIEvaluationError('Anthropic response contained no text', 'MALFORMED');
  return normalizeModelJson(text, input.maxScore, 'anthropic', CONFIG.AI.MODEL);
}

async function openaiEvaluate(input: EvaluationInput): Promise<EvaluationResult> {
  const base = CONFIG.AI.BASE_URL || 'https://api.openai.com';
  const res = await fetchWithTimeout(
    `${base}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${CONFIG.AI.API_KEY}`
      },
      body: JSON.stringify({
        model: CONFIG.AI.MODEL,
        messages: [{ role: 'user', content: buildPrompt(input) }],
        response_format: { type: 'json_object' }
      })
    },
    CONFIG.AI.TIMEOUT_MS
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AIEvaluationError(`OpenAI API error ${res.status}: ${body.slice(0, 200)}`, 'PROVIDER_FAILURE');
  }
  const data: any = await res.json().catch(() => { throw new AIEvaluationError('OpenAI response was not JSON', 'MALFORMED'); });
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new AIEvaluationError('OpenAI response contained no content', 'MALFORMED');
  return normalizeModelJson(text, input.maxScore, 'openai', CONFIG.AI.MODEL);
}

async function evaluateOnce(input: EvaluationInput): Promise<EvaluationResult> {
  switch (CONFIG.AI.PROVIDER) {
    case 'mock':
      return mockEvaluate(input);
    case 'anthropic':
      return anthropicEvaluate(input);
    case 'openai':
      return openaiEvaluate(input);
    case 'none':
    case '':
      throw new AIEvaluationError('AI evaluation is not configured (AI_PROVIDER=none).', 'NOT_CONFIGURED');
    default:
      throw new AIEvaluationError(`Unknown AI_PROVIDER "${CONFIG.AI.PROVIDER}".`, 'NOT_CONFIGURED');
  }
}

/**
 * Evaluate a case answer, retrying transient provider/timeout failures up to
 * CONFIG.AI.MAX_RETRIES times. NOT_CONFIGURED / INVALID_OUTPUT are not retried.
 */
export async function evaluateCaseAnswer(input: EvaluationInput): Promise<EvaluationResult> {
  let lastErr: unknown;
  const attempts = Math.max(1, 1 + CONFIG.AI.MAX_RETRIES);
  for (let i = 0; i < attempts; i++) {
    try {
      return await evaluateOnce(input);
    } catch (err) {
      lastErr = err;
      const code = err instanceof AIEvaluationError ? err.code : 'AI_ERROR';
      // Do not retry deterministic failures.
      if (code === 'NOT_CONFIGURED' || code === 'INVALID_OUTPUT' || CONFIG.AI.PROVIDER === 'mock') break;
    }
  }
  if (lastErr instanceof AIEvaluationError) throw lastErr;
  throw new AIEvaluationError(`AI evaluation failed: ${(lastErr as any)?.message || lastErr}`, 'AI_ERROR');
}

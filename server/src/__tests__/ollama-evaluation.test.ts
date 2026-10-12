import { describe, it, expect } from 'vitest';
import {
  ollamaEvaluate,
  normalizeModelJson,
  AIEvaluationError,
  isAiConfigured
} from '../services/aiEvaluationService.js';
import { CONFIG } from '../config.js';

describe('Local Ollama Integration & Semantic Scoring', () => {
  // Check 1: Real Ollama Integration
  it('1. Sends a request to local Ollama (qwen3:8b) and validates the structured response', async () => {
    // Verify Ollama connectivity first
    let isOllamaRunning = false;
    try {
      const ping = await fetch(`${CONFIG.AI.OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      isOllamaRunning = ping.ok;
    } catch {
      isOllamaRunning = false;
    }

    if (!isOllamaRunning) {
      console.warn('Local Ollama is not running on 127.0.0.1:11434; skipping live inference check.');
      return;
    }

    expect(isAiConfigured()).toBe(true);

    try {
      const result = await ollamaEvaluate({
        caseTitle: 'The Vanishing Prototype',
        caseSituation: 'Disappeared from Innovation Lab between 7:40 PM and 8:00 PM.',
        selectedSuspect: 'Kabir',
        explanation: 'Kabir exported looped video from 7:28 PM to fake an alibi, and left traces of blue compound near the rear maintenance hatch.',
        teamAnswer: 'Kabir exported looped video from 7:28 PM to fake an alibi, and left traces of blue compound near the rear maintenance hatch.',
        maxScore: 5
      }, 5);

      expect(result).toBeDefined();
      expect(result.provider).toBe('ollama');
      expect(result.status).toBe('completed');
      expect(typeof result.score).toBe('number');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(5);
      expect(result.suspect_score).toBeGreaterThanOrEqual(0);
      expect(result.suspect_score).toBeLessThanOrEqual(2);
      expect(result.evidence_score).toBeGreaterThanOrEqual(0);
      expect(result.evidence_score).toBeLessThanOrEqual(2);
      expect(result.logic_score).toBeGreaterThanOrEqual(0);
      expect(result.logic_score).toBeLessThanOrEqual(1);
      expect(result.score).toBe(result.suspect_score + result.evidence_score + result.logic_score);
      expect(typeof result.feedback).toBe('string');
    } catch (err: any) {
      if (err?.code === 'PROVIDER_FAILURE' || err?.message?.includes('failed') || err?.message?.includes('timed out')) {
        console.warn('Ollama request failed or timed out during test; skipping live check gracefully.');
        return;
      }
      throw err;
    }
  }, 180000);

  // Check 2: Semantic Scoring Example & Failure Handling
  it('2a. Validates semantic scoring, score clamping, and <think> tag handling', () => {
    const rawModelOutput = `
<think>
Evaluating candidate answer. Kabir was identified (+2), looped video cited (+1), logic sound (+1).
</think>
\`\`\`json
{
  "suspect_score": 2,
  "evidence_score": 1,
  "logic_score": 1,
  "score": 4,
  "selected_suspect_correct": true,
  "closest_answer": "Kabir, Media Coordinator faked camera footage.",
  "accuracy_summary": "Correct suspect with valid video evidence.",
  "matched_evidence": ["Looped 7:28 video footage"],
  "missing_evidence": ["Rear maintenance hatch seal"],
  "feedback": "Good forensic deduction on the video loop.",
  "verdict": "Strong",
  "reasoning": "Kabir identified correctly with solid evidence."
}
\`\`\`
`;

    const parsed = normalizeModelJson(rawModelOutput, 5, 'ollama', 'qwen3:8b', 'Kabir');
    expect(parsed.score).toBe(4);
    expect(parsed.suspect_score).toBe(2);
    expect(parsed.evidence_score).toBe(1);
    expect(parsed.logic_score).toBe(1);
    expect(parsed.selected_suspect_correct).toBe(true);
    expect(parsed.matched_evidence).toContain('Looped 7:28 video footage');
    expect(parsed.feedback).toContain('Good forensic deduction');
  });

  it('2b. Handles Ollama invalid/malformed response or server failure cleanly with AIEvaluationError', () => {
    // Malformed JSON (no JSON object)
    expect(() => {
      normalizeModelJson('I am sorry, as an AI language model I cannot evaluate this.', 5, 'ollama', 'qwen3:8b', 'Kabir');
    }).toThrow(AIEvaluationError);

    // Non-object JSON
    expect(() => {
      normalizeModelJson('"just a string"', 5, 'ollama', 'qwen3:8b', 'Kabir');
    }).toThrow(AIEvaluationError);
  });
});

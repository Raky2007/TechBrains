import { Level1AnswerChoice, Level1Question, LeaderboardEntry, GameSettings } from '@nexus/shared';
import { getDb } from '../database/db.js';

export interface ScoreResult {
  isCorrect: boolean;
  awardedPoints: number;
}

/**
 * Authoritative TechBrains scoring rule for Round 1 (AI or Human):
 * - Correct AI / Human:  +1
 * - Wrong AI / Human:    -1
 * - Can't Determine:      0 (never penalised, never rewarded)
 * - Timeout / no answer:  0 (no team_answers row is ever created)
 *
 * This is deliberately different from the legacy NEXUS rule (which awarded 0
 * for a wrong answer). Per the TechBrains specification, an explicit negative
 * penalty discourages guessing on AI/Human.
 */
export function calculateLevel1Score(
  selectedAnswer: Level1AnswerChoice,
  question: Level1Question
): ScoreResult {
  // "Can't Determine" is always a safe, neutral choice.
  if (selectedAnswer === 'CANT_DEFINE') {
    return {
      isCorrect: question.correct_answer === 'CANT_DEFINE',
      awardedPoints: 0
    };
  }

  const isCorrect = selectedAnswer === question.correct_answer;
  const awardedPoints = isCorrect ? 1 : -1;

  return {
    isCorrect,
    awardedPoints
  };
}

/**
 * Calculate Leaderboard with default tie-breakers:
 * 1. Final Score DESC (L1 + L2)
 * 2. Higher Level 2 Score DESC
 * 3. Higher Level 1 Accuracy % DESC
 * 4. Earlier Final Submission Time ASC
 * Equal ranks for true ties.
 */
export function calculateAuthoritativeLeaderboard(
  sessionId: string,
  settings: GameSettings
): LeaderboardEntry[] {
  const db = getDb();

  // Query teams with completed stats
  const teams = db.prepare(`
    SELECT 
      t.id as team_id,
      t.team_name,
      t.level1_score,
      t.level2_score,
      t.initial_credits,
      t.current_credits,
      c.status as conclusion_status,
      c.submitted_at as conclusion_submitted_at,
      e.id as evaluation_id,
      (SELECT COUNT(*) FROM team_answers ta WHERE ta.team_id = t.id) as level1_answered,
      (SELECT COUNT(*) FROM team_answers ta WHERE ta.team_id = t.id AND ta.is_correct = 1) as level1_correct_count,
      (SELECT COALESCE(SUM(cu.credits_spent), 0) FROM clue_unlocks cu WHERE cu.team_id = t.id) as credits_spent
    FROM teams t
    LEFT JOIN conclusions c ON c.team_id = t.id AND c.status = 'submitted'
    LEFT JOIN evaluations e ON e.conclusion_id = c.id
    WHERE t.game_session_id = ?
  `).all(sessionId) as any[];

  const entries: LeaderboardEntry[] = teams.map((t) => {
    const finalScore = Number((t.level1_score + t.level2_score).toFixed(2));
    const accuracy = t.level1_answered > 0 ? (t.level1_correct_count / t.level1_answered) * 100 : 0;

    return {
      rank: 0, // Assigned below
      team_id: t.team_id,
      team_name: t.team_name,
      level1_score: t.level1_score,
      level1_answered: t.level1_answered,
      level1_accuracy_percent: Math.round(accuracy * 10) / 10,
      level2_score: Number(t.level2_score.toFixed(2)),
      final_score: finalScore,
      credits_spent: t.credits_spent,
      credits_remaining: t.current_credits,
      conclusion_submitted: t.conclusion_status === 'submitted',
      evaluation_completed: !!t.evaluation_id,
      final_submission_time: t.conclusion_submitted_at || null
    };
  });

  // Sort by tie-breakers
  entries.sort((a, b) => {
    // 1. Primary: Final Score DESC
    if (b.final_score !== a.final_score) {
      return b.final_score - a.final_score;
    }

    // 2. Higher Level 2 Score DESC
    if (b.level2_score !== a.level2_score) {
      return b.level2_score - a.level2_score;
    }

    // 3. Higher Level 1 Accuracy % DESC
    if (b.level1_accuracy_percent !== a.level1_accuracy_percent) {
      return b.level1_accuracy_percent - a.level1_accuracy_percent;
    }

    // 4. Earlier Final Submission Time ASC
    if (a.final_submission_time && b.final_submission_time) {
      return new Date(a.final_submission_time).getTime() - new Date(b.final_submission_time).getTime();
    }
    if (a.final_submission_time && !b.final_submission_time) return -1;
    if (!a.final_submission_time && b.final_submission_time) return 1;

    // 5. Alphabetical fallback
    return a.team_name.localeCompare(b.team_name);
  });

  // Assign ranks (handle ties with equal ranks)
  let currentRank = 1;
  for (let i = 0; i < entries.length; i++) {
    if (i > 0) {
      const prev = entries[i - 1];
      const curr = entries[i];
      const isExactTie =
        prev.final_score === curr.final_score &&
        prev.level2_score === curr.level2_score &&
        prev.level1_accuracy_percent === curr.level1_accuracy_percent &&
        prev.final_submission_time === curr.final_submission_time;

      if (!isExactTie) {
        currentRank = i + 1;
      }
    }
    entries[i].rank = currentRank;
  }

  return entries;
}

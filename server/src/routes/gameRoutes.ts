import { Router, Request, Response } from 'express';
import { GameService } from '../services/gameService.js';
import { requireTeamAuth, getAdminTokenFromRequest, verifyAdminToken } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  level1AnswerSchema,
  level2UnlockClueSchema,
  level2ReplaySchema,
  level2SubmitConclusionSchema
} from '@nexus/shared';
import { emitToAdmin, emitToTeam, broadcastGameState, broadcastRoundEvent } from '../sockets/socketHandler.js';

const router = Router();

/**
 * Public authoritative game state (accessible by any LAN client)
 * Route: GET /api/game/state
 */
router.get('/state', (_req: Request, res: Response): void => {
  try {
    const state = GameService.getPublicGameState();
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve game state.' });
  }
});

/**
 * Team private progress and state (Level 1 questions, Level 2 clues & credits)
 * Route: GET /api/game/team-state
 */
router.get('/team-state', requireTeamAuth, (req: Request, res: Response): void => {
  try {
    const teamState = GameService.getTeamPrivateState(req.team!.id);
    res.json(teamState);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load team game state.' });
  }
});

// NOTE: The participant "start-level" route has been removed. Global round
// transitions (start/pause/resume/end/complete) are admin-only and live under
// /api/admin/controls. Participants react to server-controlled state only.

/**
 * Submit Level 1 Answer
 * Route: POST /api/game/level1/answer
 */
router.post('/level1/answer', requireTeamAuth, rateLimiter(5000, 30, 'Submitting too rapidly'), (req: Request, res: Response): void => {
  try {
    const parseResult = level1AnswerSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid answer payload.' });
      return;
    }

    const { question_id, selected_answer } = parseResult.data;
    const result = GameService.submitLevel1Answer(req.team!.id, question_id, selected_answer);

    // Notify admin dashboard in real-time
    emitToAdmin('team:score_updated', {
      team_id: req.team!.id,
      team_name: req.team!.team_name,
      new_score: result.new_team_score,
      level: 1
    });

    res.json({
      success: true,
      is_correct: result.is_correct,
      awarded_points: result.awarded_points,
      explanation: result.explanation,
      // Correct answer is revealed ONLY in this direct response to the team's
      // own accepted submission (never before submission, never to other teams).
      correct_answer: result.correct_answer,
      new_team_score: result.new_team_score
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to submit answer.' });
  }
});

/**
 * Unlock Level 2 Clue
 * Route: POST /api/game/level2/unlock-clue
 */
router.post('/level2/unlock-clue', requireTeamAuth, rateLimiter(5000, 20, 'Purchasing too rapidly'), (req: Request, res: Response): void => {
  try {
    const parseResult = level2UnlockClueSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid clue unlock request.' });
      return;
    }

    const { clue_id, operation_id } = parseResult.data;
    const result = GameService.unlockLevel2Clue(req.team!.id, clue_id, operation_id);

    // Broadcast credit update to admin
    emitToAdmin('team:credits_updated', {
      team_id: req.team!.id,
      team_name: req.team!.team_name,
      credits_spent: result.credits_spent,
      remaining_credits: result.remaining_credits
    });

    // Push fresh private state to the team's own devices (multi-device sync).
    emitToTeam(req.team!.id, 'team:private_updated', GameService.getTeamPrivateState(req.team!.id));

    res.json({
      success: true,
      clue: {
        id: result.clue.id,
        title: result.clue.title,
        content: result.clue.content,
        credit_cost: result.clue.credit_cost,
        display_order: result.clue.display_order,
        is_unlocked: true
      },
      credits_spent: result.credits_spent,
      remaining_credits: result.remaining_credits,
      already_unlocked: result.already_unlocked
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to unlock clue.' });
  }
});

/**
 * Replay Level 2 case media for credits (TechBrains)
 * Route: POST /api/game/level2/replay
 */
router.post('/level2/replay', requireTeamAuth, rateLimiter(5000, 20, 'Replaying too rapidly'), (req: Request, res: Response): void => {
  try {
    const parseResult = level2ReplaySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid replay request.' });
      return;
    }

    const result = GameService.replayCaseMedia(req.team!.id, parseResult.data.operation_id);

    // Notify admin dashboard of credit movement + replay activity.
    if (result.credits_spent > 0) {
      emitToAdmin('team:credits_updated', {
        team_id: req.team!.id,
        team_name: req.team!.team_name,
        credits_spent: result.credits_spent,
        remaining_credits: result.remaining_credits
      });
      emitToAdmin('team:replay', {
        team_id: req.team!.id,
        team_name: req.team!.team_name,
        replay_count: result.replay_count
      });
    }

    // Push fresh private state to the team's own devices (multi-device sync).
    emitToTeam(req.team!.id, 'team:private_updated', GameService.getTeamPrivateState(req.team!.id));

    res.json({
      success: true,
      credits_spent: result.credits_spent,
      remaining_credits: result.remaining_credits,
      replay_count: result.replay_count,
      viewing_ends_at: result.viewing_ends_at,
      already_charged: result.already_charged,
      already_visible: result.already_visible
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to replay case media.' });
  }
});

/**
 * Submit Level 2 Final Conclusion
 * Route: POST /api/game/level2/conclusion
 */
router.post('/level2/conclusion', requireTeamAuth, (req: Request, res: Response): void => {
  try {
    const parseResult = level2SubmitConclusionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid conclusion format.' });
      return;
    }

    const { conclusion_text } = parseResult.data;
    const conclusion = GameService.submitConclusion(req.team!.id, conclusion_text);

    // Alert admin of new submission ready for evaluation
    emitToAdmin('submission:created', {
      conclusion_id: conclusion.id,
      team_id: req.team!.id,
      team_name: req.team!.team_name,
      submitted_at: conclusion.submitted_at
    });

    // Trigger automatic AI evaluation (non-blocking; only if a provider is set).
    GameService.autoEvaluate(conclusion.id);

    // Push fresh locked private state to the team's own devices.
    emitToTeam(req.team!.id, 'team:private_updated', GameService.getTeamPrivateState(req.team!.id));

    res.json({
      success: true,
      message: 'Conclusion submitted for forensic evaluation.',
      conclusion: {
        id: conclusion.id,
        status: conclusion.status,
        submitted_at: conclusion.submitted_at
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to submit conclusion.' });
  }
});

/**
 * Full ranked leaderboard / global standings.
 *
 * ADMIN ONLY. Participants must never receive other teams' scores, rankings,
 * or global standings — not via the frontend and not by calling this API
 * directly. A participant (or anonymous) request is rejected with 403; teams
 * read only their own result via GET /api/game/my-result below.
 * Route: GET /api/game/leaderboard
 */
router.get('/leaderboard', (req: Request, res: Response): void => {
  try {
    // Never trust mere cookie presence — require a verified admin signature.
    const isVerifiedAdmin = !!verifyAdminToken(getAdminTokenFromRequest(req));
    if (!isVerifiedAdmin) {
      res.status(403).json({ error: 'The global leaderboard is restricted to event administrators.' });
      return;
    }

    const leaderboard = GameService.getLeaderboard();
    res.json({ is_published: true, leaderboard });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve leaderboard.' });
  }
});

/**
 * A team's OWN result only (never other teams' scores or standings).
 *
 * Returns the requesting team's own score/status once results are published by
 * the admin. Enforced server-side: requires team auth, scopes strictly to
 * req.team.id, and strips any competitive ranking.
 * Route: GET /api/game/my-result
 */
router.get('/my-result', requireTeamAuth, (req: Request, res: Response): void => {
  try {
    const { settings } = GameService.getGameSession();

    if (!settings.resultsPublished) {
      res.json({
        is_published: false,
        message: 'Final results have not been published by event officials yet.',
        result: null
      });
      return;
    }

    const result = GameService.getTeamResult(req.team!.id);
    res.json({ is_published: true, result });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve your result.' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { GameService } from '../services/gameService.js';
import { requireTeamAuth } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';
import {
  level1AnswerSchema,
  level2UnlockClueSchema,
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

/**
 * Start level directly from participant UI without requiring admin intervention
 * Route: POST /api/game/start-level
 */
router.post('/start-level', requireTeamAuth, (req: Request, res: Response): void => {
  try {
    const level = req.body.level === 2 ? 2 : 1;
    const result = GameService.participantStartLevel(req.team!.id, level);
    broadcastRoundEvent('round:started', { level, round: result.round });
    res.json({ success: true, round: result.round, session: result.session });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to start round.' });
  }
});

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

    res.json({
      success: true,
      clue: {
        id: result.clue.id,
        title: result.clue.title,
        content: result.clue.content,
        media_path: result.clue.media_path,
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
 * Public or participant leaderboard endpoint
 * Route: GET /api/game/leaderboard
 */
router.get('/leaderboard', (req: Request, res: Response): void => {
  try {
    const { settings } = GameService.getGameSession();
    // Allow viewing if published or if admin cookie is present
    const hasAdminCookie = !!req.cookies?.nexus_admin_token;

    if (!settings.resultsPublished && !hasAdminCookie) {
      res.json({
        is_published: false,
        message: 'Final results have not been published by event officials yet.',
        leaderboard: []
      });
      return;
    }

    const leaderboard = GameService.getLeaderboard();
    res.json({
      is_published: true,
      leaderboard
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve leaderboard.' });
  }
});

export default router;

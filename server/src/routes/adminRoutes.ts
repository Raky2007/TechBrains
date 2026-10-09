import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAdminAuth } from '../middleware/auth.js';
import { uploadMedia } from '../middleware/upload.js';
import { GameService } from '../services/gameService.js';
import { getDb } from '../database/db.js';
import { logAuditAction } from '../services/auditService.js';
import {
  broadcastRoundEvent,
  broadcastGameState,
  broadcastLeaderboard,
  getAllTeamsPresence,
  emitToTeam,
  banAndDisconnectTeam
} from '../sockets/socketHandler.js';
import {
  adminCreateQuestionSchema,
  adminUpdateQuestionSchema,
  adminCreateCaseSchema,
  adminUpdateCaseSchema,
  adminCaseMediaSchema,
  adminCreateClueSchema,
  adminUpdateClueSchema,
  adminEvaluationOverrideSchema,
  adminSettingsSchema,
  adminBanTeamSchema
} from '@nexus/shared';

const router = Router();

// Apply admin authentication to all routes in this file
router.use(requireAdminAuth);

/**
 * Overview statistics
 * Route: GET /api/admin/overview
 */
router.get('/overview', (req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { session, settings, activeRound } = GameService.getGameSession();

    const registeredTeamsCount = (db.prepare('SELECT COUNT(*) as count FROM teams WHERE game_session_id = ?').get(session.id) as any).count;
    const l1QuestionsCount = (db.prepare('SELECT COUNT(*) as count FROM level1_questions WHERE is_active = 1').get() as any).count;
    const l2CluesCount = (db.prepare('SELECT COUNT(*) as count FROM clues WHERE is_active = 1').get() as any).count;
    
    const pendingSubmissionsCount = (db.prepare(`
      SELECT COUNT(*) as count 
      FROM conclusions c
      LEFT JOIN evaluations e ON e.conclusion_id = c.id
      WHERE c.status = 'submitted' AND e.id IS NULL
    `).get() as any).count;

    const recentEvents = db.prepare(`
      SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 15
    `).all();

    res.json({
      session,
      settings,
      active_round: activeRound,
      stats: {
        registered_teams: registeredTeamsCount,
        level1_questions: l1QuestionsCount,
        level2_clues: l2CluesCount,
        pending_evaluations: pendingSubmissionsCount
      },
      recent_events: recentEvents
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load overview data.' });
  }
});

/**
 * Live Game Controls
 * Route: POST /api/admin/controls
 */
router.post('/controls', (req: Request, res: Response): void => {
  try {
    const { action, level } = req.body;
    const adminId = req.adminUser!.id;

    switch (action) {
      case 'start': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.startRound(adminId, level);
        broadcastRoundEvent('round:started', { level, round: result.round });
        res.json({ success: true, message: `Level ${level} started.`, round: result.round });
        break;
      }
      case 'pause': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.pauseRound(adminId, level);
        broadcastRoundEvent('round:paused', { level, round: result.round });
        res.json({ success: true, message: `Level ${level} paused.`, round: result.round });
        break;
      }
      case 'resume': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.resumeRound(adminId, level);
        broadcastRoundEvent('round:resumed', { level, round: result.round });
        res.json({ success: true, message: `Level ${level} resumed.`, round: result.round });
        break;
      }
      case 'end': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.endRound(adminId, level);
        broadcastRoundEvent('round:ended', { level, round: result.round });
        res.json({ success: true, message: `Level ${level} ended.`, round: result.round });
        break;
      }
      case 'complete_event': {
        const updatedSession = GameService.completeEvent(adminId);
        broadcastGameState();
        res.json({ success: true, message: 'Event marked complete.', session: updatedSession });
        break;
      }
      case 'publish_results': {
        const updatedSession = GameService.publishFinalResults(adminId);
        const leaderboard = GameService.getLeaderboard();
        broadcastLeaderboard(leaderboard);
        broadcastGameState();
        res.json({ success: true, message: 'Final results published.', session: updatedSession });
        break;
      }
      case 'reset_game': {
        const newSession = GameService.resetGame(adminId);
        broadcastGameState();
        res.json({ success: true, message: 'Game reset successfully.', session: newSession });
        break;
      }
      default:
        res.status(400).json({ error: `Unknown control action: ${action}` });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Game control operation failed.' });
  }
});

/**
 * File upload endpoint
 * Route: POST /api/admin/upload
 */
router.post('/upload', uploadMedia.single('media'), (req: Request, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No media file provided.' });
    return;
  }

  // Construct accessible relative URL path
  const mediaPath = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    filename: req.file.filename,
    media_path: mediaPath,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
});

/**
 * Level 1 Questions CRUD
 */
router.get('/questions', (_req: Request, res: Response): void => {
  const db = getDb();
  const questions = db.prepare('SELECT * FROM level1_questions ORDER BY created_at DESC').all();
  res.json({ questions });
});

router.post('/questions', (req: Request, res: Response): void => {
  try {
    const parseResult = adminCreateQuestionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid question parameters' });
      return;
    }

    const q = parseResult.data;
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO level1_questions (
        id, title, prompt, content_type, media_path, correct_answer, explanation, category, difficulty, time_limit_seconds, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      q.title,
      q.prompt ?? '',
      q.content_type,
      q.media_path || null,
      q.correct_answer,
      q.explanation || null,
      q.category || null,
      q.difficulty || null,
      q.time_limit_seconds,
      q.is_active,
      now,
      now
    );

    logAuditAction(req.adminUser!.id, 'CREATE_QUESTION', 'level1_questions', id, { title: q.title });
    const created = db.prepare('SELECT * FROM level1_questions WHERE id = ?').get(id);
    res.status(201).json({ success: true, question: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create question.' });
  }
});

router.put('/questions/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const parseResult = adminUpdateQuestionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid update parameters' });
      return;
    }

    const q = parseResult.data;
    const db = getDb();
    const existing = db.prepare('SELECT * FROM level1_questions WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE level1_questions
      SET title = COALESCE(?, title),
          prompt = COALESCE(?, prompt),
          content_type = COALESCE(?, content_type),
          media_path = COALESCE(?, media_path),
          correct_answer = COALESCE(?, correct_answer),
          explanation = COALESCE(?, explanation),
          category = COALESCE(?, category),
          difficulty = COALESCE(?, difficulty),
          time_limit_seconds = COALESCE(?, time_limit_seconds),
          is_active = COALESCE(?, is_active),
          updated_at = ?
      WHERE id = ?
    `).run(
      q.title ?? null,
      q.prompt ?? null,
      q.content_type ?? null,
      q.media_path ?? null,
      q.correct_answer ?? null,
      q.explanation ?? null,
      q.category ?? null,
      q.difficulty ?? null,
      q.time_limit_seconds ?? null,
      q.is_active ?? null,
      now,
      id
    );

    logAuditAction(req.adminUser!.id, 'UPDATE_QUESTION', 'level1_questions', id, q);
    const updated = db.prepare('SELECT * FROM level1_questions WHERE id = ?').get(id);
    res.json({ success: true, question: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update question.' });
  }
});

router.delete('/questions/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const db = getDb();

    // Check if referenced in historical rounds
    const isReferenced = db.prepare('SELECT COUNT(*) as count FROM team_question_assignments WHERE question_id = ?').get(id) as any;
    if (isReferenced.count > 0) {
      // Archive instead of breaking relational integrity
      db.prepare('UPDATE level1_questions SET is_active = 0 WHERE id = ?').run(id);
      logAuditAction(req.adminUser!.id, 'ARCHIVE_QUESTION', 'level1_questions', id);
      res.json({ success: true, message: 'Question was referenced in historical rounds and has been archived.' });
    } else {
      db.prepare('DELETE FROM level1_questions WHERE id = ?').run(id);
      logAuditAction(req.adminUser!.id, 'DELETE_QUESTION', 'level1_questions', id);
      res.json({ success: true, message: 'Question deleted successfully.' });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete question.' });
  }
});

/**
 * Level 2 Cases & Clues CRUD
 */
router.get('/cases', (_req: Request, res: Response): void => {
  const db = getDb();
  const cases = db.prepare('SELECT * FROM level2_cases ORDER BY created_at DESC').all() as any[];
  for (const c of cases) {
    c.clues = db.prepare('SELECT * FROM clues WHERE case_id = ? ORDER BY display_order ASC').all(c.id);
    c.media = db.prepare('SELECT * FROM case_media WHERE case_id = ? ORDER BY display_order ASC').all(c.id);
  }
  res.json({ cases });
});

router.put('/cases/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const parseResult = adminUpdateCaseSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid case update.' });
      return;
    }
    const db = getDb();
    const existing = db.prepare('SELECT * FROM level2_cases WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Case not found.' });
      return;
    }
    const c = parseResult.data;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE level2_cases
      SET title = COALESCE(?, title),
          situation_description = COALESCE(?, situation_description),
          media_path = COALESCE(?, media_path),
          initial_credits = COALESCE(?, initial_credits),
          viewing_duration_seconds = COALESCE(?, viewing_duration_seconds),
          replay_cost = COALESCE(?, replay_cost),
          reference_answer = COALESCE(?, reference_answer),
          evaluation_guidance = COALESCE(?, evaluation_guidance),
          is_active = COALESCE(?, is_active),
          updated_at = ?
      WHERE id = ?
    `).run(
      c.title ?? null,
      c.situation_description ?? null,
      c.media_path ?? null,
      c.initial_credits ?? null,
      c.viewing_duration_seconds ?? null,
      c.replay_cost ?? null,
      c.reference_answer ?? null,
      c.evaluation_guidance ?? null,
      c.is_active ?? null,
      now,
      id
    );
    logAuditAction(req.adminUser!.id, 'UPDATE_CASE', 'level2_cases', id, { fields: Object.keys(c) });
    const updated = db.prepare('SELECT * FROM level2_cases WHERE id = ?').get(id);
    res.json({ success: true, case: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update case.' });
  }
});

router.post('/case-media', (req: Request, res: Response): void => {
  try {
    const parseResult = adminCaseMediaSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid media data' });
      return;
    }
    const m = parseResult.data;
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO case_media (id, case_id, media_type, media_path, caption, display_order, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, m.case_id, m.media_type, m.media_path, m.caption || null, m.display_order, now);
    logAuditAction(req.adminUser!.id, 'CREATE_CASE_MEDIA', 'case_media', id, { case_id: m.case_id, media_type: m.media_type });
    const created = db.prepare('SELECT * FROM case_media WHERE id = ?').get(id);
    res.status(201).json({ success: true, media: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to add case media.' });
  }
});

router.delete('/case-media/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    getDb().prepare('DELETE FROM case_media WHERE id = ?').run(id);
    logAuditAction(req.adminUser!.id, 'DELETE_CASE_MEDIA', 'case_media', id);
    res.json({ success: true, message: 'Case media removed.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete case media.' });
  }
});

router.post('/cases', (req: Request, res: Response): void => {
  try {
    const parseResult = adminCreateCaseSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid case data' });
      return;
    }

    const c = parseResult.data;
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    const rubricJson = c.rubric_json || JSON.stringify({
      maxAccuracy: 10,
      maxReasoning: 5,
      maxEfficiency: 5,
      maxTotal: 20
    });

    db.prepare(`
      INSERT INTO level2_cases (
        id, title, situation_description, media_path, initial_credits, is_active, rubric_json,
        viewing_duration_seconds, replay_cost, reference_answer, evaluation_guidance,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, c.title, c.situation_description, c.media_path || null, c.initial_credits, c.is_active, rubricJson,
      c.viewing_duration_seconds, c.replay_cost, c.reference_answer || null, c.evaluation_guidance || null,
      now, now
    );

    logAuditAction(req.adminUser!.id, 'CREATE_CASE', 'level2_cases', id, { title: c.title });
    const created = db.prepare('SELECT * FROM level2_cases WHERE id = ?').get(id);
    res.status(201).json({ success: true, case: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create case.' });
  }
});

router.post('/clues', (req: Request, res: Response): void => {
  try {
    const parseResult = adminCreateClueSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid clue data' });
      return;
    }

    const clue = parseResult.data;
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    // TechBrains clues are TEXT ONLY — media_path is always null.
    db.prepare(`
      INSERT INTO clues (id, case_id, title, content, media_path, credit_cost, display_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    `).run(id, clue.case_id, clue.title, clue.content, clue.credit_cost, clue.display_order, clue.is_active, now, now);

    logAuditAction(req.adminUser!.id, 'CREATE_CLUE', 'clues', id, { title: clue.title });
    const created = db.prepare('SELECT * FROM clues WHERE id = ?').get(id);
    res.status(201).json({ success: true, clue: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create clue.' });
  }
});

router.put('/clues/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const parseResult = adminUpdateClueSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid clue update.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM clues WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Clue not found.' });
      return;
    }

    const u = parseResult.data;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE clues
      SET title = COALESCE(?, title),
          content = COALESCE(?, content),
          credit_cost = COALESCE(?, credit_cost),
          display_order = COALESCE(?, display_order),
          is_active = COALESCE(?, is_active),
          updated_at = ?
      WHERE id = ?
    `).run(
      u.title ?? null,
      u.content ?? null,
      u.credit_cost ?? null,
      u.display_order ?? null,
      u.is_active ?? null,
      now,
      id
    );

    logAuditAction(req.adminUser!.id, 'UPDATE_CLUE', 'clues', id, u);
    const updated = db.prepare('SELECT * FROM clues WHERE id = ?').get(id);
    res.json({ success: true, clue: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update clue.' });
  }
});

router.delete('/clues/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const db = getDb();

    // If the clue has already been unlocked by any team, archive it instead of
    // deleting — preserving clue_unlocks and credit_transactions history.
    const isReferenced = (db.prepare('SELECT COUNT(*) as count FROM clue_unlocks WHERE clue_id = ?').get(id) as any).count;
    if (isReferenced > 0) {
      db.prepare('UPDATE clues SET is_active = 0, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id);
      logAuditAction(req.adminUser!.id, 'ARCHIVE_CLUE', 'clues', id);
      res.json({ success: true, message: 'Clue was already purchased by teams and has been archived.' });
    } else {
      db.prepare('DELETE FROM clues WHERE id = ?').run(id);
      logAuditAction(req.adminUser!.id, 'DELETE_CLUE', 'clues', id);
      res.json({ success: true, message: 'Clue removed.' });
    }
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete clue.' });
  }
});

/**
 * Registered Teams List (with live in-memory presence and remote LAN IP)
 */
router.get('/teams', (_req: Request, res: Response): void => {
  const db = getDb();
  const { session } = GameService.getGameSession();
  const presenceMap = getAllTeamsPresence(session.id);

  const rawTeams = db.prepare(`
    SELECT t.*, 
      (SELECT COUNT(*) FROM team_answers WHERE team_id = t.id) as answers_count,
      (SELECT COUNT(*) FROM clue_unlocks WHERE team_id = t.id) as clues_unlocked_count,
      (SELECT status FROM conclusions WHERE team_id = t.id) as conclusion_status
    FROM teams t
    WHERE t.game_session_id = ?
    ORDER BY t.created_at ASC
  `).all(session.id) as any[];

  const teams = rawTeams.map((t) => {
    const presence = presenceMap.get(t.id);
    return {
      ...t,
      is_connected: presence ? presence.is_connected : false,
      ip_address: presence && presence.is_connected ? presence.ip_address : null,
      ip_addresses: presence && presence.is_connected ? presence.ip_addresses : [],
      connections_count: presence ? presence.connections_count : 0,
      last_connected_at: presence ? presence.last_connected_at : null
    };
  });

  res.json({ teams });
});

router.delete('/teams/:id', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const db = getDb();
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    logAuditAction(req.adminUser!.id, 'DELETE_TEAM', 'teams', id);
    res.json({ success: true, message: 'Team deleted.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete team.' });
  }
});

/**
 * Ban Team
 * Route: POST /api/admin/teams/:id/ban
 */
router.post('/teams/:id/ban', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const parseResult = adminBanTeamSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid ban request.' });
      return;
    }

    const { reason } = parseResult.data;
    const db = getDb();
    const { session } = GameService.getGameSession();

    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as any;
    if (!team) {
      res.status(404).json({ error: 'Team not found.' });
      return;
    }

    if (team.game_session_id !== session.id) {
      res.status(404).json({ error: 'Team does not belong to the active game session.' });
      return;
    }

    if (team.is_banned) {
      res.status(400).json({ error: 'Team is already banned.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE teams
      SET is_banned = 1, banned_at = ?, banned_by = ?, ban_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(now, req.adminUser!.id, reason || null, now, id);

    logAuditAction(req.adminUser!.id, 'BAN_TEAM', 'teams', id, {
      team_name: team.team_name,
      reason: reason || null,
      banned_at: now
    });

    // Forcibly evict and disconnect the active socket
    banAndDisconnectTeam(session.id, id, reason || null, now);

    res.json({
      success: true,
      message: `Team "${team.team_name}" has been banned.`,
      team: {
        id: team.id,
        team_name: team.team_name,
        is_banned: true,
        banned_at: now,
        ban_reason: reason || null
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to ban team.' });
  }
});

/**
 * Unban Team
 * Route: POST /api/admin/teams/:id/unban
 */
router.post('/teams/:id/unban', (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    const db = getDb();
    const { session } = GameService.getGameSession();

    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as any;
    if (!team) {
      res.status(404).json({ error: 'Team not found.' });
      return;
    }

    if (team.game_session_id !== session.id) {
      res.status(404).json({ error: 'Team does not belong to the active game session.' });
      return;
    }

    if (!team.is_banned) {
      res.status(400).json({ error: 'Team is not currently banned.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE teams
      SET is_banned = 0, banned_at = NULL, banned_by = NULL, ban_reason = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, id);

    logAuditAction(req.adminUser!.id, 'UNBAN_TEAM', 'teams', id, {
      team_name: team.team_name
    });

    res.json({
      success: true,
      message: `Team "${team.team_name}" has been unbanned.`,
      team: {
        id: team.id,
        team_name: team.team_name,
        is_banned: false
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to unban team.' });
  }
});

/**
 * Level 2 Submissions & Evaluations
 */
router.get('/submissions', (_req: Request, res: Response): void => {
  const db = getDb();
  const { session } = GameService.getGameSession();

  const submissions = db.prepare(`
    SELECT
      c.id as conclusion_id,
      c.team_id,
      c.conclusion_text,
      c.status,
      c.submitted_at,
      t.team_name,
      t.current_credits,
      t.initial_credits,
      t.level1_score,
      t.level2_score,
      (SELECT COALESCE(SUM(credits_spent), 0) FROM clue_unlocks WHERE team_id = t.id) as clue_credits_spent,
      (SELECT COUNT(*) FROM clue_unlocks WHERE team_id = t.id) as unlocked_count,
      (SELECT COUNT(*) FROM media_replays WHERE team_id = t.id) as replay_count,
      (SELECT COALESCE(SUM(credits_spent), 0) FROM media_replays WHERE team_id = t.id) as replay_credits_spent,
      e.id as evaluation_id,
      e.status as evaluation_status,
      e.score as evaluation_score,
      e.max_score as evaluation_max_score,
      e.verdict as evaluation_verdict,
      e.reasoning as evaluation_reasoning,
      e.source as evaluation_source,
      e.is_overridden as evaluation_is_overridden,
      e.error_message as evaluation_error,
      e.attempt_count as evaluation_attempts,
      e.updated_at as evaluated_at
    FROM conclusions c
    JOIN teams t ON t.id = c.team_id
    LEFT JOIN case_evaluations e ON e.conclusion_id = c.id
    WHERE t.game_session_id = ?
    ORDER BY c.submitted_at DESC
  `).all(session.id);

  res.json({ submissions });
});

/**
 * Trigger / retry AI evaluation for a submitted conclusion.
 * Route: POST /api/admin/evaluations/:conclusionId/evaluate
 */
router.post('/evaluations/:conclusionId/evaluate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { conclusionId } = req.params;
    const evaluation = await GameService.runAiEvaluation(conclusionId);
    const teamId = (getDb().prepare('SELECT team_id FROM conclusions WHERE id = ?').get(conclusionId) as any)?.team_id;
    if (teamId) emitToTeam(teamId, 'team:private_updated', GameService.getTeamPrivateState(teamId));
    res.json({ success: true, evaluation });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to run AI evaluation.' });
  }
});

/**
 * Manual evaluation / override of a conclusion (authoritative over AI).
 * Route: POST /api/admin/evaluations/override
 */
router.post('/evaluations/override', (req: Request, res: Response): void => {
  try {
    const parseResult = adminEvaluationOverrideSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid override.' });
      return;
    }
    const { conclusion_id, score, verdict, reasoning } = parseResult.data;
    const evaluation = GameService.overrideEvaluation(req.adminUser!.id, conclusion_id, score, verdict, reasoning || null);
    const teamId = (getDb().prepare('SELECT team_id FROM conclusions WHERE id = ?').get(conclusion_id) as any)?.team_id;
    if (teamId) emitToTeam(teamId, 'team:private_updated', GameService.getTeamPrivateState(teamId));
    res.json({ success: true, evaluation });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to override evaluation.' });
  }
});

// NOTE: The legacy "reopen submission" route has been removed. In TechBrains a
// final answer is immutable once submitted (enforced in GameService and by the
// trg_conclusions_immutable_after_submit DB trigger). Admins correct outcomes
// via the evaluation override flow, never by editing the answer itself.

/**
 * Settings
 */
router.put('/settings', (req: Request, res: Response): void => {
  try {
    const parseResult = adminSettingsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid settings' });
      return;
    }

    const updated = GameService.updateSettings(req.adminUser!.id, parseResult.data);
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update settings.' });
  }
});

/**
 * CSV Export of Leaderboard
 * Route: GET /api/admin/leaderboard/csv
 */
router.get('/leaderboard/csv', (_req: Request, res: Response): void => {
  try {
    const leaderboard = GameService.getLeaderboard({ includeBanned: true });

    // Build CSV content
    const headers = [
      'Rank',
      'Team Name',
      'Status',
      'Level 1 Score',
      'Level 1 Questions Answered',
      'Level 1 Accuracy (%)',
      'Level 2 Score',
      'Final Score',
      'Credits Spent',
      'Credits Remaining',
      'Conclusion Status',
      'Evaluation Status',
      'Final Submission Time'
    ];

    const rows = leaderboard.map((e) => [
      e.is_banned ? 'DISQUALIFIED' : e.rank,
      `"${e.team_name.replace(/"/g, '""')}"`,
      e.is_banned ? 'BANNED' : 'ACTIVE',
      e.level1_score,
      e.level1_answered,
      e.level1_accuracy_percent,
      e.level2_score,
      e.final_score,
      e.credits_spent,
      e.credits_remaining,
      e.conclusion_submitted ? 'Submitted' : 'None',
      e.evaluation_completed ? 'Evaluated' : 'Pending',
      e.final_submission_time ? `"${e.final_submission_time}"` : 'N/A'
    ]);

    const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="techbrains_leaderboard_${Date.now()}.csv"`);
    res.send(csvString);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate CSV export.' });
  }
});

/**
 * Trigger immediate database and uploads backup
 * Route: POST /api/admin/backup
 */
router.post('/backup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { backupDatabaseAndUploads } = await import('../database/backup.js');
    const backupDir = await backupDatabaseAndUploads();
    logAuditAction(req.adminUser!.id, 'CREATE_BACKUP', 'system', null, { backupDir });
    res.json({ success: true, message: 'Authoritative backup created.', backup_dir: backupDir });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Backup failed.' });
  }
});

export default router;

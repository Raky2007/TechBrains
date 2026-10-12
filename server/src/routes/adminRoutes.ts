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
  broadcastGameReset,
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
import { getQueueStatus, isAiConfigured } from '../services/aiEvaluationService.js';
import { CONFIG } from '../config.js';

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

    const progression = GameService.getLevel1ProgressionMetrics();

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
      progression,
      ai_status: {
        provider: CONFIG.AI.PROVIDER,
        model: CONFIG.AI.MODEL,
        is_configured: isAiConfigured()
      },
      recent_events: recentEvents
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load overview data.' });
  }
});

/**
 * Level 1 Progression & Qualification Metrics
 * Route: GET /api/admin/progression
 */
router.get('/progression', (_req: Request, res: Response): void => {
  try {
    const progression = GameService.getLevel1ProgressionMetrics();
    res.json(progression);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load progression metrics.' });
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
      case 'start_event': {
        const result = GameService.startEvent(adminId);
        broadcastRoundEvent('round:started', { level: 1, round: result.round });
        broadcastGameState();
        res.json({ success: true, message: 'Tournament event started with Level 1.', round: result.round, session: result.session });
        break;
      }
      case 'stop_event': {
        const updatedSession = GameService.stopEvent(adminId);
        broadcastRoundEvent('round:ended', { level: updatedSession.current_level || 2, round: null });
        broadcastGameState();
        res.json({ success: true, message: 'Tournament event stopped.', session: updatedSession });
        break;
      }
      case 'start': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.startRound(adminId, level);
        broadcastRoundEvent('round:started', { level, round: result.round });
        broadcastGameState();
        res.json({ success: true, message: `Level ${level} started.`, round: result.round });
        break;
      }
      case 'pause': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.pauseRound(adminId, level);
        broadcastRoundEvent('round:paused', { level, round: result.round });
        broadcastGameState();
        res.json({ success: true, message: `Level ${level} paused.`, round: result.round });
        break;
      }
      case 'resume': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.resumeRound(adminId, level);
        broadcastRoundEvent('round:resumed', { level, round: result.round });
        broadcastGameState();
        res.json({ success: true, message: `Level ${level} resumed.`, round: result.round });
        break;
      }
      case 'end': {
        if (level !== 1 && level !== 2) throw new Error('Valid level (1 or 2) is required.');
        const result = GameService.endRound(adminId, level);
        broadcastRoundEvent('round:ended', { level, round: result.round });
        broadcastGameState();
        res.json({ success: true, message: `Level ${level} ended.`, round: result.round });
        break;
      }
      case 'complete_event': {
        const updatedSession = GameService.completeEvent(adminId);
        broadcastRoundEvent('round:ended', { level: 2, round: null });
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
        broadcastGameReset(newSession.id);
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
router.get('/questions', (req: Request, res: Response): void => {
  const db = getDb();
  const includeArchived = req.query.include_archived === 'true';
  const query = includeArchived
    ? 'SELECT * FROM level1_questions ORDER BY created_at DESC'
    : 'SELECT * FROM level1_questions WHERE is_active = 1 ORDER BY created_at DESC';
  const questions = db.prepare(query).all();
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
        id, title, prompt, content_type, media_path, correct_answer, explanation, category, difficulty, time_limit_seconds, points_value, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      q.points_value ?? 3,
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
          points_value = COALESCE(?, points_value),
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
      q.points_value ?? null,
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

    // Check if Round 1 is actively running
    const activeRound = db.prepare(`SELECT id FROM rounds WHERE level = 1 AND status = 'active'`).get();
    if (activeRound) {
      res.status(400).json({ error: 'Cannot delete question while Round 1 is actively running. End or pause the round first.' });
      return;
    }

    const question = db.prepare('SELECT id, title FROM level1_questions WHERE id = ?').get(id) as any;
    if (!question) {
      res.status(404).json({ error: 'Question not found.' });
      return;
    }

    // Permanently remove question (cascades to team_question_assignments and team_answers)
    db.prepare('DELETE FROM level1_questions WHERE id = ?').run(id);
    logAuditAction(req.adminUser!.id, 'DELETE_QUESTION', 'level1_questions', id, { title: question.title });
    res.json({ success: true, message: 'Question deleted successfully.' });
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
    c.clues = db.prepare('SELECT * FROM clues WHERE case_id = ? AND is_active = 1 ORDER BY display_order ASC').all(c.id);
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

    // Check if Round 2 is actively running
    const activeRound = db.prepare(`SELECT id FROM rounds WHERE level = 2 AND status = 'active'`).get();
    if (activeRound) {
      res.status(400).json({ error: 'Cannot delete clue while Round 2 is actively in progress.' });
      return;
    }

    const clue = db.prepare('SELECT id, title FROM clues WHERE id = ?').get(id) as any;
    if (!clue) {
      res.status(404).json({ error: 'Clue not found.' });
      return;
    }

    db.prepare('DELETE FROM clues WHERE id = ?').run(id);
    logAuditAction(req.adminUser!.id, 'DELETE_CLUE', 'clues', id, { title: clue.title });
    res.json({ success: true, message: 'Clue removed successfully.' });
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

function csvEscape(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * CSV Export of Registered Teams
 * Route: GET /api/admin/teams/csv
 */
router.get('/teams/csv', (_req: Request, res: Response): void => {
  try {
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

    const headers = [
      'Team Name',
      'Player 1 Roll Number',
      'Player 2 Roll Number',
      'Status',
      'Online Presence',
      'Client IP',
      'Active Connections',
      'Level 1 Score',
      'Level 1 Questions Answered',
      'Level 2 Score',
      'Total Event Score',
      'Initial Credits',
      'Credits Remaining',
      'Clues Unlocked',
      'Conclusion Submitted',
      'Disqualification Reason',
      'Registered At'
    ];

    const rows = rawTeams.map((t) => {
      const presence = presenceMap.get(t.id);
      const isOnline = presence ? presence.is_connected : false;
      const ip = presence && presence.is_connected ? presence.ip_address : '';
      const connCount = presence ? presence.connections_count : 0;
      const totalScore = (t.level1_score ?? 0) + (t.level2_score ?? 0);

      return [
        csvEscape(t.team_name),
        csvEscape(t.player1_roll || ''),
        csvEscape(t.player2_roll || ''),
        csvEscape(t.is_banned ? 'BANNED' : 'ACTIVE'),
        csvEscape(t.is_banned ? 'DISQUALIFIED' : (isOnline ? 'ONLINE' : 'OFFLINE')),
        csvEscape(ip || ''),
        connCount,
        t.level1_score ?? 0,
        t.answers_count ?? 0,
        t.level2_score ?? 0,
        totalScore,
        t.initial_credits ?? 200,
        t.current_credits ?? 200,
        t.clues_unlocked_count ?? 0,
        csvEscape(t.conclusion_status === 'submitted' ? 'YES' : 'NO'),
        csvEscape(t.ban_reason || ''),
        csvEscape(t.created_at || '')
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="techbrains_registered_teams_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate teams CSV export.' });
  }
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

  // Find all teams in the session that have submitted Q1, Q2, or a conclusion
  const teamRows = db.prepare(`
    SELECT DISTINCT t.id as team_id, t.team_name, t.current_credits, t.initial_credits,
           t.level1_score, t.level2_score, t.player1_roll, t.player2_roll
    FROM teams t
    WHERE t.game_session_id = ?
      AND (
        EXISTS (SELECT 1 FROM conclusions c WHERE c.team_id = t.id)
        OR EXISTS (SELECT 1 FROM level2_question_submissions lqs WHERE lqs.team_id = t.id)
      )
  `).all(session.id) as any[];

  const submissions = teamRows.map((t) => {
    const q1 = db.prepare(`
      SELECT * FROM level2_question_submissions
      WHERE team_id = ? AND question_number = 1
      ORDER BY submitted_at DESC LIMIT 1
    `).get(t.team_id) as any;

    const q2 = db.prepare(`
      SELECT * FROM level2_question_submissions
      WHERE team_id = ? AND question_number = 2
      ORDER BY submitted_at DESC LIMIT 1
    `).get(t.team_id) as any;

    const c = db.prepare(`
      SELECT * FROM conclusions
      WHERE team_id = ?
      ORDER BY submitted_at DESC LIMIT 1
    `).get(t.team_id) as any;

    const e = c ? db.prepare(`
      SELECT * FROM case_evaluations WHERE conclusion_id = ?
    `).get(c.id) as any : null;

    const clueSpent = (db.prepare(`
      SELECT COALESCE(SUM(credits_spent), 0) as s, COUNT(*) as c
      FROM clue_unlocks WHERE team_id = ?
    `).get(t.team_id) as any);

    const replaySpent = (db.prepare(`
      SELECT COALESCE(SUM(credits_spent), 0) as s, COUNT(*) as c
      FROM media_replays WHERE team_id = ?
    `).get(t.team_id) as any);

    let q2Data: any = null;
    if (q2?.evaluation_data_json) {
      try { q2Data = JSON.parse(q2.evaluation_data_json); } catch {}
    }

    const effectiveScore = q2 ? q2.score : e?.score;
    const effectiveVerdict = q2Data?.verdict || e?.verdict || null;
    const effectiveReasoning = q2Data?.reasoning || e?.reasoning || null;

    let matchedEvidence = q2Data?.matched_evidence || [];
    if (typeof matchedEvidence === 'string') {
      try { matchedEvidence = JSON.parse(matchedEvidence); } catch { matchedEvidence = [matchedEvidence]; }
    }
    if (!matchedEvidence.length && e?.q2_matched_evidence) {
      try { matchedEvidence = JSON.parse(e.q2_matched_evidence); } catch { matchedEvidence = [e.q2_matched_evidence]; }
    }

    let missingEvidence = q2Data?.missing_evidence || [];
    if (typeof missingEvidence === 'string') {
      try { missingEvidence = JSON.parse(missingEvidence); } catch { missingEvidence = [missingEvidence]; }
    }
    if (!missingEvidence.length && e?.q2_missing_evidence) {
      try { missingEvidence = JSON.parse(e.q2_missing_evidence); } catch { missingEvidence = [e.q2_missing_evidence]; }
    }

    return {
      conclusion_id: c?.id || q2?.id || q1?.id,
      team_id: t.team_id,
      team_name: t.team_name,
      player1_roll: t.player1_roll || null,
      player2_roll: t.player2_roll || null,
      current_credits: t.current_credits,
      initial_credits: t.initial_credits,
      level1_score: t.level1_score,
      level2_score: t.level2_score,
      conclusion_text: c?.conclusion_text || q2?.explanation || null,
      submitted_at: q2?.submitted_at || c?.submitted_at || q1?.submitted_at,

      // Question 1 details
      q1_submitted: !!q1,
      q1_pin: q1?.pin_submitted || null,
      q1_pin_normalized: q1?.pin_normalized || null,
      q1_is_correct: q1 ? q1.is_correct === 1 : null,
      q1_score: q1 ? q1.score : null,
      q1_max_score: 5,
      q1_submitted_at: q1?.submitted_at || null,

      // Question 2 details
      q2_submitted: !!q2 || !!c,
      q2_selected_suspect: q2?.selected_suspect || c?.q2_selected_suspect || null,
      q2_explanation: q2?.explanation || c?.q2_explanation || c?.conclusion_text || null,
      q2_score: effectiveScore,
      q2_max_score: 5,
      q2_status: q2?.evaluation_status || e?.status || (c ? 'pending' : null),

      // Structured Evaluation fields
      suspect_score: q2?.suspect_score ?? e?.suspect_score ?? q2Data?.suspect_score ?? null,
      evidence_score: q2?.evidence_score ?? e?.evidence_score ?? q2Data?.evidence_score ?? null,
      logic_score: q2?.logic_score ?? e?.logic_score ?? q2Data?.logic_score ?? null,
      selected_suspect_correct: q2Data?.selected_suspect_correct ?? (e?.q2_selected_suspect_correct === 1),
      closest_answer: q2Data?.closest_answer || e?.q2_closest_answer || null,
      accuracy_summary: q2Data?.accuracy_summary || e?.q2_accuracy_summary || null,
      matched_evidence: matchedEvidence,
      missing_evidence: missingEvidence,
      feedback: q2Data?.feedback || e?.q2_feedback || null,

      // Evaluation overall / legacy fields
      evaluation_id: e?.id,
      evaluation_status: q2?.evaluation_status || e?.status || 'completed',
      evaluation_score: effectiveScore,
      evaluation_max_score: 5,
      evaluation_verdict: effectiveVerdict,
      evaluation_reasoning: effectiveReasoning,
      evaluation_source: e?.source || 'ai',
      evaluation_is_overridden: e?.is_overridden === 1,
      evaluation_error: e?.error_message || null,
      evaluation_attempts: e?.attempt_count || 0,
      evaluated_at: e?.updated_at || q2?.updated_at || null,

      // Stats
      unlocked_count: clueSpent?.c || 0,
      clue_credits_spent: clueSpent?.s || 0,
      replay_count: replaySpent?.c || 0,
      replay_credits_spent: replaySpent?.s || 0
    };
  });

  submissions.sort((a, b) => new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime());

  const queueStats = getQueueStatus();
  const evaluationStats = db.prepare(`
    SELECT 
      COUNT(CASE WHEN evaluation_status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN evaluation_status = 'processing' THEN 1 END) as processing,
      COUNT(CASE WHEN evaluation_status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN evaluation_status = 'failed' THEN 1 END) as failed,
      COUNT(CASE WHEN evaluation_status = 'overridden' THEN 1 END) as overridden
    FROM level2_question_submissions
    WHERE question_number = 2
  `).get() as any;

  res.json({
    submissions,
    queue_stats: {
      ...queueStats,
      db_counts: evaluationStats || { pending: 0, processing: 0, completed: 0, failed: 0, overridden: 0 },
      provider: CONFIG.AI.PROVIDER,
      model: CONFIG.AI.MODEL,
      is_configured: isAiConfigured()
    }
  });
});

/**
 * CSV Export of Level 2 Submissions & Evaluations
 * Route: GET /api/admin/submissions/csv
 */
router.get('/submissions/csv', (_req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { session } = GameService.getGameSession();

    const teamRows = db.prepare(`
      SELECT DISTINCT t.id as team_id, t.team_name, t.current_credits, t.initial_credits,
             t.level1_score, t.level2_score, t.player1_roll, t.player2_roll, t.is_banned
      FROM teams t
      WHERE t.game_session_id = ?
        AND (
          EXISTS (SELECT 1 FROM conclusions c WHERE c.team_id = t.id)
          OR EXISTS (SELECT 1 FROM level2_question_submissions lqs WHERE lqs.team_id = t.id)
        )
      ORDER BY t.created_at ASC
    `).all(session.id) as any[];

    const headers = [
      'Team Name',
      'Player 1 Roll',
      'Player 2 Roll',
      'Status',
      'Q1 PIN Submitted',
      'Q1 Correct',
      'Q1 Score (out of 5)',
      'Q1 Submitted At',
      'Q2 Selected Suspect',
      'Q2 Suspect Score (out of 2)',
      'Q2 Evidence Score (out of 2)',
      'Q2 Logic Score (out of 1)',
      'Q2 Total Score (out of 5)',
      'Q2 Evaluation Status',
      'Q2 Is Overridden',
      'Q2 Verdict',
      'Q2 Closest Answer',
      'Total Level 2 Score (out of 10)',
      'Total Event Score (out of 40)',
      'Submitted At',
      'Q2 Team Explanation',
      'AI Feedback',
      'Matched Evidence',
      'Missing Evidence'
    ];

    const rows = teamRows.map((t) => {
      const q1 = db.prepare(`
        SELECT * FROM level2_question_submissions
        WHERE team_id = ? AND question_number = 1
        ORDER BY submitted_at DESC LIMIT 1
      `).get(t.team_id) as any;

      const q2 = db.prepare(`
        SELECT * FROM level2_question_submissions
        WHERE team_id = ? AND question_number = 2
        ORDER BY submitted_at DESC LIMIT 1
      `).get(t.team_id) as any;

      const c = db.prepare(`
        SELECT * FROM conclusions
        WHERE team_id = ?
        ORDER BY submitted_at DESC LIMIT 1
      `).get(t.team_id) as any;

      const e = c ? db.prepare(`
        SELECT * FROM case_evaluations WHERE conclusion_id = ?
      `).get(c.id) as any : null;

      let q2Data: any = null;
      if (q2?.evaluation_data_json) {
        try { q2Data = JSON.parse(q2.evaluation_data_json); } catch {}
      }

      const q1Score = q1 ? q1.score : 0;
      const q2Score = q2 ? q2.score : (e?.score ?? 0);
      const isOverridden = q2?.is_overridden === 1 || e?.is_overridden === 1;
      const status = q2?.evaluation_status || e?.status || (c ? 'pending' : 'not_submitted');
      const suspect = q2?.selected_suspect || c?.q2_selected_suspect || '';
      const explanation = q2?.explanation || c?.q2_explanation || c?.conclusion_text || '';
      const verdict = q2Data?.verdict || e?.verdict || '';
      const closest = q2Data?.closest_answer || e?.q2_closest_answer || '';
      const feedback = q2Data?.feedback || e?.q2_feedback || '';
      const matched = Array.isArray(q2Data?.matched_evidence) ? q2Data.matched_evidence.join('; ') : '';
      const missing = Array.isArray(q2Data?.missing_evidence) ? q2Data.missing_evidence.join('; ') : '';

      return [
        csvEscape(t.team_name),
        csvEscape(t.player1_roll || ''),
        csvEscape(t.player2_roll || ''),
        csvEscape(t.is_banned ? 'BANNED' : 'ACTIVE'),
        csvEscape(q1?.pin_submitted || ''),
        csvEscape(q1 ? (q1.is_correct === 1 ? 'YES' : 'NO') : 'N/A'),
        q1Score,
        csvEscape(q1?.submitted_at || ''),
        csvEscape(suspect),
        q2?.suspect_score ?? e?.suspect_score ?? q2Data?.suspect_score ?? 0,
        q2?.evidence_score ?? e?.evidence_score ?? q2Data?.evidence_score ?? 0,
        q2?.logic_score ?? e?.logic_score ?? q2Data?.logic_score ?? 0,
        q2Score,
        csvEscape(status),
        csvEscape(isOverridden ? 'YES' : 'NO'),
        csvEscape(verdict),
        csvEscape(closest),
        t.level2_score ?? (q1Score + q2Score),
        (t.level1_score ?? 0) + (t.level2_score ?? (q1Score + q2Score)),
        csvEscape(q2?.submitted_at || c?.submitted_at || q1?.submitted_at || ''),
        csvEscape(explanation),
        csvEscape(feedback),
        csvEscape(matched),
        csvEscape(missing)
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="techbrains_level2_submissions_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate Level 2 submissions CSV export.' });
  }
});

/**
 * CSV Export of All Level 1 Responses
 * Route: GET /api/admin/submissions/level1/csv
 */
router.get('/submissions/level1/csv', (_req: Request, res: Response): void => {
  try {
    const db = getDb();
    const { session } = GameService.getGameSession();

    const responses = db.prepare(`
      SELECT 
        t.team_name,
        t.player1_roll,
        t.player2_roll,
        COALESCE(tqa.question_order, 0) as question_order,
        q.title as question_title,
        q.correct_answer,
        ta.selected_answer,
        ta.is_correct,
        ta.awarded_points,
        ta.submitted_at
      FROM team_answers ta
      JOIN teams t ON t.id = ta.team_id
      JOIN level1_questions q ON q.id = ta.question_id
      LEFT JOIN team_question_assignments tqa 
        ON tqa.team_id = ta.team_id AND tqa.question_id = ta.question_id
      WHERE t.game_session_id = ?
      ORDER BY t.team_name ASC, COALESCE(tqa.question_order, 0) ASC, ta.submitted_at ASC
    `).all(session.id) as any[];

    const headers = [
      'Team Name',
      'Player 1 Roll',
      'Player 2 Roll',
      'Question Order',
      'Question Title',
      'Correct Answer',
      'Selected Answer',
      'Result',
      'Awarded Points',
      'Submitted At'
    ];

    const rows = responses.map((r) => {
      let result = 'INCORRECT';
      if (r.is_correct === 1) result = 'CORRECT';
      else if (r.selected_answer === 'CANT_DEFINE') result = 'CANT_DEFINE';
      else if (r.selected_answer === 'TIMED_OUT' || !r.selected_answer) result = 'TIMED_OUT';

      return [
        csvEscape(r.team_name),
        csvEscape(r.player1_roll || ''),
        csvEscape(r.player2_roll || ''),
        r.question_order ?? 0,
        csvEscape(r.question_title || ''),
        csvEscape(r.correct_answer || ''),
        csvEscape(r.selected_answer || 'TIMED_OUT'),
        csvEscape(result),
        r.awarded_points ?? 0,
        csvEscape(r.submitted_at || '')
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="techbrains_level1_responses_${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate Level 1 responses CSV export.' });
  }
});

/**
 * AI evaluation diagnostics and credential status.
 * Route: GET /api/admin/ai/status
 */
router.get('/ai/status', (_req: Request, res: Response): void => {
  try {
    const db = getDb();
    const queueStats = getQueueStatus();
    const evaluationStats = db.prepare(`
      SELECT 
        COUNT(CASE WHEN evaluation_status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN evaluation_status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN evaluation_status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN evaluation_status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN evaluation_status = 'overridden' THEN 1 END) as overridden
      FROM level2_question_submissions
      WHERE question_number = 2
    `).get() as any;

    res.json({
      success: true,
      ...queueStats,
      db_counts: evaluationStats || { pending: 0, processing: 0, completed: 0, failed: 0, overridden: 0 },
      provider: CONFIG.AI.PROVIDER,
      model: CONFIG.AI.MODEL,
      is_configured: isAiConfigured()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get AI diagnostics.' });
  }
});

/**
 * Trigger / retry AI evaluation for a submitted conclusion.
 * Route: POST /api/admin/evaluations/:conclusionId/evaluate
 */
router.post('/evaluations/:conclusionId/evaluate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { conclusionId } = req.params;
    const evaluation = await GameService.runAiEvaluation(conclusionId);
    const db = getDb();
    let teamId = (db.prepare('SELECT team_id FROM conclusions WHERE id = ?').get(conclusionId) as any)?.team_id;
    if (!teamId) {
      teamId = (db.prepare('SELECT team_id FROM level2_question_submissions WHERE id = ?').get(conclusionId) as any)?.team_id;
    }
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
    const { conclusion_id, score, verdict, reasoning, q1_score } = parseResult.data;
    const evaluation = GameService.overrideEvaluation(
      req.adminUser!.id,
      conclusion_id,
      score,
      verdict,
      reasoning || null,
      q1_score
    );
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
      'Player 1 Roll Number',
      'Player 2 Roll Number',
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
      `"${(e.player1_roll || '').replace(/"/g, '""')}"`,
      `"${(e.player2_roll || '').replace(/"/g, '""')}"`,
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

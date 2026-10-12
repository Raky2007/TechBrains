import React, { useState } from 'react';
import { apiFetch } from '../lib/api';
import { PublicGameState } from '@nexus/shared';
import { CountdownTimer } from './CountdownTimer';
import { Play, Pause, StopCircle } from 'lucide-react';

interface RoundControlPanelProps {
  level: 1 | 2;
  gameState: PublicGameState;
  onChanged: () => void | Promise<void>;
}

/**
 * Admin-only round timer controls for a single round.
 *
 * This is a thin UI over the existing server-authoritative control endpoint
 * (POST /api/admin/controls). It introduces NO new timer logic — start, pause,
 * resume and end all delegate to GameService on the server, which remains the
 * single source of truth for round state and timing.
 */
export const RoundControlPanel: React.FC<RoundControlPanelProps> = ({ level, gameState, onChanged }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);

  const { status, round } = gameState;

  const run = async (action: 'start' | 'pause' | 'resume' | 'end') => {
    if (action === 'end') {
      const ok = window.confirm(
        `End Round ${level} now? This locks submissions for all teams and cannot be undone.`
      );
      if (!ok) return;
    }
    setBusy(action);
    setFeedback(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/admin/controls', {
        method: 'POST',
        body: JSON.stringify({ action, level })
      });
      setFeedback({ message: res.message });
      await onChanged();
    } catch (err: any) {
      setFeedback({ message: err.message || 'Operation failed.', isError: true });
    } finally {
      setBusy(null);
    }
  };

  const canStart = level === 1 ? status === 'idle' : status === 'level1_ended';
  const isActive = status === `level${level}_active`;
  const isPaused = status === `level${level}_paused`;
  // Round 1 has no overall timer (per-question timers govern it), so pause/
  // resume and the round countdown apply to Round 2 only.
  const hasOverallTimer = level === 2;
  const showTimer = hasOverallTimer && round?.level === level;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">
          {hasOverallTimer ? `Level ${level} Timer Control` : `Level ${level} Controls`}
        </span>
        {showTimer && round && (
          <CountdownTimer
            deadlineAt={round.deadline_at}
            isPaused={round.is_paused}
            remainingSeconds={round.remaining_seconds}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {canStart && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('start')}
            className="px-4 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <Play className="w-4 h-4 fill-[#171717]" />
            <span>Start Level {level}</span>
          </button>
        )}
        {isActive && hasOverallTimer && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('pause')}
            className="px-4 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#FF8A24] bg-[#FFF0D6] border border-[#FF8A24]/40 hover:bg-[#ffe5b8] transition-all flex items-center gap-2 cursor-pointer"
          >
            <Pause className="w-4 h-4" />
            <span>Pause Timer</span>
          </button>
        )}
        {isPaused && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('resume')}
            className="px-4 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] transition-all flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-4 h-4 fill-[#171717]" />
            <span>Resume Timer</span>
          </button>
        )}
        {(isActive || isPaused) && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('end')}
            className="px-4 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#B42318] hover:bg-[#B42318]/10 border border-[#B42318]/30 transition-all flex items-center gap-2 cursor-pointer"
          >
            <StopCircle className="w-4 h-4" />
            <span>End Level {level}</span>
          </button>
        )}
        {!canStart && !isActive && !isPaused && (
          <div className="px-3 py-2.5 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] text-xs font-mono text-[#737373]">
            {level === 1
              ? 'Level 1 has concluded.'
              : status === 'idle' || status === 'level1_active' || status === 'level1_paused'
              ? 'Available once Level 1 has ended.'
              : 'Level 2 has concluded.'}
          </div>
        )}
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg border text-xs ${
            feedback.isError
              ? 'bg-[#B42318]/5 border-[#B42318]/20 text-[#B42318]'
              : 'bg-[#18794E]/5 border-[#18794E]/20 text-[#18794E]'
          }`}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
};

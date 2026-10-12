import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { CountdownTimer } from '../../components/CountdownTimer';
import { ConfirmationModal } from '../../components/ConfirmationModal';
import { PublicGameState } from '@nexus/shared';
import {
  Play,
  Pause,
  RotateCcw,
  StopCircle,
  Trophy,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react';

export const AdminControlPage: React.FC = () => {
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);

  // Confirmation modal state
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
    isDestructive?: boolean;
    confirmLabel?: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: async () => {}
  });

  const [progression, setProgression] = useState<{
    eligible_teams_count: number;
    completed_teams_count: number;
    qualified_teams_count: number;
    all_completed: boolean;
    qualification_score: number;
    current_level: number;
    round_status: string;
    session_status: string;
  } | null>(null);

  const fetchProgression = async () => {
    try {
      const res = await apiFetch<any>('/api/admin/progression');
      setProgression(res);
    } catch (err) {
      console.error('Failed to fetch progression:', err);
    }
  };

  const fetchState = async () => {
    try {
      const [res] = await Promise.all([
        apiFetch<PublicGameState>('/api/game/state'),
        fetchProgression()
      ]);
      setGameState(res);
    } catch (err) {
      console.error('Failed to fetch game state:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    const socket = getSocket();

    const onStateChanged = (state: PublicGameState) => {
      setGameState(state);
      fetchProgression();
    };
    const onProgressEvent = () => fetchProgression();

    socket.on('game:state_changed', onStateChanged);
    socket.on('round:started', onProgressEvent);
    socket.on('round:ended', onProgressEvent);
    socket.on('team:score_updated', onProgressEvent);
    socket.on('team:registered', onProgressEvent);

    return () => {
      socket.off('game:state_changed', onStateChanged);
      socket.off('round:started', onProgressEvent);
      socket.off('round:ended', onProgressEvent);
      socket.off('team:score_updated', onProgressEvent);
      socket.off('team:registered', onProgressEvent);
    };
  }, []);

  const executeControl = async (action: string, level?: number) => {
    setActionInProgress(action);
    setFeedback(null);
    try {
      const res = await apiFetch<{ success: boolean; message: string }>('/api/admin/controls', {
        method: 'POST',
        body: JSON.stringify({ action, level })
      });
      setFeedback({ message: res.message });
      await fetchState();
    } catch (err: any) {
      setFeedback({ message: err.message || 'Operation failed.', isError: true });
    } finally {
      setActionInProgress(null);
    }
  };

  if (isLoading || !gameState) {
    return (
      <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[50vh]">
        Connecting to authoritative game controller...
      </div>
    );
  }

  const { status, round } = gameState;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-heading font-bold text-[#171717]">
          Live Authoritative Game Control
        </h1>
        <p className="text-xs text-[#737373] font-mono mt-1">
          Synchronous commands broadcast instantly to all connected participant terminals over LAN.
        </p>
      </div>

      {/* Current Authoritative State Card */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-[11px] font-mono text-[#737373] uppercase tracking-wider font-bold">
              AUTHORITATIVE GAME STATUS
            </span>
            <div className="text-2xl font-heading font-bold text-[#171717] flex items-center gap-3">
              <span>{status.toUpperCase()}</span>
            </div>
          </div>

          {round && (
            <div className="flex items-center gap-3">
              <CountdownTimer
                deadlineAt={round.deadline_at}
                isPaused={round.is_paused}
                remainingSeconds={round.remaining_seconds}
              />
            </div>
          )}
        </div>

        {feedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
              feedback.isError
                ? 'bg-[#B42318]/5 border-[#B42318]/20 text-[#B42318]'
                : 'bg-[#18794E]/5 border-[#18794E]/20 text-[#18794E]'
            }`}
          >
            {feedback.isError ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
        )}
      </div>

      {/* Level 1 Progression & Automatic Advance Monitor */}
      {progression && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E5E5E5] pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#737373] font-bold">
                LEVEL 1 COMPLETION &amp; AUTOMATIC ADVANCE MONITOR
              </span>
              <h2 className="text-base font-heading font-bold text-[#171717]">
                Progression Telemetry
              </h2>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-mono font-bold border ${
              progression.all_completed
                ? 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/30'
                : 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]'
            }`}>
              {progression.all_completed
                ? 'All eligible teams completed — Level 2 Ready'
                : `Waiting for teams (${progression.completed_teams_count}/${progression.eligible_teams_count})`}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div className="p-3 bg-[#F5F5F2] rounded-xl border border-[#E5E5E5]">
              <span className="text-[10px] font-mono text-[#737373] uppercase">Eligible Teams</span>
              <div className="text-xl font-heading font-bold text-[#171717] mt-0.5">
                {progression.eligible_teams_count}
              </div>
            </div>
            <div className="p-3 bg-[#F5F5F2] rounded-xl border border-[#E5E5E5]">
              <span className="text-[10px] font-mono text-[#737373] uppercase">Completed L1</span>
              <div className="text-xl font-heading font-bold text-[#18794E] mt-0.5">
                {progression.completed_teams_count}
              </div>
            </div>
            <div className="p-3 bg-[#F5F5F2] rounded-xl border border-[#E5E5E5]">
              <span className="text-[10px] font-mono text-[#737373] uppercase">Qualified for L2</span>
              <div className="text-xl font-heading font-bold text-[#B34400] mt-0.5">
                {progression.qualified_teams_count}
              </div>
            </div>
            <div className="p-3 bg-[#F5F5F2] rounded-xl border border-[#E5E5E5]">
              <span className="text-[10px] font-mono text-[#737373] uppercase">Qualification Cutoff</span>
              <div className="text-xl font-heading font-bold text-[#171717] mt-0.5">
                {progression.qualification_score} pts
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Primary Authoritative Event Controls */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
        <div>
          <span className="text-[10px] font-mono text-[#737373] uppercase tracking-wider font-bold">
            EVENT LIFECYCLE MANAGEMENT
          </span>
          <h2 className="text-lg font-heading font-bold text-[#171717]">
            Primary Event Controls
          </h2>
          <p className="text-xs text-[#737373] mt-0.5">
            Level 1 to Level 2 progression advances automatically when all eligible teams complete Level 1.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Action 1: START EVENT */}
          <div className="bg-[#F5F5F2] border border-[#E5E5E5] rounded-xl p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-md bg-[#FFC928] text-[#171717] font-bold text-xs flex items-center justify-center font-mono">
                  1
                </span>
                <h3 className="font-heading font-bold text-sm text-[#171717]">
                  START EVENT
                </h3>
              </div>
              <p className="text-xs text-[#737373] leading-relaxed">
                Initializes tournament timers, opens participant access, and starts Level 1.
              </p>
            </div>

            {status === 'idle' ? (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => executeControl('start_event')}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                {actionInProgress === 'start_event' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                ) : (
                  <Play className="w-4 h-4 fill-[#171717]" />
                )}
                <span>START EVENT</span>
              </button>
            ) : (
              <div className="p-2.5 rounded-lg bg-white border border-[#E5E5E5] text-xs font-mono text-[#737373] text-center flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#18794E]" />
                <span>Event Already Started</span>
              </div>
            )}
          </div>

          {/* Action 2: STOP EVENT */}
          <div className="bg-[#F5F5F2] border border-[#E5E5E5] rounded-xl p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-md bg-[#171717] text-white font-bold text-xs flex items-center justify-center font-mono">
                  2
                </span>
                <h3 className="font-heading font-bold text-sm text-[#171717]">
                  STOP EVENT
                </h3>
              </div>
              <p className="text-xs text-[#737373] leading-relaxed">
                Halt active timers, lock all answer submissions and clue purchases. Data and scores are safely preserved.
              </p>
            </div>

            {status !== 'idle' && status !== 'completed' ? (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => {
                  setConfirmConfig({
                    isOpen: true,
                    title: 'Stop Active Tournament Event?',
                    message: 'This halts active timers and locks all further submissions and clue purchases. All historical submissions, scores, credit records, and team answers are safely preserved. Results will NOT be automatically published.',
                    isDestructive: true,
                    confirmLabel: 'Stop Event Now',
                    action: async () => executeControl('stop_event')
                  });
                }}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#B42318] bg-[#B42318]/10 hover:bg-[#B42318]/20 border border-[#B42318]/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {actionInProgress === 'stop_event' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#B42318]" />
                ) : (
                  <StopCircle className="w-4 h-4 text-[#B42318]" />
                )}
                <span>STOP EVENT</span>
              </button>
            ) : status === 'completed' ? (
              <div className="p-2.5 rounded-lg bg-white border border-[#E5E5E5] text-xs font-mono text-[#737373] text-center flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#18794E]" />
                <span>Event Stopped / Completed</span>
              </div>
            ) : (
              <div className="p-2.5 rounded-lg bg-white border border-[#E5E5E5] text-xs font-mono text-[#737373] text-center">
                Awaiting Event Start
              </div>
            )}
          </div>

          {/* Action 3: PUBLISH FINAL RESULTS */}
          <div className="bg-[#F5F5F2] border border-[#E5E5E5] rounded-xl p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-6 h-6 rounded-md bg-[#18794E] text-white font-bold text-xs flex items-center justify-center font-mono">
                  3
                </span>
                <h3 className="font-heading font-bold text-sm text-[#171717]">
                  PUBLISH FINAL RESULTS
                </h3>
              </div>
              <p className="text-xs text-[#737373] leading-relaxed">
                Calculates authoritative scores and publishes official standings to connected terminals.
              </p>
            </div>

            {gameState.settings.resultsPublished ? (
              <div className="p-2.5 rounded-lg bg-[#18794E]/10 border border-[#18794E]/30 text-xs font-mono text-[#18794E] font-bold text-center flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Official Results Published</span>
              </div>
            ) : status === 'completed' || status === 'level2_ended' || status === 'level1_ended' ? (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => {
                  setConfirmConfig({
                    isOpen: true,
                    title: 'Publish Official Final Results?',
                    message: 'Authoritative final scores out of 40 will be calculated and persisted. Official standings will be unlocked and broadcast live to all participant terminals.',
                    isDestructive: false,
                    confirmLabel: 'Publish Final Results',
                    action: async () => executeControl('publish_results')
                  });
                }}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#18794E] bg-[#18794E]/10 hover:bg-[#18794E]/20 border border-[#18794E]/40 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {actionInProgress === 'publish_results' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#18794E]" />
                ) : (
                  <Trophy className="w-4 h-4 text-[#18794E]" />
                )}
                <span>PUBLISH FINAL RESULTS</span>
              </button>
            ) : (
              <div className="p-2.5 rounded-lg bg-white border border-[#E5E5E5] text-xs font-mono text-[#737373] text-center">
                Available once event is stopped
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Administrative Recovery (Protected Reset) */}
      <div className="bg-[#FFFFFF] border border-[#B42318]/20 rounded-2xl p-6 sm:p-7 space-y-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#B42318]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="text-[11px] font-mono uppercase tracking-wider font-bold">
                ADMINISTRATIVE RECOVERY
              </span>
            </div>
            <h3 className="text-base font-heading font-bold text-[#171717] mt-0.5">
              Reset Tournament Game
            </h3>
            <p className="text-xs text-[#737373] mt-1 max-w-xl">
              Use strictly for emergency administrative recovery or initializing a completely new tournament session.
              Resetting archives the current session and creates a fresh idle session. Historical submissions and questions remain safe.
              This must never be confused with stopping an active event.
            </p>
          </div>

          <button
            type="button"
            disabled={actionInProgress !== null}
            onClick={() => {
              setConfirmConfig({
                isOpen: true,
                title: 'Reset Tournament Session?',
                message: 'This will archive the current tournament session and create a fresh idle session. Registered teams, submissions, questions, and historical audit logs will remain safe in historical records.',
                isDestructive: true,
                confirmLabel: 'Confirm Reset Tournament',
                action: async () => executeControl('reset_game')
              });
            }}
            className="py-3 px-5 rounded-xl border border-[#B42318]/30 bg-[#B42318]/10 hover:bg-[#B42318]/20 text-[#B42318] font-heading font-bold text-xs tracking-wider uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
            <span>RESET TOURNAMENT GAME</span>
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isDestructive={confirmConfig.isDestructive}
        confirmLabel={confirmConfig.confirmLabel}
        onCancel={() => setConfirmConfig((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={async () => {
          setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
          await confirmConfig.action();
        }}
      />
    </div>
  );
};

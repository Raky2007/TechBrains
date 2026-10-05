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

  const fetchState = async () => {
    try {
      const res = await apiFetch<PublicGameState>('/api/game/state');
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

    const onStateChanged = (state: PublicGameState) => setGameState(state);
    socket.on('game:state_changed', onStateChanged);
    return () => {
      socket.off('game:state_changed', onStateChanged);
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
              <span className="w-3 h-3 rounded-full bg-[#18794E] animate-pulse" />
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

      {/* Controls Container */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Level 1 Control Box */}
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-6 space-y-5 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#FFC928] text-[#171717] flex items-center justify-center font-bold text-xs">
                L1
              </div>
              <h2 className="font-heading font-bold text-[#171717]">
                Level 1: AI vs Human
              </h2>
            </div>
            <span className="text-xs font-mono text-[#737373]">
              Duration: {gameState.settings.level1DurationMinutes} min
            </span>
          </div>

          <div className="space-y-3">
            {/* Start L1 */}
            {status === 'idle' && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => executeControl('start', 1)}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                {actionInProgress === 'start' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                ) : (
                  <Play className="w-4 h-4 fill-[#171717]" />
                )}
                <span>START LEVEL 1 ROUND</span>
              </button>
            )}

            {/* Pause L1 */}
            {status === 'level1_active' && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => executeControl('pause', 1)}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#FF8A24] bg-[#FFF0D6] border border-[#FF8A24]/40 hover:bg-[#ffe5b8] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Pause className="w-4 h-4" />
                <span>PAUSE LEVEL 1 TIMER</span>
              </button>
            )}

            {/* Resume L1 */}
            {status === 'level1_paused' && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => executeControl('resume', 1)}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-[#171717]" />
                <span>RESUME LEVEL 1 TIMER</span>
              </button>
            )}

            {/* End L1 */}
            {(status === 'level1_active' || status === 'level1_paused') && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => {
                  setConfirmConfig({
                    isOpen: true,
                    title: 'End Level 1 Early?',
                    message: 'Ending the round early will immediately lock submissions and evaluate all registered teams.',
                    isDestructive: true,
                    confirmLabel: 'End Level 1 Now',
                    action: async () => executeControl('end', 1)
                  });
                }}
                className="w-full py-2.5 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#B42318] hover:bg-[#B42318]/10 border border-[#B42318]/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <StopCircle className="w-4 h-4" />
                <span>END LEVEL 1 ROUND</span>
              </button>
            )}

            {status !== 'idle' &&
              status !== 'level1_active' &&
              status !== 'level1_paused' && (
                <div className="p-3 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] text-xs font-mono text-[#737373] text-center">
                  Level 1 completed and locked.
                </div>
              )}
          </div>
        </div>

        {/* Level 2 Control Box */}
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-6 space-y-5 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] flex items-center justify-center font-bold text-xs">
                L2
              </div>
              <h2 className="font-heading font-bold text-[#171717]">
                Level 2: Clues & Credits
              </h2>
            </div>
            <span className="text-xs font-mono text-[#737373]">
              Duration: {gameState.settings.level2DurationMinutes} min
            </span>
          </div>

          <div className="space-y-3">
            {/* Start L2 */}
            {status === 'level1_ended' && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => executeControl('start', 2)}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                {actionInProgress === 'start' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                ) : (
                  <Play className="w-4 h-4 fill-[#171717]" />
                )}
                <span>START LEVEL 2 ROUND</span>
              </button>
            )}

            {/* Pause L2 */}
            {status === 'level2_active' && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => executeControl('pause', 2)}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#FF8A24] bg-[#FFF0D6] border border-[#FF8A24]/40 hover:bg-[#ffe5b8] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Pause className="w-4 h-4" />
                <span>PAUSE LEVEL 2 TIMER</span>
              </button>
            )}

            {/* Resume L2 */}
            {status === 'level2_paused' && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => executeControl('resume', 2)}
                className="w-full py-3 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-[#171717]" />
                <span>RESUME LEVEL 2 TIMER</span>
              </button>
            )}

            {/* End L2 */}
            {(status === 'level2_active' || status === 'level2_paused') && (
              <button
                type="button"
                disabled={actionInProgress !== null}
                onClick={() => {
                  setConfirmConfig({
                    isOpen: true,
                    title: 'End Level 2 Early?',
                    message: 'Ending the round early will lock further clue purchases and conclusions.',
                    isDestructive: true,
                    confirmLabel: 'End Level 2 Now',
                    action: async () => executeControl('end', 2)
                  });
                }}
                className="w-full py-2.5 px-4 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#B42318] hover:bg-[#B42318]/10 border border-[#B42318]/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <StopCircle className="w-4 h-4" />
                <span>END LEVEL 2 ROUND</span>
              </button>
            )}

            {status !== 'level1_ended' &&
              status !== 'level2_active' &&
              status !== 'level2_paused' && (
                <div className="p-3 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] text-xs font-mono text-[#737373] text-center">
                  {status === 'idle'
                    ? 'Awaiting Level 1 completion first.'
                    : 'Level 2 concluded.'}
                </div>
              )}
          </div>
        </div>
      </div>

      {/* Post-Game Operations: Results Publishing & Reset */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
        <h2 className="text-sm font-heading font-bold text-[#171717] uppercase tracking-wider">
          Tournament Resolution & Reset
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Publish Results: Success green #18794E */}
          <button
            type="button"
            disabled={actionInProgress !== null}
            onClick={() => {
              setConfirmConfig({
                isOpen: true,
                title: 'Publish Official Results?',
                message: 'This will broadcast the final leaderboard with rankings to all participant screens over LAN.',
                isDestructive: false,
                confirmLabel: 'Publish Standings',
                action: async () => executeControl('publish_results')
              });
            }}
            className="p-4 rounded-xl border border-[#18794E]/40 bg-[#18794E]/10 hover:bg-[#18794E]/20 text-[#18794E] font-heading font-bold text-xs tracking-wider uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Trophy className="w-4 h-4" />
            <span>PUBLISH FINAL RESULTS</span>
          </button>

          {/* Reset Tournament Session: Error red #B42318 */}
          <button
            type="button"
            disabled={actionInProgress !== null}
            onClick={() => {
              setConfirmConfig({
                isOpen: true,
                title: 'Reset Tournament Session?',
                message: 'This will archive the current tournament session and create a fresh idle session. Historical logs and questions remain safe.',
                isDestructive: true,
                confirmLabel: 'Reset Session Now',
                action: async () => executeControl('reset_game')
              });
            }}
            className="p-4 rounded-xl border border-[#B42318]/30 bg-[#B42318]/10 hover:bg-[#B42318]/20 text-[#B42318] font-heading font-bold text-xs tracking-wider uppercase transition-colors flex items-center justify-center gap-2 cursor-pointer"
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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTeam } from '../layouts/TeamLayout';
import { CountdownTimer } from '../components/CountdownTimer';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { ClientClue, TeamPrivateState } from '@nexus/shared';
import {
  Coins,
  Lock,
  Unlock,
  AlertCircle,
  CheckCircle2,
  Send,
  Loader2,
  Eye,
  EyeOff,
  RotateCcw,
  Film
} from 'lucide-react';

type Level2State = NonNullable<TeamPrivateState['level2']>;

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const Level2GamePage: React.FC = () => {
  const { team, gameState, refreshTeam, refreshGameState } = useTeam();

  const [level2State, setLevel2State] = useState<Level2State | null>(null);
  const [conclusionText, setConclusionText] = useState<string>('');
  const [isUnlockingClueId, setIsUnlockingClueId] = useState<string | null>(null);
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [isSubmittingConclusion, setIsSubmittingConclusion] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const clueOpIds = useRef<Map<string, string>>(new Map());

  const loadProgress = useCallback(async () => {
    try {
      const res = await apiFetch<TeamPrivateState>('/api/game/team-state');
      setLevel2State(res.level2 || null);
      if (res.level2?.conclusion?.text) {
        setConclusionText(res.level2.conclusion.text);
      }
    } catch (err: any) {
      console.error('Failed to load Level 2 state:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProgress();

    const socket = getSocket();
    const handleRoundEnded = () => {
      refreshGameState();
      loadProgress();
    };
    const handlePrivateUpdate = (state: TeamPrivateState) => {
      setLevel2State(state.level2 || null);
    };

    socket.on('round:ended', handleRoundEnded);
    socket.on('team:private_updated', handlePrivateUpdate);
    return () => {
      socket.off('round:ended', handleRoundEnded);
      socket.off('team:private_updated', handlePrivateUpdate);
    };
  }, [loadProgress, refreshGameState]);

  // Local 1s tick to drive the media viewing countdown and flip to hidden when it elapses.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const media = level2State?.media;
  const viewingEndsMs = media?.viewing_ends_at ? new Date(media.viewing_ends_at).getTime() : null;
  const viewingSecondsLeft = viewingEndsMs ? Math.max(0, Math.round((viewingEndsMs - nowTick) / 1000)) : 0;

  // When the viewing window elapses locally, refetch to get the authoritative hidden state.
  const prevVisibleRef = useRef<boolean>(false);
  useEffect(() => {
    const visible = !!media?.is_visible;
    if (prevVisibleRef.current && visible && viewingSecondsLeft === 0) {
      loadProgress();
    }
    prevVisibleRef.current = visible;
  }, [viewingSecondsLeft, media?.is_visible, loadProgress]);

  const activeCase = level2State?.case;
  const clues = level2State?.clues || [];
  const conclusion = level2State?.conclusion;
  const isLocked = level2State?.is_locked || false;
  const isSubmitted = conclusion?.status === 'submitted' || isLocked;
  const isRoundEnded = gameState?.status === 'level2_ended' || gameState?.status === 'completed';
  const disabledByState = isSubmitted || isRoundEnded;

  const handleReplay = async () => {
    if (isReplaying || disabledByState || !media) return;
    if ((team?.current_credits ?? 0) < media.replay_cost) {
      setError(`Insufficient credits. Replay costs ${media.replay_cost}, you have ${team?.current_credits ?? 0}.`);
      return;
    }
    setIsReplaying(true);
    setError(null);
    try {
      // One idempotency key per deliberate replay action (prevents double-charge on retry).
      const operation_id = newOperationId();
      const res = await apiFetch<{ credits_spent: number; already_visible: boolean }>('/api/game/level2/replay', {
        method: 'POST',
        body: JSON.stringify({ operation_id })
      });
      if (res.credits_spent > 0) {
        setSuccessMessage(`Media replayed (-${res.credits_spent} CR)`);
      } else if (res.already_visible) {
        setSuccessMessage('Media is already visible.');
      }
      setTimeout(() => setSuccessMessage(null), 2500);
      await refreshTeam();
      await loadProgress();
    } catch (err: any) {
      setError(err.message || 'Failed to replay media.');
    } finally {
      setIsReplaying(false);
    }
  };

  const handleUnlockClue = async (clue: ClientClue) => {
    if (clue.is_unlocked || disabledByState) return;
    if ((team?.current_credits ?? 0) < clue.credit_cost) {
      setError(`Insufficient credits. You need ${clue.credit_cost} credits, but have ${team?.current_credits ?? 0}.`);
      return;
    }

    setIsUnlockingClueId(clue.id);
    setError(null);

    try {
      // Stable idempotency key per clue so refresh/retry never double-charges.
      let operation_id = clueOpIds.current.get(clue.id);
      if (!operation_id) {
        operation_id = newOperationId();
        clueOpIds.current.set(clue.id, operation_id);
      }
      const res = await apiFetch<{
        success: boolean;
        clue: ClientClue;
        credits_spent: number;
        remaining_credits: number;
      }>('/api/game/level2/unlock-clue', {
        method: 'POST',
        body: JSON.stringify({ clue_id: clue.id, operation_id })
      });

      setSuccessMessage(`Unlocked "${res.clue.title}" (-${res.credits_spent} CR)`);
      setTimeout(() => setSuccessMessage(null), 3000);

      await refreshTeam();
      await loadProgress();
    } catch (err: any) {
      setError(err.message || 'Failed to unlock clue.');
    } finally {
      setIsUnlockingClueId(null);
    }
  };

  const handleSubmitConclusion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingConclusion || isSubmitted) return;

    if (conclusionText.trim().length < 10) {
      setError('Your conclusion analysis must be at least 10 characters long.');
      return;
    }

    // Strong irreversible-submission warning.
    const confirmed = window.confirm(
      'Your final answer can only be submitted ONCE and CANNOT be changed.\n\n' +
      'After submitting you will not be able to replay media, purchase clues, or edit your answer.\n\n' +
      'Submit your final answer now?'
    );
    if (!confirmed) return;

    setIsSubmittingConclusion(true);
    setError(null);

    try {
      await apiFetch('/api/game/level2/conclusion', {
        method: 'POST',
        body: JSON.stringify({ conclusion_text: conclusionText.trim() })
      });

      setSuccessMessage('Final answer submitted. Your submission is now locked.');
      setTimeout(() => setSuccessMessage(null), 4000);
      await loadProgress();
    } catch (err: any) {
      setError(err.message || 'Failed to submit conclusion.');
    } finally {
      setIsSubmittingConclusion(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 font-mono text-[#737373] text-sm">
        <Loader2 className="w-7 h-7 animate-spin text-[#171717]" />
        <span>Loading case dossier...</span>
      </div>
    );
  }

  const canAffordReplay = (team?.current_credits ?? 0) >= (media?.replay_cost ?? 0);

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E5E5E5]">
        <div className="space-y-1">
          <span className="text-[11px] font-mono text-[#B34400] font-bold uppercase tracking-wider">
            ROUND 2 — CASE INVESTIGATION
          </span>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-[#171717]">
            {activeCase?.title || 'Case Investigation'}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#FFF0D6] border border-[#FED7AA] font-mono shadow-2xs">
            <Coins className="w-4 h-4 text-[#B34400]" />
            <span className="text-xs text-[#737373]">Credits:</span>
            <span className="text-sm font-bold text-[#B34400]">{team?.current_credits ?? 0}</span>
          </div>
          <CountdownTimer
            deadlineAt={gameState?.round?.deadline_at || null}
            isPaused={gameState?.round?.is_paused || false}
            remainingSeconds={gameState?.round?.remaining_seconds || 0}
          />
        </div>
      </div>

      {/* Locked banner */}
      {isSubmitted && (
        <div className="p-4 rounded-xl bg-[#171717] text-white flex items-center gap-3">
          <Lock className="w-5 h-5 shrink-0" />
          <div>
            <div className="font-heading font-bold text-sm">FINAL ANSWER LOCKED</div>
            <div className="text-xs text-white/70">
              Your submission is final. Replay, clue purchases, and editing are disabled.
            </div>
          </div>
        </div>
      )}

      {/* Notifications */}
      {error && (
        <div className="p-3.5 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] flex items-center gap-2.5 text-xs font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div className="p-3.5 rounded-xl bg-[#18794E]/5 border border-[#18794E]/20 text-[#18794E] flex items-center gap-2.5 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Case Situation Dossier */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-[#171717] tracking-wider uppercase">
            INCIDENT DOSSIER & SITUATION
          </span>
          <span className="text-xs font-mono text-[#737373]">
            INITIAL ALLOCATION: {activeCase?.initial_credits ?? 0} CR
          </span>
        </div>
        <p className="text-sm text-[#171717] leading-relaxed whitespace-pre-wrap font-body">
          {activeCase?.situation_description}
        </p>
      </div>

      {/* Case Media Lifecycle */}
      {media && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-4 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-[#171717]" />
              <span className="text-xs font-heading font-bold text-[#171717] tracking-wider uppercase">
                CASE MEDIA
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-[#737373]">
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Replays used: {media.replay_count}</span>
            </div>
          </div>

          {media.is_visible ? (
            <>
              <div className="flex items-center gap-2 text-xs font-mono text-[#18794E]">
                <Eye className="w-4 h-4" />
                <span>
                  {media.initial_window_elapsed ? 'Replay window' : 'Initial viewing'} — visible for{' '}
                  <span className="font-bold">{viewingSecondsLeft}s</span>
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {media.items.length === 0 && (
                  <div className="text-xs font-mono text-[#737373] italic">No media attached to this case.</div>
                )}
                {media.items.map((m) => (
                  <div key={m.id} className="rounded-xl overflow-hidden border border-[#E5E5E5] bg-[#F5F5F2] p-2">
                    {m.media_type === 'image' && (
                      <img src={m.media_path} alt={m.caption || 'Case media'} className="max-h-96 w-full object-contain rounded-lg" />
                    )}
                    {m.media_type === 'video' && (
                      <video src={m.media_path} controls className="max-h-96 w-full object-contain rounded-lg" />
                    )}
                    {m.media_type === 'audio' && (
                      <audio src={m.media_path} controls className="w-full" />
                    )}
                    {m.caption && <div className="text-[11px] font-mono text-[#737373] mt-1 px-1">{m.caption}</div>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-[#E5E5E5] bg-[#F5F5F2] p-6 flex flex-col items-center justify-center gap-3 text-center">
              <EyeOff className="w-8 h-8 text-[#A3A3A3]" />
              <div className="space-y-1">
                <div className="text-sm font-heading font-bold text-[#171717]">Case media is hidden</div>
                <div className="text-xs text-[#737373]">
                  {isSubmitted
                    ? 'Replay is unavailable after your final submission.'
                    : `The initial viewing period has ended. Replay for ${media.replay_cost} credits.`}
                </div>
              </div>
              {!isSubmitted && (
                <button
                  type="button"
                  disabled={isReplaying || !canAffordReplay || disabledByState}
                  onClick={handleReplay}
                  className={`px-4 py-2 rounded-lg font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    canAffordReplay
                      ? 'bg-[#FF8A24] hover:bg-[#F27D16] text-white shadow-2xs'
                      : 'bg-[#FFFFFF] text-[#A3A3A3] border border-[#E5E5E5] cursor-not-allowed'
                  }`}
                >
                  {isReplaying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  <span>REPLAY MEDIA ({media.replay_cost} CR)</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Clues (TEXT ONLY) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-heading font-bold text-[#171717]">Available Clues</h2>
            <p className="text-xs text-[#737373]">
              Unlock clues using your credits. Each clue unlocks permanently for your team.
            </p>
          </div>
          <span className="text-xs font-mono text-[#737373]">
            {clues.filter((c) => c.is_unlocked).length} of {clues.length} Unlocked
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {clues.map((clue) => {
            const isUnlocked = clue.is_unlocked;
            const canAfford = (team?.current_credits ?? 0) >= clue.credit_cost;

            return (
              <div
                key={clue.id}
                className={`rounded-xl border p-5 transition-all ${
                  isUnlocked ? 'bg-[#FFFFFF] border-[#171717] shadow-sm' : 'bg-[#FFFFFF] border-[#E5E5E5]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        isUnlocked ? 'bg-[#18794E]/10 text-[#18794E]' : 'bg-[#F5F5F2] text-[#737373]'
                      }`}
                    >
                      {isUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-heading font-bold text-[#171717]">{clue.title}</h3>
                      <div className="text-[11px] font-mono text-[#737373]">
                        {isUnlocked ? 'UNLOCKED' : `COST: ${clue.credit_cost} CR`}
                      </div>
                    </div>
                  </div>

                  {!isUnlocked && (
                    <button
                      type="button"
                      disabled={!canAfford || isUnlockingClueId === clue.id || disabledByState}
                      onClick={() => handleUnlockClue(clue)}
                      className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                        canAfford && !disabledByState
                          ? 'bg-[#FF8A24] hover:bg-[#F27D16] text-white shadow-2xs'
                          : 'bg-[#F5F5F2] text-[#A3A3A3] border border-[#E5E5E5] cursor-not-allowed'
                      }`}
                    >
                      {isUnlockingClueId === clue.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Coins className="w-3.5 h-3.5" />
                      )}
                      <span>UNLOCK</span>
                    </button>
                  )}
                </div>

                {isUnlocked && (
                  <div className="mt-4 pt-3.5 border-t border-[#E5E5E5]">
                    <p className="text-xs sm:text-sm text-[#171717] leading-relaxed font-body whitespace-pre-wrap bg-[#F5F5F2] p-3 rounded-lg border border-[#E5E5E5]">
                      {clue.content}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Final Answer */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-heading font-bold text-[#171717]">Final Answer</h2>
            <p className="text-xs text-[#737373]">
              Submit exactly one final conclusion. This action is irreversible.
            </p>
          </div>
          {isSubmitted && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#18794E]/10 text-[#18794E] border border-[#18794E]/20 font-mono text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>SUBMITTED</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmitConclusion} className="space-y-4">
          <textarea
            rows={6}
            disabled={disabledByState || isSubmittingConclusion}
            value={conclusionText}
            onChange={(e) => setConclusionText(e.target.value)}
            placeholder="Explain your conclusion. Reference the clues and evidence that support your reasoning."
            className="w-full p-4 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] placeholder-[#A3A3A3] font-body text-sm focus:outline-none focus:border-[#171717] transition-colors leading-relaxed disabled:opacity-75 disabled:cursor-not-allowed"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <span className="text-xs font-mono text-[#737373]">Characters: {conclusionText.length}</span>
            {!isSubmitted && (
              <button
                type="submit"
                disabled={isSubmittingConclusion || isRoundEnded || conclusionText.trim().length < 10}
                className="px-7 py-3 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                {isSubmittingConclusion ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                    <span>SUBMITTING...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>SUBMIT FINAL ANSWER</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>

        {/* Evaluation result (TechBrains: score / verdict / reasoning) */}
        {level2State?.evaluation && level2State.evaluation.status === 'completed' && (
          <div className="mt-6 p-5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">
                EVALUATION RESULT {level2State.evaluation.is_overridden ? '(ADMIN OVERRIDE)' : ''}
              </span>
              <span className="text-base font-mono font-bold text-[#171717]">
                Score: {level2State.evaluation.score ?? 0} / {level2State.evaluation.max_score}
              </span>
            </div>
            {level2State.evaluation.verdict && (
              <div className="text-sm font-heading font-bold text-[#171717]">
                Verdict: {level2State.evaluation.verdict}
              </div>
            )}
            {level2State.evaluation.reasoning && (
              <p className="text-xs text-[#737373] italic pt-2 border-t border-[#E5E5E5] whitespace-pre-wrap">
                {level2State.evaluation.reasoning}
              </p>
            )}
          </div>
        )}
        {level2State?.evaluation && level2State.evaluation.status === 'pending' && (
          <div className="mt-4 text-xs font-mono text-[#737373] flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Evaluation in progress...
          </div>
        )}
      </div>
    </div>
  );
};

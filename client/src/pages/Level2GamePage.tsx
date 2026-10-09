import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTeam } from '../layouts/TeamLayout';
import { CountdownTimer } from '../components/CountdownTimer';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { getStoredConclusionDraft, setStoredConclusionDraft, removeStoredConclusionDraft } from '../lib/storage';
import { ClientClue, TeamPrivateState } from '@nexus/shared';
import {
  Coins,
  Lock,
  AlertCircle,
  CheckCircle2,
  Send,
  Loader2,
  EyeOff,
  RotateCcw,
  ShieldAlert
} from 'lucide-react';

type Level2State = NonNullable<TeamPrivateState['level2']>;

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const Level2GamePage: React.FC = () => {
  const { team, gameState, refreshTeam } = useTeam();

  const [level2State, setLevel2State] = useState<Level2State | null>(null);
  const [qualified, setQualified] = useState<boolean | null>(null);
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
      // Qualification is server-authoritative: undefined (field absent) is
      // treated as allowed; an explicit false blocks Round 2 entirely.
      setQualified(res.round2_qualified === false ? false : true);
      setLevel2State(res.level2 || null);
      if (res.level2?.conclusion?.text) {
        setConclusionText(res.level2.conclusion.text);
        if (team?.id) removeStoredConclusionDraft(team.id, gameState?.session_id);
      } else if (team?.id) {
        const draft = getStoredConclusionDraft(team.id, gameState?.session_id);
        if (draft) {
          setConclusionText(draft);
        }
      }
    } catch (err: any) {
      console.error('Failed to load Level 2 state:', err);
    } finally {
      setIsLoading(false);
    }
  }, [team?.id, gameState?.session_id]);

  useEffect(() => {
    loadProgress();
    const socket = getSocket();
    const handleRoundEnded = () => loadProgress();
    const handlePrivateUpdate = (state: TeamPrivateState) => {
      setQualified(state.round2_qualified === false ? false : true);
      setLevel2State(state.level2 || null);
    };
    socket.on('round:ended', handleRoundEnded);
    socket.on('team:private_updated', handlePrivateUpdate);
    return () => {
      socket.off('round:ended', handleRoundEnded);
      socket.off('team:private_updated', handlePrivateUpdate);
    };
  }, [loadProgress]);

  // Local 1s tick to drive the media viewing countdown.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const media = level2State?.media;
  const viewingEndsMs = media?.viewing_ends_at ? new Date(media.viewing_ends_at).getTime() : null;
  const viewingSecondsLeft = viewingEndsMs ? Math.max(0, Math.round((viewingEndsMs - nowTick) / 1000)) : 0;

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
      const operation_id = newOperationId();
      const res = await apiFetch<{ credits_spent: number; already_visible: boolean }>('/api/game/level2/replay', {
        method: 'POST',
        body: JSON.stringify({ operation_id })
      });
      if (res.credits_spent > 0) setSuccessMessage(`Media replayed (-${res.credits_spent} CR)`);
      else if (res.already_visible) setSuccessMessage('Media is already visible.');
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
      setError(`Insufficient credits. You need ${clue.credit_cost}, but have ${team?.current_credits ?? 0}.`);
      return;
    }
    setIsUnlockingClueId(clue.id);
    setError(null);
    try {
      let operation_id = clueOpIds.current.get(clue.id);
      if (!operation_id) {
        operation_id = newOperationId();
        clueOpIds.current.set(clue.id, operation_id);
      }
      const res = await apiFetch<{ clue: ClientClue; credits_spent: number }>('/api/game/level2/unlock-clue', {
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
      setError('Your final answer must be at least 10 characters long.');
      return;
    }
    const confirmed = window.confirm(
      'Your final answer can only be submitted ONCE and CANNOT be changed.\n\n' +
        'After submitting you cannot replay media, purchase clues, or edit your answer.\n\n' +
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
      if (team?.id) {
        removeStoredConclusionDraft(team.id, gameState?.session_id);
      }
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
        <span>Loading case…</span>
      </div>
    );
  }

  // Server-authoritative Round 1 cutoff: unqualified teams get no case data and
  // see a clear message (every Round 2 action is also rejected server-side).
  if (qualified === false) {
    return (
      <div className="max-w-md mx-auto my-16 bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-[#F5F5F2] border border-[#E5E5E5] text-[#737373] mx-auto flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-heading font-bold text-[#171717]">Round 2 Not Available</h2>
        <p className="text-xs text-[#737373] leading-relaxed">
          Your team did not meet the Round 1 qualification cutoff, so Round 2 is not available for your team. Thank you for
          competing in Round 1 — please wait for the final results.
        </p>
      </div>
    );
  }

  const canAffordReplay = (team?.current_credits ?? 0) >= (media?.replay_cost ?? 0);
  const unlockedCount = clues.filter((c) => c.is_unlocked).length;

  return (
    <div className="mx-auto w-full max-w-7xl flex flex-col gap-3 lg:h-[calc(100vh-6.5rem)]">
      {/* Compact header: round label + case title | credits + timer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5] shrink-0">
        <div className="min-w-0">
          <span className="text-[11px] font-mono text-[#B34400] font-bold uppercase tracking-wider">ROUND 2 — CASE INVESTIGATION</span>
          <h1 className="text-lg sm:text-xl font-heading font-bold text-[#171717] truncate">
            {activeCase?.title || 'Case Investigation'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FFF0D6] border border-[#FED7AA] font-mono">
            <Coins className="w-4 h-4 text-[#B34400]" />
            <span className="text-sm font-bold text-[#B34400]">{team?.current_credits ?? 0}</span>
            <span className="text-[10px] uppercase text-[#B34400]/80 font-semibold">CR</span>
          </div>
          <CountdownTimer
            deadlineAt={gameState?.round?.deadline_at || null}
            isPaused={gameState?.round?.is_paused || false}
            remainingSeconds={gameState?.round?.remaining_seconds || 0}
          />
        </div>
      </div>

      {/* Notifications (compact, non-reserving) */}
      {(error || successMessage || isSubmitted) && (
        <div className="shrink-0 space-y-2">
          {isSubmitted && (
            <div className="p-2.5 rounded-lg bg-[#171717] text-white flex items-center gap-2 text-xs">
              <Lock className="w-4 h-4 shrink-0" />
              <span className="font-heading font-bold">FINAL ANSWER LOCKED</span>
              <span className="text-white/70">— replay, clue purchases, and editing are disabled.</span>
            </div>
          )}
          {error && (
            <div className="p-2.5 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] flex items-center gap-2 text-xs font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {successMessage && (
            <div className="p-2.5 rounded-lg bg-[#18794E]/5 border border-[#18794E]/20 text-[#18794E] flex items-center gap-2 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* Single-screen two-column workspace (stacks on mobile). */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: case situation + media */}
        <div className="min-h-0 flex flex-col gap-3 lg:overflow-hidden">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-4 shadow-xs shrink-0 lg:max-h-[38%] lg:overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-heading font-bold text-[#171717] tracking-wider uppercase">Situation</span>
              <span className="text-[11px] font-mono text-[#737373]">Allocated {activeCase?.initial_credits ?? 0} CR</span>
            </div>
            <p className="text-xs sm:text-sm text-[#171717] leading-relaxed whitespace-pre-wrap font-body">
              {activeCase?.situation_description}
            </p>
          </div>

          {media && (
            <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-4 shadow-xs flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2 shrink-0">
                <span className="text-[11px] font-heading font-bold text-[#171717] tracking-wider uppercase">Case Media</span>
                <span className="text-[11px] font-mono text-[#737373]">Replays: {media.replay_count}</span>
              </div>
              {media.is_visible ? (
                <div className="flex-1 min-h-0 flex flex-col gap-2">
                  <div className="text-[11px] font-mono text-[#18794E] shrink-0">
                    {media.initial_window_elapsed ? 'Replay window' : 'Initial viewing'} — {viewingSecondsLeft}s
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 gap-2">
                    {media.items.length === 0 && (
                      <div className="text-xs font-mono text-[#737373] italic">No media attached to this case.</div>
                    )}
                    {media.items.map((m) => (
                      <div key={m.id} className="rounded-lg overflow-hidden border border-[#E5E5E5] bg-[#F5F5F2] p-1.5">
                        {m.media_type === 'image' && (
                          <img src={m.media_path} alt={m.caption || 'Case media'} className="max-h-56 w-full object-contain rounded" />
                        )}
                        {m.media_type === 'video' && (
                          <video src={m.media_path} controls className="max-h-56 w-full object-contain rounded" />
                        )}
                        {m.media_type === 'audio' && <audio src={m.media_path} controls className="w-full" />}
                        {m.caption && <div className="text-[11px] font-mono text-[#737373] mt-1 px-1">{m.caption}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-0 rounded-lg border border-dashed border-[#E5E5E5] bg-[#F5F5F2] p-4 flex flex-col items-center justify-center gap-2 text-center">
                  <EyeOff className="w-7 h-7 text-[#A3A3A3]" />
                  <div className="text-xs text-[#737373]">
                    {isSubmitted
                      ? 'Replay is unavailable after your final submission.'
                      : `Initial viewing ended. Replay for ${media.replay_cost} credits.`}
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
                      <span>REPLAY ({media.replay_cost} CR)</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: answer (always visible) + clues */}
        <div className="min-h-0 flex flex-col gap-3 lg:overflow-hidden">
          {/* Final answer / evaluation — top of column, never needs scrolling to reach. */}
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-4 shadow-xs shrink-0">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-heading font-bold text-[#171717]">Final Answer</h2>
              {isSubmitted && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#18794E]/10 text-[#18794E] border border-[#18794E]/20 font-mono text-[11px] font-semibold">
                  <CheckCircle2 className="w-3 h-3" /> SUBMITTED
                </span>
              )}
            </div>

            {level2State?.evaluation && level2State.evaluation.status === 'completed' ? (
              <div className="p-3 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-heading font-bold text-[#171717] uppercase tracking-wider">
                    Evaluation {level2State.evaluation.is_overridden ? '(Override)' : ''}
                  </span>
                  <span className="text-sm font-mono font-bold text-[#171717]">
                    {level2State.evaluation.score ?? 0} / {level2State.evaluation.max_score}
                  </span>
                </div>
                {level2State.evaluation.verdict && (
                  <div className="text-xs font-heading font-bold text-[#171717]">{level2State.evaluation.verdict}</div>
                )}
                {level2State.evaluation.reasoning && (
                  <p className="text-[11px] text-[#737373] italic whitespace-pre-wrap">{level2State.evaluation.reasoning}</p>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmitConclusion} className="space-y-2">
                <textarea
                  rows={4}
                  disabled={disabledByState || isSubmittingConclusion}
                  value={conclusionText}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConclusionText(val);
                    if (team?.id && !isSubmitted) {
                      setStoredConclusionDraft(team.id, val, gameState?.session_id);
                    }
                  }}
                  placeholder="Explain your conclusion. Reference the clues and evidence that support your reasoning."
                  className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-lg text-[#171717] placeholder-[#A3A3A3] font-body text-xs sm:text-sm focus:outline-none focus:border-[#171717] transition-colors leading-relaxed disabled:opacity-75 disabled:cursor-not-allowed resize-none"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-mono text-[#737373]">
                    {conclusionText.length} chars{isSubmitted ? '' : level2State?.evaluation?.status === 'pending' ? ' · evaluating…' : ''}
                  </span>
                  {!isSubmitted && (
                    <button
                      type="submit"
                      disabled={isSubmittingConclusion || isRoundEnded || conclusionText.trim().length < 10}
                      className="px-5 py-2.5 rounded-lg font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                    >
                      {isSubmittingConclusion ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      <span>Submit Final Answer</span>
                    </button>
                  )}
                </div>
              </form>
            )}
            {level2State?.evaluation && level2State.evaluation.status === 'pending' && (
              <div className="mt-2 text-[11px] font-mono text-[#737373] flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Evaluation in progress…
              </div>
            )}
          </div>

          {/* Clues — scrollable region so the answer field above stays in view. */}
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-4 shadow-xs flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2 shrink-0">
              <h2 className="text-sm font-heading font-bold text-[#171717]">Clues</h2>
              <span className="text-[11px] font-mono text-[#737373]">{unlockedCount} / {clues.length} unlocked</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {clues.map((clue) => {
                const isUnlocked = clue.is_unlocked;
                const canAfford = (team?.current_credits ?? 0) >= clue.credit_cost;
                return (
                  <div
                    key={clue.id}
                    className={`rounded-lg border p-3 ${isUnlocked ? 'bg-[#FFFFFF] border-[#171717]' : 'bg-[#FFFFFF] border-[#E5E5E5]'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-xs font-heading font-bold text-[#171717] truncate">{clue.title}</h3>
                        <div className="text-[10px] font-mono text-[#737373]">
                          {isUnlocked ? 'UNLOCKED' : `${clue.credit_cost} CR`}
                        </div>
                      </div>
                      {!isUnlocked && (
                        <button
                          type="button"
                          disabled={!canAfford || isUnlockingClueId === clue.id || disabledByState}
                          onClick={() => handleUnlockClue(clue)}
                          className={`px-2.5 py-1.5 rounded-lg font-mono text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
                            canAfford && !disabledByState
                              ? 'bg-[#FF8A24] hover:bg-[#F27D16] text-white'
                              : 'bg-[#F5F5F2] text-[#A3A3A3] border border-[#E5E5E5] cursor-not-allowed'
                          }`}
                        >
                          {isUnlockingClueId === clue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                          <span>UNLOCK</span>
                        </button>
                      )}
                    </div>
                    {isUnlocked && (
                      <p className="mt-2 text-[11px] sm:text-xs text-[#171717] leading-relaxed font-body whitespace-pre-wrap bg-[#F5F5F2] p-2 rounded border border-[#E5E5E5]">
                        {clue.content}
                      </p>
                    )}
                  </div>
                );
              })}
              {clues.length === 0 && <div className="text-xs font-mono text-[#737373] italic">No clues available.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

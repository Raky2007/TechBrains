import React, { useState, useEffect, useCallback } from 'react';
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
  FileText
} from 'lucide-react';

export const Level2GamePage: React.FC = () => {
  const { team, gameState, refreshTeam, refreshGameState } = useTeam();

  const [level2State, setLevel2State] = useState<TeamPrivateState['level2'] | null>(null);
  const [conclusionText, setConclusionText] = useState<string>('');
  const [isUnlockingClueId, setIsUnlockingClueId] = useState<string | null>(null);
  const [isSubmittingConclusion, setIsSubmittingConclusion] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

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

    socket.on('round:ended', handleRoundEnded);
    return () => {
      socket.off('round:ended', handleRoundEnded);
    };
  }, [loadProgress, refreshGameState]);

  const activeCase = level2State?.case;
  const clues = level2State?.clues || [];
  const conclusion = level2State?.conclusion;
  const isSubmitted = conclusion?.status === 'submitted';
  const isRoundEnded = gameState?.status === 'level2_ended' || gameState?.status === 'completed';

  const handleUnlockClue = async (clue: ClientClue) => {
    if (clue.is_unlocked) return;
    if ((team?.current_credits ?? 0) < clue.credit_cost) {
      setError(`Insufficient credits. You need ${clue.credit_cost} credits, but have ${team?.current_credits ?? 0}.`);
      return;
    }

    setIsUnlockingClueId(clue.id);
    setError(null);

    try {
      const res = await apiFetch<{
        success: boolean;
        clue: ClientClue;
        credits_spent: number;
        remaining_credits: number;
      }>('/api/game/level2/unlock-clue', {
        method: 'POST',
        body: JSON.stringify({ clue_id: clue.id })
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

    setIsSubmittingConclusion(true);
    setError(null);

    try {
      await apiFetch('/api/game/level2/conclusion', {
        method: 'POST',
        body: JSON.stringify({ conclusion_text: conclusionText.trim() })
      });

      setSuccessMessage('Forensic conclusion successfully submitted for evaluation!');
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
        <span>Loading forensic case dossier...</span>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E5E5E5]">
        <div className="space-y-1">
          <span className="text-[11px] font-mono text-[#B34400] font-bold uppercase tracking-wider">
            PHASE 2 FORENSIC INVESTIGATION
          </span>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-[#171717]">
            {activeCase?.title || 'Forensic Investigation'}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Credit balance badge: #FFF0D6 with dark orange text #B34400 */}
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#FFF0D6] border border-[#FED7AA] font-mono shadow-2xs">
            <Coins className="w-4 h-4 text-[#B34400]" />
            <span className="text-xs text-[#737373]">Credits:</span>
            <span className="text-sm font-bold text-[#B34400]">{team?.current_credits ?? 0}</span>
          </div>

          {/* Authoritative timer with #FF8A24 warning */}
          <CountdownTimer
            deadlineAt={gameState?.round?.deadline_at || null}
            isPaused={gameState?.round?.is_paused || false}
            remainingSeconds={gameState?.round?.remaining_seconds || 0}
          />
        </div>
      </div>

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

      {/* Case Situation Dossier: Card #FFFFFF with #E5E5E5 border */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-[#171717] tracking-wider uppercase">
            INCIDENT DOSSIER & SITUATION
          </span>
          <span className="text-xs font-mono text-[#737373]">
            INITIAL ALLOCATION: {activeCase?.initial_credits ?? 200} CR
          </span>
        </div>

        <p className="text-sm text-[#171717] leading-relaxed whitespace-pre-wrap font-body">
          {activeCase?.situation_description}
        </p>

        {activeCase?.media_path && (
          <div className="mt-4 rounded-xl overflow-hidden border border-[#E5E5E5] bg-[#F5F5F2] max-h-80 flex items-center justify-center p-2">
            <img src={activeCase.media_path} alt="Case Situation" className="max-h-80 w-full object-contain rounded-lg" />
          </div>
        )}
      </div>

      {/* Classified Clues Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-heading font-bold text-[#171717]">
              Available Forensic Intelligence
            </h2>
            <p className="text-xs text-[#737373]">
              Unlock evidentiary artifacts using your credits. Unlocked evidence decrypts immediately.
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
                  isUnlocked
                    ? 'bg-[#FFFFFF] border-[#171717] shadow-sm'
                    : 'bg-[#FFFFFF] border-[#E5E5E5]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                        isUnlocked
                          ? 'bg-[#18794E]/10 text-[#18794E]'
                          : 'bg-[#F5F5F2] text-[#737373]'
                      }`}
                    >
                      {isUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-heading font-bold text-[#171717]">
                        {clue.title}
                      </h3>
                      <div className="text-[11px] font-mono text-[#737373]">
                        {isUnlocked ? 'DECRYPTED & ACCESSIBLE' : `COST: ${clue.credit_cost} CR`}
                      </div>
                    </div>
                  </div>

                  {/* Secondary CTA / clue unlock: #FF8A24 */}
                  {!isUnlocked && (
                    <button
                      type="button"
                      disabled={!canAfford || isUnlockingClueId === clue.id || isRoundEnded}
                      onClick={() => handleUnlockClue(clue)}
                      className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                        canAfford
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

                {/* Unlocked Clue Evidence */}
                {isUnlocked && (
                  <div className="mt-4 pt-3.5 border-t border-[#E5E5E5] space-y-3">
                    <p className="text-xs sm:text-sm text-[#171717] leading-relaxed font-body whitespace-pre-wrap bg-[#F5F5F2] p-3 rounded-lg border border-[#E5E5E5]">
                      {clue.content}
                    </p>
                    {clue.media_path && (
                      <div className="rounded-lg overflow-hidden border border-[#E5E5E5] bg-[#F5F5F2] p-1">
                        <img src={clue.media_path} alt={clue.title} className="max-h-60 w-full object-contain rounded" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Forensic Conclusion Form: Card #FFFFFF */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-heading font-bold text-[#171717]">
              Forensic Synthesis & Verdict
            </h2>
            <p className="text-xs text-[#737373]">
              Analyze the evidence and explain your conclusion. Reference the clues that support your reasoning.
            </p>
          </div>
          {isSubmitted && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#18794E]/10 text-[#18794E] border border-[#18794E]/20 font-mono text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>SUBMITTED FOR EVALUATION</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmitConclusion} className="space-y-4">
          <textarea
            rows={6}
            disabled={isSubmitted || isSubmittingConclusion || isRoundEnded}
            value={conclusionText}
            onChange={(e) => setConclusionText(e.target.value)}
            placeholder="Analyze the evidence and explain your conclusion. Reference the clues that support your reasoning."
            className="w-full p-4 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] placeholder-[#A3A3A3] font-body text-sm focus:outline-none focus:border-[#171717] transition-colors leading-relaxed disabled:opacity-75 disabled:cursor-not-allowed"
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <span className="text-xs font-mono text-[#737373]">
              Characters: {conclusionText.length} | Rubric: Accuracy (10), Reasoning (5), Efficiency (5)
            </span>

            {/* Primary CTA: #FFC928 with bold black text */}
            {!isSubmitted && (
              <button
                type="submit"
                disabled={isSubmittingConclusion || isRoundEnded || conclusionText.trim().length < 10}
                className="px-7 py-3 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs cursor-pointer"
              >
                {isSubmittingConclusion ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                    <span>RECORDING...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>SUBMIT FINAL CONCLUSION</span>
                  </>
                )}
              </button>
            )}
          </div>
        </form>

        {/* Evaluation Feedback */}
        {level2State?.evaluation && (
          <div className="mt-6 p-5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">
                OFFICIAL EVALUATION RESULT
              </span>
              <span className="text-base font-mono font-bold text-[#171717]">
                Score: {level2State.evaluation.total_score} / 20 pts
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono">
              <div className="p-2.5 rounded bg-[#FFFFFF] border border-[#E5E5E5]">
                <span className="text-[#737373] block text-[10px]">ACCURACY</span>
                <span className="font-bold text-[#171717]">{level2State.evaluation.accuracy_score} / 10</span>
              </div>
              <div className="p-2.5 rounded bg-[#FFFFFF] border border-[#E5E5E5]">
                <span className="text-[#737373] block text-[10px]">REASONING</span>
                <span className="font-bold text-[#171717]">{level2State.evaluation.reasoning_score} / 5</span>
              </div>
              <div className="p-2.5 rounded bg-[#FFFFFF] border border-[#E5E5E5]">
                <span className="text-[#737373] block text-[10px]">EFFICIENCY</span>
                <span className="font-bold text-[#171717]">{level2State.evaluation.efficiency_score} / 5</span>
              </div>
            </div>
            {level2State.evaluation.feedback && (
              <p className="text-xs text-[#737373] italic pt-2 border-t border-[#E5E5E5]">
                Evaluator Feedback: "{level2State.evaluation.feedback}"
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

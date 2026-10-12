import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeam } from '../layouts/TeamLayout';
import { CountdownTimer } from '../components/CountdownTimer';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { ClientClue, TeamPrivateState } from '@nexus/shared';
import {
  Coins,
  Lock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ZoomIn,
  X,
  KeyRound,
  Send,
  ShieldAlert
} from 'lucide-react';

type Level2State = NonNullable<TeamPrivateState['level2']>;

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const SUSPECT_OPTIONS = [
  { id: 'Arjun', name: 'Arjun', role: 'Project Lead' },
  { id: 'Meera', name: 'Meera', role: 'Hardware Engineer' },
  { id: 'Kabir', name: 'Kabir', role: 'Media Coordinator' },
  { id: 'Riya', name: 'Riya', role: 'Lab Assistant' }
];

export const Level2GamePage: React.FC = () => {
  const navigate = useNavigate();
  const { team, gameState, refreshTeam } = useTeam();

  const [level2State, setLevel2State] = useState<Level2State | null>(null);
  const [qualified, setQualified] = useState<boolean | null>(null);

  // Q1 State
  const [pinInput, setPinInput] = useState<string>('');
  const [isSubmittingQ1, setIsSubmittingQ1] = useState<boolean>(false);

  // Q2 State
  const [selectedSuspect, setSelectedSuspect] = useState<string>('');
  const [explanationText, setExplanationText] = useState<string>('');
  const [isSubmittingQ2, setIsSubmittingQ2] = useState<boolean>(false);

  // Clues State
  const [isUnlockingClueId, setIsUnlockingClueId] = useState<string | null>(null);
  const clueOpIds = useRef<Map<string, string>>(new Map());

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isImageModalOpen, setIsImageModalOpen] = useState<boolean>(false);

  const loadProgress = useCallback(async () => {
    try {
      const res = await apiFetch<TeamPrivateState>('/api/game/team-state');
      setQualified(res.round2_qualified === false ? false : true);
      setLevel2State(res.level2 || null);

      if (res.level2?.q1?.submitted_pin) {
        setPinInput(res.level2.q1.submitted_pin);
      }
      if (res.level2?.q2?.selected_suspect) {
        setSelectedSuspect(res.level2.q2.selected_suspect);
      }
      if (res.level2?.q2?.explanation) {
        setExplanationText(res.level2.q2.explanation);
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
      loadProgress();
    };
    const handlePrivateUpdate = (state: TeamPrivateState) => {
      setQualified(state.round2_qualified === false ? false : true);
      setLevel2State(state.level2 || null);
      if (state.level2?.q1?.submitted_pin) {
        setPinInput(state.level2.q1.submitted_pin);
      }
      if (state.level2?.q2?.selected_suspect) {
        setSelectedSuspect(state.level2.q2.selected_suspect);
      }
      if (state.level2?.q2?.explanation) {
        setExplanationText(state.level2.q2.explanation);
      }
    };

    socket.on('round:ended', handleRoundEnded);
    socket.on('game:state_changed', handleRoundEnded);
    socket.on('team:private_updated', handlePrivateUpdate);

    return () => {
      socket.off('round:ended', handleRoundEnded);
      socket.off('game:state_changed', handleRoundEnded);
      socket.off('team:private_updated', handlePrivateUpdate);
    };
  }, [loadProgress]);

  const clues = level2State?.clues || [];
  const q1Result = level2State?.q1;
  const q2Result = level2State?.q2;

  const isQ1Submitted = !!q1Result?.is_submitted;
  const isQ2Submitted = !!q2Result?.is_submitted;
  const isRoundEnded = gameState?.status === 'level2_ended' || gameState?.status === 'completed';
  const isAllLocked = isQ2Submitted || isRoundEnded;

  // Auto-navigate to /result as soon as both required Level 2 answers are submitted
  useEffect(() => {
    if ((isQ1Submitted && isQ2Submitted) || level2State?.is_completed) {
      navigate('/result', { replace: true });
    }
  }, [isQ1Submitted, isQ2Submitted, level2State?.is_completed, navigate]);

  // Clue unlocks
  const handleUnlockClue = async (clue: ClientClue) => {
    if (clue.is_unlocked || isAllLocked) return;
    if ((team?.current_credits ?? 0) < clue.credit_cost) {
      setError(`Insufficient credits. You need ${clue.credit_cost} CR, but have ${team?.current_credits ?? 0} CR.`);
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
      const res = await apiFetch<{ clue: ClientClue; credits_spent: number; remaining_credits?: number }>('/api/game/level2/unlock-clue', {
        method: 'POST',
        body: JSON.stringify({ clue_id: clue.id, operation_id })
      });
      if (res.remaining_credits !== undefined && team) {
        team.current_credits = res.remaining_credits;
      }
      setSuccessMessage(`Unlocked clue (-${res.credits_spent} CR)`);
      setTimeout(() => setSuccessMessage(null), 3000);
      await refreshTeam();
      await loadProgress();
    } catch (err: any) {
      setError(err.message || 'Failed to unlock clue.');
    } finally {
      setIsUnlockingClueId(null);
    }
  };

  // Submit Question 1 (PIN)
  const handleSubmitQ1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingQ1 || isQ1Submitted || isRoundEnded) return;
    const trimmed = pinInput.trim();
    if (!trimmed) {
      setError('Please enter a vault PIN.');
      return;
    }
    const confirmed = window.confirm(
      `Confirm submission of PIN: "${trimmed}"?\n\nOnce submitted, your answer for Question 1 is final and cannot be modified.`
    );
    if (!confirmed) return;

    setIsSubmittingQ1(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; message: string; q1: any }>('/api/game/level2/submit-q1', {
        method: 'POST',
        body: JSON.stringify({ pin: trimmed })
      });
      setSuccessMessage(res.message);
      setTimeout(() => setSuccessMessage(null), 4000);
      await refreshTeam();
      await loadProgress();
      if (isQ2Submitted) {
        navigate('/result');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit Question 1.');
    } finally {
      setIsSubmittingQ1(false);
    }
  };

  const currentCase = level2State?.case;
  const isCase2 = Boolean((currentCase?.title || '').toLowerCase().includes('examination') || currentCase?.case_number === 2);
  const caseTitle = currentCase?.title || (isCase2 ? 'The Examination Paper Mystery' : 'The Vanishing Prototype');
  const caseImage = currentCase?.media_path || (isCase2 ? '/examination_paper_mystery.jpg' : '/the_vanishing_prototype.jpg');

  // Submit Question 2 (Suspect/Hiding Place & Reasoning)
  const handleSubmitQ2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingQ2 || isQ2Submitted || isRoundEnded) return;
    if (!selectedSuspect) {
      setError(isCase2 ? 'Please enter where the missing examination paper is hidden.' : 'Please select a suspect from the options.');
      return;
    }
    const trimmedExp = explanationText.trim();
    if (trimmedExp.length < 10) {
      setError('Please provide a detailed explanation supported by evidence (minimum 10 characters).');
      return;
    }
    const confirmed = window.confirm(
      isCase2
        ? `Confirm final submission for Question 2?\n\nProposed Hiding Place: ${selectedSuspect}\n\nThis submission is irreversible and will be evaluated by the forensic scoring engine.`
        : `Confirm final submission for Question 2?\n\nSuspect: ${selectedSuspect}\n\nThis submission is irreversible and will be evaluated by the forensic scoring engine.`
    );
    if (!confirmed) return;

    setIsSubmittingQ2(true);
    setError(null);
    try {
      const res = await apiFetch<{ success: boolean; message: string; q2: any }>('/api/game/level2/submit-q2', {
        method: 'POST',
        body: JSON.stringify({
          selected_suspect: selectedSuspect,
          explanation: trimmedExp
        })
      });
      setSuccessMessage(res.message);
      setTimeout(() => setSuccessMessage(null), 4000);
      await refreshTeam();
      await loadProgress();
      if (isQ1Submitted) {
        navigate('/result');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit Question 2.');
    } finally {
      setIsSubmittingQ2(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 font-mono text-[#737373] text-sm">
        <Loader2 className="w-7 h-7 animate-spin text-[#171717]" />
        <span>Loading investigation case…</span>
      </div>
    );
  }

  if (qualified === false) {
    return (
      <div className="max-w-md mx-auto my-16 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-[#F5F5F2] border border-[#E5E5E5] text-[#737373] mx-auto flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-heading font-bold text-[#171717]">Round 2 Not Available</h2>
        <p className="text-xs text-[#737373] leading-relaxed">
          Round 2 is not available for your team. Please wait for the final results.
        </p>
      </div>
    );
  }

  const q1Clues = clues.filter((c) => c.question_number === 1);
  const q2Clues = clues.filter((c) => c.question_number === 2);

  const renderClues = (clueList: ClientClue[], label: string) => (
    <div className="space-y-2">
      <span className="text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">{label}</span>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {clueList.length === 0 ? (
          <span className="text-xs text-[#737373]">No clues available.</span>
        ) : (
          clueList.map((clue, idx) => {
            const isUnlocked = clue.is_unlocked;
            const canAfford = (team?.current_credits ?? 0) >= clue.credit_cost;
            return (
              <div
                key={clue.id}
                className={`p-3 rounded-xl border ${isUnlocked ? 'border-[#171717] bg-[#FFFFFF]' : 'border-[#E5E5E5] bg-[#FFFFFF]'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-heading font-bold text-xs text-[#171717]">Clue {idx + 1}</span>
                  <span className="font-mono text-xs font-bold text-[#B34400]">{clue.credit_cost} CR</span>
                </div>
                {isUnlocked ? (
                  <p className="text-[11px] text-[#171717] leading-relaxed">{clue.content}</p>
                ) : (
                  <button
                    type="button"
                    disabled={!canAfford || isUnlockingClueId === clue.id || isAllLocked}
                    onClick={() => handleUnlockClue(clue)}
                    className={`w-full px-2.5 py-1.5 rounded-lg font-mono text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      canAfford && !isAllLocked
                        ? 'bg-[#FF8A24] hover:bg-[#F27D16] text-white'
                        : 'bg-[#F5F5F2] text-[#A3A3A3] border border-[#E5E5E5] cursor-not-allowed'
                    }`}
                  >
                    {isUnlockingClueId === clue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
                    <span>Unlock</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="w-full flex flex-col gap-5 pb-6 font-body text-[#171717]">
      {/* Header: title, score, team, credits, timer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5]">
        <h1 className="text-lg sm:text-xl font-heading font-bold tracking-tight">Round 2: Clues with Credits</h1>
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap font-mono text-xs text-[#171717]">
          <span>Round 2 Score: <strong>{Number(team?.level2_score ?? 0)}</strong> / 10 pts</span>
          <span>Team: <strong>{team?.team_name}</strong></span>
          <span className="inline-flex items-center gap-1.5 text-[#B34400] font-bold">
            <Coins className="w-4 h-4" />
            {team?.current_credits ?? '—'} CR
          </span>
          <CountdownTimer
            deadlineAt={gameState?.round?.deadline_at || null}
            isPaused={(gameState?.round?.is_paused || false) || Boolean(level2State?.is_completed)}
            remainingSeconds={level2State?.frozen_remaining_seconds ?? (gameState?.round?.remaining_seconds || 0)}
          />
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-3 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] flex items-center gap-2 text-xs font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div className="p-3 rounded-xl bg-[#18794E]/5 border border-[#18794E]/20 text-[#18794E] flex items-center gap-2 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Scenario + Image */}
      <div className="space-y-3">
        <h2 className="text-sm font-heading font-bold uppercase tracking-wider text-[#171717]">Scenario</h2>
        {currentCase?.situation_description && (
          <p className="text-sm leading-relaxed text-[#525252] whitespace-pre-wrap">{currentCase.situation_description}</p>
        )}
        <div className="relative rounded-xl overflow-hidden border border-[#E5E5E5] bg-black/5">
          <img
            src={caseImage}
            alt={caseTitle}
            onClick={() => setIsImageModalOpen(true)}
            className="w-full max-h-[48vh] object-contain mx-auto cursor-zoom-in"
          />
          <button
            type="button"
            onClick={() => setIsImageModalOpen(true)}
            className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/90 border border-[#E5E5E5] text-[11px] font-mono text-[#171717] hover:bg-white cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" /> Enlarge
          </button>
        </div>
      </div>

      {/* Q1 */}
      <div className="space-y-4 pt-3 border-t border-[#E5E5E5]">
        <div>
          <h2 className="text-base font-heading font-bold text-[#171717]">
            Q1: {currentCase?.q1_title || (isCase2 ? 'Crack the Examination Locker Password' : 'Crack the Vault Keypad')}
          </h2>
          <p className="text-sm text-[#525252] leading-relaxed mt-1">
            {currentCase?.q1_prompt || (isCase2
              ? 'Work out the 4-digit PIN for the examination locker.'
              : 'Work out the 4-digit PIN for the vault keypad.')}
          </p>
        </div>

        {renderClues(q1Clues, 'Clues for Q1')}

        {isQ1Submitted ? (
          <div className="text-xs font-mono text-[#171717]">
            Submitted PIN: <strong className="tracking-widest">{q1Result?.submitted_pin}</strong>
            <span className="ml-3 text-[#737373]">({q1Result?.score ?? 0} / 5 pts)</span>
          </div>
        ) : (
          <form onSubmit={handleSubmitQ1} className="space-y-2">
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">Ans</label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="flex-1 flex items-center bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl px-3.5 focus-within:border-[#171717] transition-colors">
                <KeyRound className="w-4 h-4 text-[#737373] shrink-0 mr-2.5" />
                <input
                  type="text"
                  required
                  disabled={isSubmittingQ1 || isRoundEnded}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="Enter 4-digit PIN…"
                  className="w-full py-2.5 bg-transparent text-sm font-mono tracking-wider focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingQ1 || isRoundEnded || !pinInput.trim()}
                className="px-5 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs cursor-pointer shrink-0"
              >
                {isSubmittingQ1 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                <span>Submit</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Q2 */}
      <div className="space-y-4 pt-3 border-t border-[#E5E5E5]">
        <div>
          <h2 className="text-base font-heading font-bold text-[#171717]">
            Q2: {currentCase?.q2_title || (isCase2 ? 'Find the Missing Examination Paper' : 'Who Took ORION?')}
          </h2>
          <p className="text-sm text-[#525252] leading-relaxed mt-1">
            {currentCase?.q2_prompt || (isCase2
              ? 'Where is the missing examination paper most likely hidden? Explain using the evidence.'
              : 'Who took ORION, and what evidence supports it? Select the suspect and explain your reasoning.')}
          </p>
        </div>

        {renderClues(q2Clues, 'Clues for Q2')}

        {isQ2Submitted ? (
          <div className="text-xs font-mono text-[#171717] space-y-1">
            <div>Submitted: <strong>{q2Result?.selected_suspect}</strong></div>
            <div className="text-[#737373]">Your final answer is recorded. Redirecting to results…</div>
          </div>
        ) : (
          <form onSubmit={handleSubmitQ2} className="space-y-4">
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">Ans</label>
            {isCase2 ? (
              <input
                type="text"
                required
                disabled={isSubmittingQ2 || isRoundEnded}
                value={selectedSuspect}
                onChange={(e) => setSelectedSuspect(e.target.value)}
                placeholder="Where is the paper hidden? e.g. hollow compartment beneath the desk"
                className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-sm focus:outline-none focus:border-[#171717] transition-colors"
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {SUSPECT_OPTIONS.map((s) => {
                  const isSelected = selectedSuspect === s.name;
                  return (
                    <button
                      type="button"
                      key={s.id}
                      disabled={isSubmittingQ2 || isRoundEnded}
                      onClick={() => setSelectedSuspect(s.name)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected ? 'bg-[#FFC928] border-[#171717] shadow-xs' : 'bg-[#FFFFFF] border-[#E5E5E5] hover:border-[#171717]'
                      }`}
                    >
                      <div className="font-heading font-bold text-xs text-[#171717]">{s.name}</div>
                      <div className="text-[10px] font-mono text-[#737373]">{s.role}</div>
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              rows={4}
              required
              disabled={isSubmittingQ2 || isRoundEnded}
              value={explanationText}
              onChange={(e) => setExplanationText(e.target.value)}
              placeholder={isCase2
                ? 'Explain using the strongest visual evidence from the scene…'
                : 'Give your strongest evidence and reasoning connecting the timeline, logs, and clues…'}
              className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-sm focus:outline-none focus:border-[#171717] transition-colors leading-relaxed resize-none"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-mono text-[#737373]">{explanationText.trim().length} characters (min. 10)</span>
              <button
                type="submit"
                disabled={isSubmittingQ2 || isRoundEnded || !selectedSuspect.trim() || explanationText.trim().length < 10}
                className="px-6 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs cursor-pointer"
              >
                {isSubmittingQ2 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Submit</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Image modal */}
      {isImageModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          onClick={() => setIsImageModalOpen(false)}
        >
          <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setIsImageModalOpen(false)}
              className="absolute -top-10 right-0 text-white hover:text-[#FF8A24] cursor-pointer flex items-center gap-1 font-mono text-xs"
            >
              <X className="w-5 h-5" /> Close
            </button>
            <img
              src={caseImage}
              alt={caseTitle}
              className="max-h-[85vh] w-auto object-contain rounded-xl shadow-2xl border border-white/20"
            />
          </div>
        </div>
      )}
    </div>
  );
};

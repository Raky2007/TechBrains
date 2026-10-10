import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  XCircle,
  Send,
  Loader2,
  ShieldAlert,
  ZoomIn,
  X,
  KeyRound,
  UserCheck,
  Sparkles,
  HelpCircle,
  Clock,
  Building,
  User,
  FileText
} from 'lucide-react';

type Level2State = NonNullable<TeamPrivateState['level2']>;

function newOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const SUSPECT_OPTIONS = [
  { id: 'Arjun', name: 'Arjun', role: 'Project Lead', desc: "Responsible for ORION's software and demonstration schedule. Statement: 'I left at 7:25 PM. I never returned to the lab.'" },
  { id: 'Meera', name: 'Meera', role: 'Hardware Engineer', desc: "Maintained the device casing and power system. Statement: 'I was in the electronics workshop after 7:30. I never touched the display case.'" },
  { id: 'Kabir', name: 'Kabir', role: 'Media Coordinator', desc: "Managed expo recordings and the lab's demonstration camera. Statement: 'I exported the demonstration video at 7:45. The room was already empty.'" },
  { id: 'Riya', name: 'Riya', role: 'Lab Assistant', desc: "Managed display arrangements and the spare equipment cabinet. Statement: 'I locked the lab at 7:30. Nobody could have entered after me.'" }
];

export const Level2GamePage: React.FC = () => {
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
    const handleRoundEnded = () => loadProgress();
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
      `Confirm submission of Vault PIN: "${trimmed}"?\n\nOnce submitted, your answer for Question 1 is final and cannot be modified.`
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
    } catch (err: any) {
      setError(err.message || 'Failed to submit Question 1.');
    } finally {
      setIsSubmittingQ1(false);
    }
  };

  // Submit Question 2 (Suspect & Reasoning)
  const handleSubmitQ2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingQ2 || isQ2Submitted || isRoundEnded) return;
    if (!selectedSuspect) {
      setError('Please select a suspect from the options.');
      return;
    }
    const trimmedExp = explanationText.trim();
    if (trimmedExp.length < 10) {
      setError('Please provide a detailed explanation supported by evidence (minimum 10 characters).');
      return;
    }
    const confirmed = window.confirm(
      `Confirm final submission for Question 2?\n\nSuspect: ${selectedSuspect}\n\nThis submission is irreversible and will be evaluated by the forensic AI engine.`
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
      <div className="max-w-md mx-auto my-16 bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-[#F5F5F2] border border-[#E5E5E5] text-[#737373] mx-auto flex items-center justify-center">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-heading font-bold text-[#171717]">Level 2 Not Available</h2>
        <p className="text-xs text-[#737373] leading-relaxed">
          Your team did not meet the Level 1 qualification cutoff, so Level 2 is not available for your team. Thank you for
          competing in Level 1 — please wait for the final results.
        </p>
      </div>
    );
  }

  const q1Clues = clues.filter((c) => c.question_number === 1);
  const q2Clues = clues.filter((c) => c.question_number === 2);

  return (
    <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 pb-16 font-body text-[#171717]">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E5E5E5]">
        <div>
          <span className="text-[11px] font-mono text-[#B34400] font-bold uppercase tracking-wider">
            LEVEL 2 — CRIME SCENE INVESTIGATION
          </span>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold text-[#171717]">
            The Vanishing Prototype
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#FFF0D6] border border-[#FED7AA] font-mono shadow-2xs">
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

      {/* Notifications */}
      {(error || successMessage) && (
        <div className="space-y-2">
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
        </div>
      )}

      {/* =========================================================================
          SECTION 1: INVESTIGATION IMAGE
         ========================================================================= */}
      <section className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#171717] text-white flex items-center justify-center font-mono text-xs font-bold">1</span>
            <h2 className="text-base sm:text-lg font-heading font-bold text-[#171717]">Investigation Image</h2>
          </div>
          <button
            type="button"
            onClick={() => setIsImageModalOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] hover:border-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] text-xs font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            <span>Click to Enlarge</span>
          </button>
        </div>

        <div className="relative rounded-xl overflow-hidden border border-[#E5E5E5] bg-black/5 group">
          <img
            src="/the_vanishing_prototype.jpg"
            alt="The Vanishing Prototype Crime Scene"
            className="w-full max-h-[460px] object-contain mx-auto cursor-pointer transition-transform duration-200 group-hover:scale-[1.01]"
            onClick={() => setIsImageModalOpen(true)}
          />
          <div className="p-2.5 bg-[#F5F5F2] border-t border-[#E5E5E5] text-[11px] font-mono text-[#737373] flex flex-wrap items-center justify-between gap-2">
            <span>Crime Scene Overview: Missing ORION Prototype, Lab Door, Card Reader, CCTV Monitor, Vault Keypad, Four Suspects</span>
            <span className="text-[#171717] font-semibold">Shared between Questions 1 &amp; 2</span>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: THE SCENARIO
         ========================================================================= */}
      <section className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-[#171717] text-white flex items-center justify-center font-mono text-xs font-bold">2</span>
          <h2 className="text-base sm:text-lg font-heading font-bold text-[#171717]">The Scenario</h2>
        </div>

        {/* Background */}
        <div className="p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] space-y-2 text-xs sm:text-sm text-[#171717] leading-relaxed">
          <div className="font-heading font-bold text-xs uppercase tracking-wider text-[#B34400] flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Incident Briefing
          </div>
          <p>
            At <strong>8:00 PM</strong> on the night before the college’s annual innovation expo, a prototype called{' '}
            <strong className="text-[#171717]">ORION</strong> disappeared from the locked Innovation Lab.
          </p>
          <p>
            ORION is a compact AI device worth <strong>₹10 lakh</strong>. It was last independently verified inside a sealed display case at <strong>7:40 PM</strong>.
          </p>
          <p>
            At 8:00 PM, the display case was found empty. The laboratory door showed no signs of forced entry, the access log recorded no authorized entry after 7:30 PM, and the CCTV feed showed an apparently empty room.
          </p>
          <p className="text-xs text-[#737373] italic">
            Four people had legitimate access to the lab that evening. Each tells a different story.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* The Lab Features */}
          <div className="p-4 rounded-xl border border-[#E5E5E5] space-y-2 text-xs leading-relaxed">
            <div className="font-heading font-bold text-xs uppercase tracking-wider text-[#171717] flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-[#737373]" /> The Laboratory Layout
            </div>
            <ul className="space-y-1.5 text-[#737373] list-disc list-inside">
              <li><strong className="text-[#171717]">Main Door:</strong> Equipped with a card reader recording every authorized entry.</li>
              <li><strong className="text-[#171717]">Display Case:</strong> Sealed glass display in the center of the room holding ORION.</li>
              <li><strong className="text-[#171717]">Cabinets:</strong> Wall cabinets, including a storage cabinet and spare equipment cabinet.</li>
              <li><strong className="text-[#171717]">Demonstration Camera:</strong> Watches the room and feeds expo records.</li>
              <li><strong className="text-[#171717]">Electronics Workshop:</strong> Adjacent workshop next door.</li>
            </ul>
          </div>

          {/* Evening Timeline */}
          <div className="p-4 rounded-xl border border-[#E5E5E5] space-y-2 text-xs leading-relaxed">
            <div className="font-heading font-bold text-xs uppercase tracking-wider text-[#171717] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#737373]" /> The Evening Timeline
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex gap-2">
                <span className="font-bold text-[#171717] w-16 shrink-0">7:25 PM</span>
                <span className="text-[#737373]">Arjun says he left the lab.</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold text-[#171717] w-16 shrink-0">7:30 PM</span>
                <span className="text-[#737373]">Riya says she locked the lab (last authorized log entry).</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold text-[#18794E] w-16 shrink-0">7:40 PM</span>
                <span className="text-[#737373]">ORION verified inside sealed case.</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold text-[#B34400] w-16 shrink-0">7:45 PM</span>
                <span className="text-[#737373]">Kabir exports the demonstration video.</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold text-[#B42318] w-16 shrink-0">8:00 PM</span>
                <span className="text-[#737373]">Case found empty. Alarm raised.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Suspect Statements */}
        <div className="space-y-2">
          <div className="font-heading font-bold text-xs uppercase tracking-wider text-[#171717] flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-[#737373]" /> The Four Suspects &amp; Their Statements
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {SUSPECT_OPTIONS.map((s) => (
              <div key={s.id} className="p-3.5 rounded-xl border border-[#E5E5E5] bg-[#FFFFFF] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-heading font-bold text-[#171717]">{s.name}</span>
                  <span className="font-mono text-[10px] text-[#737373] bg-[#F5F5F2] px-2 py-0.5 rounded">{s.role}</span>
                </div>
                <p className="text-[#737373] text-[11px] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 3: QUESTION 1 — CRACK THE VAULT KEYPAD
         ========================================================================= */}
      <section className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#171717] text-white flex items-center justify-center font-mono text-xs font-bold">3</span>
            <div>
              <h2 className="text-base sm:text-lg font-heading font-bold text-[#171717]">
                Question 1 — Crack the Vault Keypad
              </h2>
              <p className="text-xs text-[#737373] font-mono">Max 5 Points · Deterministic Server Validation</p>
            </div>
          </div>
          {isQ1Submitted && (
            <span className={`px-3 py-1 rounded-full font-mono text-xs font-bold border flex items-center gap-1.5 ${
              q1Result?.is_correct
                ? 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/30'
                : 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30'
            }`}>
              {q1Result?.is_correct ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              <span>{q1Result?.score} / 5 PTS</span>
            </span>
          )}
        </div>

        <p className="text-xs sm:text-sm text-[#171717] leading-relaxed">
          Study the keypad in the scene image. Four keys are worn and smudged. Work out the 4-digit PIN.
        </p>

        {/* Independent Clues for Question 1 */}
        <div className="p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-heading font-bold uppercase tracking-wider text-[#171717] flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-[#B34400]" /> Question 1 Clues
            </span>
            <span className="text-[11px] font-mono text-[#737373]">
              {q1Clues.filter(c => c.is_unlocked).length} / {q1Clues.length} unlocked
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {q1Clues.map((clue) => {
              const isUnlocked = clue.is_unlocked;
              const canAfford = (team?.current_credits ?? 0) >= clue.credit_cost;
              return (
                <div
                  key={clue.id}
                  className={`p-3 rounded-xl border transition-all ${
                    isUnlocked
                      ? 'bg-[#FFFFFF] border-[#171717] shadow-xs'
                      : 'bg-[#FFFFFF] border-[#E5E5E5]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-heading font-bold text-xs text-[#171717] truncate">{clue.title}</span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#F5F5F2] text-[#737373]">
                      {clue.tier}
                    </span>
                  </div>
                  {isUnlocked ? (
                    <p className="text-[11px] text-[#171717] leading-relaxed italic bg-[#F5F5F2] p-2 rounded-lg border border-[#E5E5E5]">
                      {clue.content}
                    </p>
                  ) : (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#E5E5E5]">
                      <span className="font-mono text-xs font-bold text-[#B34400]">{clue.credit_cost} CR</span>
                      <button
                        type="button"
                        disabled={!canAfford || isUnlockingClueId === clue.id || isAllLocked}
                        onClick={() => handleUnlockClue(clue)}
                        className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          canAfford && !isAllLocked
                            ? 'bg-[#FF8A24] hover:bg-[#F27D16] text-white'
                            : 'bg-[#F5F5F2] text-[#A3A3A3] border border-[#E5E5E5] cursor-not-allowed'
                        }`}
                      >
                        {isUnlockingClueId === clue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                        <span>Unlock</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Q1 Submission Form / Result */}
        {isQ1Submitted ? (
          <div className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
            q1Result?.is_correct ? 'bg-[#18794E]/5 border-[#18794E]/20' : 'bg-[#B42318]/5 border-[#B42318]/20'
          }`}>
            <div className="space-y-0.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#737373]">Submitted PIN</span>
              <div className="text-lg font-mono font-bold text-[#171717] tracking-widest">{q1Result?.submitted_pin}</div>
              <div className="text-xs font-medium text-[#737373]">
                {q1Result?.is_correct
                  ? 'Keypad PIN verified correctly! Full 5 points awarded.'
                  : 'Incorrect PIN. 0 points awarded.'}
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-sm font-mono font-bold text-[#171717]">Awarded: {q1Result?.score} / 5</span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmitQ1} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <KeyRound className="w-4 h-4 text-[#737373] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  required
                  disabled={isSubmittingQ1 || isRoundEnded}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="Enter 4-digit PIN (e.g. 0728)"
                  className="w-full pl-10 pr-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-xs sm:text-sm font-mono tracking-wider focus:outline-none focus:border-[#171717] transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={isSubmittingQ1 || isRoundEnded || !pinInput.trim()}
                className="px-5 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs cursor-pointer shrink-0"
              >
                {isSubmittingQ1 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                <span>Submit PIN</span>
              </button>
            </div>
            <p className="text-[11px] text-[#737373] font-mono">
              Deterministic validation. Single attempt only. Once submitted, your PIN cannot be changed.
            </p>
          </form>
        )}
      </section>

      {/* =========================================================================
          SECTION 4: QUESTION 2 — WHO TOOK ORION?
         ========================================================================= */}
      <section className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-[#171717] text-white flex items-center justify-center font-mono text-xs font-bold">4</span>
            <div>
              <h2 className="text-base sm:text-lg font-heading font-bold text-[#171717]">
                Question 2 — Who Took ORION?
              </h2>
              <p className="text-xs text-[#737373] font-mono">Max 5 Points · NVIDIA Nemotron AI Evaluation</p>
            </div>
          </div>
          {isQ2Submitted && q2Result?.evaluation && (
            <span className="px-3 py-1 rounded-full font-mono text-xs font-bold border border-[#18794E]/30 bg-[#18794E]/10 text-[#18794E] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{q2Result?.score ?? q2Result.evaluation.score} / 5 PTS</span>
            </span>
          )}
        </div>

        <p className="text-xs sm:text-sm text-[#171717] leading-relaxed">
          Who took ORION, and what evidence supports the conclusion? Select the perpetrator and provide your forensic reasoning connecting the timeline, logs, and physical clues.
        </p>

        {/* Independent Clues for Question 2 */}
        <div className="p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-heading font-bold uppercase tracking-wider text-[#171717] flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-[#B34400]" /> Question 2 Clues
            </span>
            <span className="text-[11px] font-mono text-[#737373]">
              {q2Clues.filter(c => c.is_unlocked).length} / {q2Clues.length} unlocked
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {q2Clues.map((clue) => {
              const isUnlocked = clue.is_unlocked;
              const canAfford = (team?.current_credits ?? 0) >= clue.credit_cost;
              return (
                <div
                  key={clue.id}
                  className={`p-3 rounded-xl border transition-all ${
                    isUnlocked
                      ? 'bg-[#FFFFFF] border-[#171717] shadow-xs'
                      : 'bg-[#FFFFFF] border-[#E5E5E5]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-heading font-bold text-xs text-[#171717] truncate">{clue.title}</span>
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#F5F5F2] text-[#737373]">
                      {clue.tier}
                    </span>
                  </div>
                  {isUnlocked ? (
                    <p className="text-[11px] text-[#171717] leading-relaxed italic bg-[#F5F5F2] p-2 rounded-lg border border-[#E5E5E5]">
                      {clue.content}
                    </p>
                  ) : (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#E5E5E5]">
                      <span className="font-mono text-xs font-bold text-[#B34400]">{clue.credit_cost} CR</span>
                      <button
                        type="button"
                        disabled={!canAfford || isUnlockingClueId === clue.id || isAllLocked}
                        onClick={() => handleUnlockClue(clue)}
                        className={`px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          canAfford && !isAllLocked
                            ? 'bg-[#FF8A24] hover:bg-[#F27D16] text-white'
                            : 'bg-[#F5F5F2] text-[#A3A3A3] border border-[#E5E5E5] cursor-not-allowed'
                        }`}
                      >
                        {isUnlockingClueId === clue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />}
                        <span>Unlock</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Q2 Suspect Selection & Reasoning */}
        {isQ2Submitted ? (
          <div className="space-y-4">
            {/* Submitted Answer Recap */}
            <div className="p-4 rounded-xl border border-[#E5E5E5] bg-[#F5F5F2] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#737373]">Selected Suspect</span>
                <span className="font-heading font-bold text-xs text-[#171717] bg-[#FFFFFF] px-2.5 py-1 rounded-lg border border-[#E5E5E5]">
                  {q2Result?.selected_suspect}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#737373]">Submitted Forensic Explanation</span>
                <p className="text-xs text-[#171717] leading-relaxed whitespace-pre-wrap mt-1">
                  {q2Result?.explanation}
                </p>
              </div>
            </div>

            {/* AI Evaluation Result Card */}
            {q2Result?.evaluation ? (
              <div className="p-4 sm:p-5 rounded-xl border border-[#E5E5E5] bg-[#FFFFFF] space-y-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E5E5]">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#FF8A24]" />
                    <span className="font-heading font-bold text-sm text-[#171717]">Forensic Evaluation Result</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#171717] text-white">
                      {q2Result.evaluation.verdict || 'Evaluated'}
                    </span>
                  </div>
                  <div className="font-mono text-sm font-bold text-[#171717]">
                    Score: <strong className="text-[#B34400] text-base">{q2Result.score ?? q2Result.evaluation.score}</strong> / 5
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span className="font-heading font-bold text-[11px] uppercase tracking-wider text-[#737373] block mb-0.5">
                      Accuracy Summary
                    </span>
                    <p className="text-[#171717] leading-relaxed bg-[#F5F5F2] p-2.5 rounded-lg border border-[#E5E5E5]">
                      {q2Result.evaluation.accuracy_summary}
                    </p>
                  </div>

                  {Array.isArray(q2Result.evaluation.matched_evidence) && q2Result.evaluation.matched_evidence.length > 0 && (
                    <div>
                      <span className="font-heading font-bold text-[11px] uppercase tracking-wider text-[#18794E] block mb-1">
                        Matched Evidence Cited
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {q2Result.evaluation.matched_evidence.map((ev: string, idx: number) => (
                          <span key={idx} className="px-2.5 py-1 rounded-md bg-[#18794E]/10 text-[#18794E] border border-[#18794E]/20 text-[11px]">
                            ✓ {ev}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {Array.isArray(q2Result.evaluation.missing_evidence) && q2Result.evaluation.missing_evidence.length > 0 && (
                    <div>
                      <span className="font-heading font-bold text-[11px] uppercase tracking-wider text-[#B34400] block mb-1">
                        Missing / Incomplete Evidence
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {q2Result.evaluation.missing_evidence.map((ev: string, idx: number) => (
                          <span key={idx} className="px-2.5 py-1 rounded-md bg-[#B34400]/10 text-[#B34400] border border-[#B34400]/20 text-[11px]">
                            • {ev}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {q2Result.evaluation.feedback && (
                    <div>
                      <span className="font-heading font-bold text-[11px] uppercase tracking-wider text-[#737373] block mb-0.5">
                        Feedback
                      </span>
                      <p className="text-[#737373] italic leading-relaxed">
                        {q2Result.evaluation.feedback}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-xs font-mono text-[#737373] flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                <span>AI evaluation in progress…</span>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmitQ2} className="space-y-4">
            {/* Suspect Radio Selector */}
            <div className="space-y-2">
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">
                Select Suspect <span className="text-[#B42318]">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {SUSPECT_OPTIONS.map((suspect) => {
                  const isSelected = selectedSuspect === suspect.name;
                  return (
                    <button
                      type="button"
                      key={suspect.id}
                      disabled={isSubmittingQ2 || isRoundEnded}
                      onClick={() => setSelectedSuspect(suspect.name)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-[#FFFFFF] border-[#171717] ring-2 ring-[#171717] shadow-xs'
                          : 'bg-[#FFFFFF] border-[#E5E5E5] hover:border-[#A3A3A3]'
                      }`}
                    >
                      <div>
                        <div className="font-heading font-bold text-xs text-[#171717]">{suspect.name}</div>
                        <div className="text-[10px] font-mono text-[#737373]">{suspect.role}</div>
                      </div>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected ? 'border-[#171717] bg-[#171717]' : 'border-[#D4D4D4]'
                      }`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Forensic Explanation */}
            <div className="space-y-1.5">
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">
                Evidence &amp; Forensic Explanation <span className="text-[#B42318]">*</span>
              </label>
              <textarea
                rows={4}
                required
                disabled={isSubmittingQ2 || isRoundEnded}
                value={explanationText}
                onChange={(e) => setExplanationText(e.target.value)}
                placeholder="Detail your evidence: Which clues contradict their statement? How does the camera recording, timestamps, or access records prove who took ORION?"
                className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-xs sm:text-sm text-[#171717] placeholder-[#A3A3A3] focus:outline-none focus:border-[#171717] transition-colors leading-relaxed resize-none"
              />
              <div className="flex items-center justify-between text-[11px] font-mono text-[#737373]">
                <span>{explanationText.trim().length} characters (min. 10)</span>
                <span>Rubric: Suspect (0-2 pts) · Evidence (0-2 pts) · Logic (0-1 pt)</span>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2">
              <button
                type="submit"
                disabled={isSubmittingQ2 || isRoundEnded || !selectedSuspect || explanationText.trim().length < 10}
                className="px-6 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shadow-xs cursor-pointer"
              >
                {isSubmittingQ2 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Submit Final Conclusion</span>
              </button>
            </div>
          </form>
        )}
      </section>

      {/* =========================================================================
          IMAGE MODAL / LIGHTBOX
         ========================================================================= */}
      {isImageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setIsImageModalOpen(false)}
              className="absolute -top-10 right-0 text-white hover:text-[#FF8A24] cursor-pointer flex items-center gap-1 font-mono text-xs"
            >
              <X className="w-5 h-5" /> Close (Esc)
            </button>
            <img
              src="/the_vanishing_prototype.jpg"
              alt="Investigation Scene Detailed View"
              className="max-h-[85vh] w-auto object-contain rounded-xl shadow-2xl border border-white/20"
            />
          </div>
        </div>
      )}
    </div>
  );
};

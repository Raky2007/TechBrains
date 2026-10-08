import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTeam } from '../layouts/TeamLayout';
import { CountdownTimer } from '../components/CountdownTimer';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { Level1AnswerChoice, TeamPrivateState } from '@nexus/shared';
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';

const ANSWER_LABELS: Record<Level1AnswerChoice, string> = {
  AI: 'AI Made',
  HUMAN: 'Human Made',
  CANT_DEFINE: "Can't Determine"
};

// How long the correct-answer result stays on screen before auto-advancing.
// Presentation-only; the server does not depend on this delay for scoring.
const RESULT_DISPLAY_MS = 1000;

export const Level1GamePage: React.FC = () => {
  const { team, gameState, refreshTeam, refreshGameState } = useTeam();

  const [level1State, setLevel1State] = useState<TeamPrivateState['level1'] | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<Level1AnswerChoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    is_correct: boolean;
    awarded_points: number;
    correct_answer: Level1AnswerChoice;
    timed_out?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResolvingRef = useRef<boolean>(false);

  const loadProgress = useCallback(async () => {
    try {
      const res = await apiFetch<TeamPrivateState>('/api/game/team-state');
      setLevel1State(res.level1 || null);
    } catch (err: any) {
      console.error('Failed to load team progress:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Clear the result and move to the next question (fetches fresh server state).
  const advanceToNext = useCallback(async () => {
    setFeedback(null);
    setSelectedChoice(null);
    setError(null);
    isResolvingRef.current = false;
    await loadProgress();
  }, [loadProgress]);

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
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [loadProgress, refreshGameState]);

  const currentQ = level1State?.current_question;
  const isCompleted = level1State?.is_completed || false;
  const isRoundEnded = gameState?.status === 'level1_ended';

  // Keyboard shortcuts (A/1, B/2, C/3) — disabled while a result is showing.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSubmitting || feedback || isCompleted || isRoundEnded) return;
      const key = e.key.toUpperCase();
      if (key === 'A' || key === '1') setSelectedChoice('AI');
      if (key === 'B' || key === '2') setSelectedChoice('HUMAN');
      if (key === 'C' || key === '3') setSelectedChoice('CANT_DEFINE');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, feedback, isCompleted, isRoundEnded]);

  const scheduleAdvance = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      advanceToNext();
    }, RESULT_DISPLAY_MS);
  }, [advanceToNext]);

  const handleSubmitAnswer = useCallback(
    async (choice: Level1AnswerChoice) => {
      if (!currentQ || isSubmitting || feedback) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const res = await apiFetch<{
          is_correct: boolean;
          awarded_points: number;
          correct_answer: Level1AnswerChoice;
        }>('/api/game/level1/answer', {
          method: 'POST',
          body: JSON.stringify({ question_id: currentQ.id, selected_answer: choice })
        });
        setFeedback({
          is_correct: res.is_correct,
          awarded_points: res.awarded_points,
          correct_answer: res.correct_answer
        });
        await refreshTeam();
        scheduleAdvance(); // show result briefly, then auto-advance
      } catch (err: any) {
        // Server-authoritative timeout (or a race at the deadline): treat as a
        // timed-out question and advance without scoring.
        const msg = err?.message || '';
        if (/time is up|timed out|already submitted/i.test(msg)) {
          setFeedback({ is_correct: false, awarded_points: 0, correct_answer: 'CANT_DEFINE', timed_out: true });
          scheduleAdvance();
        } else {
          setError(msg || 'Failed to submit answer.');
          setIsSubmitting(false);
        }
        return;
      }
      setIsSubmitting(false);
    },
    [currentQ, isSubmitting, feedback, refreshTeam, scheduleAdvance]
  );

  // Server-authoritative per-question timeout. When the on-screen countdown
  // reaches zero we stop accepting input and advance; the server has already
  // (or will on next fetch) treat the question as a 0-point timeout.
  const handleTimeout = useCallback(() => {
    if (isResolvingRef.current || feedback || isSubmitting) return;
    isResolvingRef.current = true;
    setFeedback({ is_correct: false, awarded_points: 0, correct_answer: 'CANT_DEFINE', timed_out: true });
    scheduleAdvance();
  }, [feedback, isSubmitting, scheduleAdvance]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 font-mono text-[#737373] text-sm">
        <Loader2 className="w-7 h-7 animate-spin text-[#171717]" />
        <span>Loading questions…</span>
      </div>
    );
  }

  // Completion / round-ended state
  if ((isCompleted || isRoundEnded) && !feedback) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-6 shadow-sm">
        <div className="w-14 h-14 rounded-full bg-[#18794E]/10 border border-[#18794E]/20 text-[#18794E] mx-auto flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <div className="space-y-2">
          <span className="text-xs font-mono uppercase tracking-widest text-[#737373] font-bold">ROUND 1 COMPLETE</span>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-[#171717]">All questions answered</h1>
          <p className="text-xs sm:text-sm text-[#737373] max-w-md mx-auto leading-relaxed">
            Your responses are recorded. Please wait — the host will start Round 2 for qualified teams.
          </p>
        </div>
        <div className="p-6 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] max-w-xs mx-auto space-y-1">
          <span className="text-xs font-mono text-[#737373] uppercase font-bold">Total Round 1 Score</span>
          <div className="text-4xl font-heading font-bold text-[#171717] font-mono">
            {team?.level1_score ?? 0} <span className="text-base text-[#737373] font-normal">pts</span>
          </div>
          <span className="text-xs font-mono text-[#737373] block pt-1">
            {level1State?.answered_count ?? 0} of {level1State?.total_assigned ?? 0} answered
          </span>
        </div>
        <div className="pt-4 border-t border-[#E5E5E5] flex items-center justify-center">
          <div className="px-6 py-3 rounded-xl font-mono text-xs tracking-wider uppercase text-[#737373] bg-[#F5F5F2] border border-[#E5E5E5] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#737373]" />
            <span>Waiting for host to continue</span>
          </div>
        </div>
      </div>
    );
  }

  const questionNumber = currentQ ? String(currentQ.question_order).padStart(2, '0') : '01';
  const totalQuestions = currentQ ? String(currentQ.total_questions).padStart(2, '0') : '01';
  const options: Level1AnswerChoice[] = ['AI', 'HUMAN', 'CANT_DEFINE'];
  const optionMeta: Record<Level1AnswerChoice, { letter: string; sub: string }> = {
    AI: { letter: 'A', sub: 'Synthetic Artifact' },
    HUMAN: { letter: 'B', sub: 'Authentic Source' },
    CANT_DEFINE: { letter: 'C', sub: 'Ambiguous' }
  };

  const inputsLocked = isSubmitting || !!feedback;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header: question counter + per-question timer */}
      <div className="flex items-center justify-between pb-4 border-b border-[#E5E5E5]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">QUESTION</span>
          <span className="px-3 py-1 rounded-md bg-[#F5F5F2] border border-[#E5E5E5] font-mono text-sm font-bold text-[#171717]">
            {questionNumber} / {totalQuestions}
          </span>
        </div>
        {/* Per-question server-authoritative countdown (frozen once answered). */}
        <CountdownTimer
          deadlineAt={currentQ?.deadline_at || null}
          isPaused={!!feedback}
          remainingSeconds={currentQ?.time_limit_seconds || 0}
          onExpire={handleTimeout}
        />
      </div>

      {currentQ && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
          <div className="space-y-2">
            <h2 className="text-xl font-heading font-bold text-[#171717]">{currentQ.title}</h2>
            {currentQ.prompt && (
              <p className="text-sm text-[#737373] leading-relaxed whitespace-pre-wrap font-body">{currentQ.prompt}</p>
            )}
          </div>

          {currentQ.media_path && (
            <div className="rounded-xl overflow-hidden border border-[#E5E5E5] bg-[#F5F5F2] max-h-96 flex items-center justify-center p-2">
              {currentQ.content_type === 'image' && (
                <img src={currentQ.media_path} alt={currentQ.title} className="max-h-96 w-full object-contain rounded-lg" />
              )}
              {currentQ.content_type === 'video' && (
                <video src={currentQ.media_path} controls className="max-h-96 w-full object-contain rounded-lg" />
              )}
            </div>
          )}

          {/* Options — clicking submits immediately (no separate submit step). */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2">
            {options.map((opt) => {
              const meta = optionMeta[opt];
              const isChosen = selectedChoice === opt;
              const isTheCorrect = feedback && feedback.correct_answer === opt;
              let stateClass = 'bg-[#FFFFFF] border-[#E5E5E5] text-[#171717] hover:border-[#171717]';
              if (feedback) {
                if (isTheCorrect) stateClass = 'bg-[#18794E]/10 border-[#18794E] text-[#171717]';
                else if (isChosen) stateClass = 'bg-[#B42318]/10 border-[#B42318] text-[#171717]';
                else stateClass = 'bg-[#FFFFFF] border-[#E5E5E5] text-[#A3A3A3]';
              } else if (isChosen) {
                stateClass = 'bg-[#FFC928] border-[#171717] text-[#171717] shadow-xs';
              }
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={inputsLocked}
                  onClick={() => {
                    setSelectedChoice(opt);
                    handleSubmitAnswer(opt);
                  }}
                  className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer disabled:cursor-not-allowed ${stateClass}`}
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-sm shrink-0 bg-[#F5F5F2] border border-[#E5E5E5] text-[#171717]">
                    {meta.letter}
                  </div>
                  <div>
                    <div className="font-heading font-bold text-sm text-[#171717]">{ANSWER_LABELS[opt]}</div>
                    <div className="text-[11px] font-mono text-[#737373]">{meta.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Result — shown briefly, then auto-advances. No manual Next button. */}
          {feedback && (
            <div
              className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                feedback.timed_out
                  ? 'bg-[#F5F5F2] border-[#E5E5E5]'
                  : feedback.awarded_points > 0
                  ? 'bg-[#18794E]/5 border-[#18794E]/20'
                  : feedback.awarded_points < 0
                  ? 'bg-[#B42318]/5 border-[#B42318]/20'
                  : 'bg-[#F5F5F2] border-[#E5E5E5]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {feedback.timed_out ? (
                  <AlertCircle className="w-5 h-5 text-[#737373] shrink-0" />
                ) : feedback.awarded_points > 0 ? (
                  <CheckCircle2 className="w-5 h-5 text-[#18794E] shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#B42318] shrink-0" />
                )}
                <div>
                  <div className="font-heading font-bold text-sm text-[#171717]">
                    {feedback.timed_out ? "Time's up" : feedback.awarded_points > 0 ? 'Correct' : feedback.awarded_points < 0 ? 'Incorrect' : 'Recorded'}
                  </div>
                  <div className="text-xs text-[#737373] font-body">
                    Correct answer: <strong className="text-[#171717]">{ANSWER_LABELS[feedback.correct_answer]}</strong>
                  </div>
                </div>
              </div>
              <div
                className={`font-mono text-sm font-bold shrink-0 ${
                  feedback.awarded_points > 0 ? 'text-[#18794E]' : feedback.awarded_points < 0 ? 'text-[#B42318]' : 'text-[#737373]'
                }`}
              >
                {feedback.awarded_points > 0 ? '+' : ''}
                {feedback.awarded_points} PT
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-between">
            <span className="hidden sm:inline-block text-[11px] font-mono text-[#737373]">Shortcuts: [A/1] [B/2] [C/3]</span>
            {feedback && (
              <span className="text-[11px] font-mono text-[#737373] flex items-center gap-1.5 ml-auto">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Next question…
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

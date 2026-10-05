import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTeam } from '../layouts/TeamLayout';
import { CountdownTimer } from '../components/CountdownTimer';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { ClientLevel1Question, Level1AnswerChoice, TeamPrivateState } from '@nexus/shared';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  Loader2,
  Play
} from 'lucide-react';

export const Level1GamePage: React.FC = () => {
  const navigate = useNavigate();
  const { team, gameState, refreshTeam, refreshGameState } = useTeam();

  const [level1State, setLevel1State] = useState<TeamPrivateState['level1'] | null>(null);
  const [selectedChoice, setSelectedChoice] = useState<Level1AnswerChoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isStartingLevel2, setIsStartingLevel2] = useState<boolean>(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<{
    is_correct: boolean;
    awarded_points: number;
    explanation: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Fetch private team Level 1 state
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

  const currentQ = level1State?.current_question;
  const isCompleted = level1State?.is_completed || false;
  const isRoundEnded = gameState?.status === 'level1_ended';

  // Keyboard shortcut handler (A/1, B/2, C/3)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSubmitting || submissionFeedback || isCompleted || isRoundEnded) return;

      const key = e.key.toUpperCase();
      if (key === 'A' || key === '1') setSelectedChoice('AI');
      if (key === 'B' || key === '2') setSelectedChoice('HUMAN');
      if (key === 'C' || key === '3') setSelectedChoice('CANT_DEFINE');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSubmitting, submissionFeedback, isCompleted, isRoundEnded]);

  const handleSubmitAnswer = async () => {
    if (!currentQ || !selectedChoice || isSubmitting || submissionFeedback) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch<{
        is_correct: boolean;
        awarded_points: number;
        explanation: string | null;
        new_team_score: number;
      }>('/api/game/level1/answer', {
        method: 'POST',
        body: JSON.stringify({
          question_id: currentQ.id,
          selected_answer: selectedChoice
        })
      });

      setSubmissionFeedback({
        is_correct: res.is_correct,
        awarded_points: res.awarded_points,
        explanation: res.explanation
      });

      await refreshTeam();

      // Automatically advance to next question after 1200ms
      setTimeout(async () => {
        setSubmissionFeedback(null);
        setSelectedChoice(null);
        await loadProgress();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Failed to submit answer.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProceedToLevel2 = async () => {
    setIsStartingLevel2(true);
    setError(null);
    try {
      await apiFetch('/api/game/start-level', {
        method: 'POST',
        body: JSON.stringify({ level: 2 })
      });
      await refreshGameState();
      navigate('/level2');
    } catch (err: any) {
      setError(err.message || 'Failed to start Level 2.');
      setIsStartingLevel2(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 font-mono text-[#737373] text-sm">
        <Loader2 className="w-7 h-7 animate-spin text-[#171717]" />
        <span>Loading forensic questions...</span>
      </div>
    );
  }

  // Completion State
  if (isCompleted || isRoundEnded) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-6 shadow-sm">
        <div className="w-14 h-14 rounded-full bg-[#18794E]/10 border border-[#18794E]/20 text-[#18794E] mx-auto flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-mono uppercase tracking-widest text-[#737373] font-bold">
            LEVEL 1 COMPLETED
          </span>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-[#171717]">
            AI vs Human Discrimination Concluded
          </h1>
          <p className="text-xs sm:text-sm text-[#737373] max-w-md mx-auto leading-relaxed">
            Your responses have been recorded and scored. You may now proceed directly to Phase 2: Clues with Credits.
          </p>
        </div>

        <div className="p-6 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] max-w-xs mx-auto space-y-1">
          <span className="text-xs font-mono text-[#737373] uppercase font-bold">Total Level 1 Score</span>
          <div className="text-4xl font-heading font-bold text-[#171717] font-mono">
            {team?.level1_score ?? 0} <span className="text-base text-[#737373] font-normal">pts</span>
          </div>
          <span className="text-xs font-mono text-[#737373] block pt-1">
            {level1State?.answered_count ?? 0} of {level1State?.total_assigned ?? 0} questions evaluated
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs font-medium">
            {error}
          </div>
        )}

        <div className="pt-4 border-t border-[#E5E5E5] flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => navigate('/waiting')}
            className="w-full sm:w-auto px-5 py-3 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] border border-[#E5E5E5] transition-colors cursor-pointer"
          >
            &larr; Waiting Room
          </button>
          <button
            onClick={handleProceedToLevel2}
            disabled={isStartingLevel2}
            className="w-full sm:w-auto px-6 py-3 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
          >
            {isStartingLevel2 ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                <span>OPENING LEVEL 2...</span>
              </>
            ) : (
              <>
                <span>PROCEED TO LEVEL 2: CLUES & CREDITS</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Active Gameplay UI
  const questionNumber = currentQ ? String(currentQ.question_order).padStart(2, '0') : '01';
  const totalQuestions = currentQ ? String(currentQ.total_questions).padStart(2, '0') : '01';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Header: Question counter & countdown timer */}
      <div className="flex items-center justify-between pb-4 border-b border-[#E5E5E5]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">
            QUESTION
          </span>
          <span className="px-3 py-1 rounded-md bg-[#F5F5F2] border border-[#E5E5E5] font-mono text-sm font-bold text-[#171717]">
            {questionNumber} / {totalQuestions}
          </span>
          {currentQ?.category && (
            <span className="hidden sm:inline-block px-2.5 py-1 rounded text-xs font-mono text-[#737373] bg-[#F5F5F2] border border-[#E5E5E5]">
              {currentQ.category}
            </span>
          )}
        </div>

        {/* Server Authoritative Timer with light style & #FF8A24 warning */}
        <CountdownTimer
          deadlineAt={gameState?.round?.deadline_at || null}
          isPaused={gameState?.round?.is_paused || false}
          remainingSeconds={gameState?.round?.remaining_seconds || 0}
        />
      </div>

      {/* Main Question Card: #FFFFFF, border #E5E5E5 */}
      {currentQ && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
          {/* Title & Prompt */}
          <div className="space-y-2">
            <h2 className="text-xl font-heading font-bold text-[#171717]">
              {currentQ.title}
            </h2>
            <p className="text-sm text-[#737373] leading-relaxed whitespace-pre-wrap font-body">
              {currentQ.prompt}
            </p>
          </div>

          {/* Media Area (Contained & Responsive) */}
          {currentQ.media_path && (
            <div className="rounded-xl overflow-hidden border border-[#E5E5E5] bg-[#F5F5F2] max-h-96 flex items-center justify-center p-2">
              {currentQ.content_type === 'image' && (
                <img
                  src={currentQ.media_path}
                  alt={currentQ.title}
                  className="max-h-96 w-full object-contain rounded-lg"
                />
              )}
              {currentQ.content_type === 'video' && (
                <video
                  src={currentQ.media_path}
                  controls
                  className="max-h-96 w-full object-contain rounded-lg"
                />
              )}
            </div>
          )}

          {/* Option Buttons: A, B, C with yellow #FFC928 active state */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2">
            {/* Option A: AI Made */}
            <button
              type="button"
              disabled={isSubmitting || !!submissionFeedback}
              onClick={() => setSelectedChoice('AI')}
              className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                selectedChoice === 'AI'
                  ? 'bg-[#FFC928] border-[#171717] text-[#171717] shadow-xs'
                  : 'bg-[#FFFFFF] border-[#E5E5E5] text-[#171717] hover:border-[#171717]'
              } disabled:cursor-not-allowed`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-sm shrink-0 ${
                  selectedChoice === 'AI'
                    ? 'bg-[#171717] text-white'
                    : 'bg-[#F5F5F2] border border-[#E5E5E5] text-[#171717]'
                }`}
              >
                A
              </div>
              <div>
                <div className="font-heading font-bold text-sm text-[#171717]">AI Made</div>
                <div className="text-[11px] font-mono text-[#737373]">Synthetic Artifact</div>
              </div>
            </button>

            {/* Option B: Human Made */}
            <button
              type="button"
              disabled={isSubmitting || !!submissionFeedback}
              onClick={() => setSelectedChoice('HUMAN')}
              className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                selectedChoice === 'HUMAN'
                  ? 'bg-[#FFC928] border-[#171717] text-[#171717] shadow-xs'
                  : 'bg-[#FFFFFF] border-[#E5E5E5] text-[#171717] hover:border-[#171717]'
              } disabled:cursor-not-allowed`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-sm shrink-0 ${
                  selectedChoice === 'HUMAN'
                    ? 'bg-[#171717] text-white'
                    : 'bg-[#F5F5F2] border border-[#E5E5E5] text-[#171717]'
                }`}
              >
                B
              </div>
              <div>
                <div className="font-heading font-bold text-sm text-[#171717]">Human Made</div>
                <div className="text-[11px] font-mono text-[#737373]">Authentic Source</div>
              </div>
            </button>

            {/* Option C: Can't Define */}
            <button
              type="button"
              disabled={isSubmitting || !!submissionFeedback}
              onClick={() => setSelectedChoice('CANT_DEFINE')}
              className={`p-4 rounded-xl border text-left flex items-center gap-3 transition-all cursor-pointer ${
                selectedChoice === 'CANT_DEFINE'
                  ? 'bg-[#FFC928] border-[#171717] text-[#171717] shadow-xs'
                  : 'bg-[#FFFFFF] border-[#E5E5E5] text-[#171717] hover:border-[#171717]'
              } disabled:cursor-not-allowed`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-sm shrink-0 ${
                  selectedChoice === 'CANT_DEFINE'
                    ? 'bg-[#171717] text-white'
                    : 'bg-[#F5F5F2] border border-[#E5E5E5] text-[#171717]'
                }`}
              >
                C
              </div>
              <div>
                <div className="font-heading font-bold text-sm text-[#171717]">Can't Define</div>
                <div className="text-[11px] font-mono text-[#737373]">Forensically Ambiguous</div>
              </div>
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3.5 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submission Feedback */}
          {submissionFeedback && (
            <div
              className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                submissionFeedback.is_correct
                  ? 'bg-[#18794E]/5 border-[#18794E]/20 text-[#18794E]'
                  : 'bg-[#F5F5F2] border-[#E5E5E5] text-[#171717]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {submissionFeedback.is_correct ? (
                  <CheckCircle2 className="w-5 h-5 text-[#18794E] shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#B42318] shrink-0" />
                )}
                <div>
                  <div className="font-heading font-bold text-sm text-[#171717]">
                    {submissionFeedback.is_correct ? 'Correct Verdict' : 'Verdict Recorded'}
                  </div>
                  {submissionFeedback.explanation && (
                    <p className="text-xs text-[#737373] mt-0.5 font-body">
                      {submissionFeedback.explanation}
                    </p>
                  )}
                </div>
              </div>
              <div className="font-mono text-sm font-bold text-[#171717] shrink-0">
                +{submissionFeedback.awarded_points} PT
              </div>
            </div>
          )}

          {/* Action Footer: Primary CTA #FFC928 */}
          <div className="pt-4 border-t border-[#E5E5E5] flex items-center justify-between">
            <span className="hidden sm:inline-block text-[11px] font-mono text-[#737373]">
              Keyboard shortcuts: [A/1], [B/2], [C/3]
            </span>

            <button
              type="button"
              disabled={!selectedChoice || isSubmitting || !!submissionFeedback}
              onClick={handleSubmitAnswer}
              className="w-full sm:w-auto px-7 py-3 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs ml-auto cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                  <span>RECORDING...</span>
                </>
              ) : (
                <>
                  <span>SUBMIT VERDICT</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

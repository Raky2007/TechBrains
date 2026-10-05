import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeam } from '../layouts/TeamLayout';
import { motion } from 'framer-motion';
import { BRANDING } from '@nexus/shared';
import { apiFetch } from '../lib/api';
import { Play, Coins, ArrowRight, Brain, Search, CheckCircle2, Loader2, Sparkles } from 'lucide-react';

export const WaitingRoomPage: React.FC = () => {
  const navigate = useNavigate();
  const { team, gameState, refreshTeam, refreshGameState } = useTeam();
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStartLevel1 = async () => {
    setIsStarting(true);
    setStartError(null);
    try {
      await apiFetch('/api/game/start-level', {
        method: 'POST',
        body: JSON.stringify({ level: 1 })
      });
      await refreshGameState();
      navigate('/level1');
    } catch (err: any) {
      setStartError(err.message || 'Failed to start Level 1.');
      setIsStarting(false);
    }
  };

  const isLevel1Active = gameState?.status === 'level1_active';
  const isLevel2Active = gameState?.status === 'level2_active';

  return (
    <div className="max-w-4xl mx-auto py-6 sm:py-10 space-y-8">
      {/* Top Banner Card: #FFFFFF, border #E5E5E5 */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <span className="inline-block text-[11px] font-mono uppercase font-bold tracking-wider px-2.5 py-0.5 rounded bg-[#F5F5F2] text-[#171717] border border-[#E5E5E5]">
              PARTICIPANT TERMINAL
            </span>

            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-[#171717] tracking-tight">
              Welcome, <span className="underline decoration-[#FFC928] decoration-4 underline-offset-4">{team?.team_name}</span>
            </h1>

            <p className="text-sm text-[#737373] max-w-xl leading-relaxed">
              Your workstation is authenticated and connected. You can start the Level 1 challenge whenever you are ready.
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-3 shrink-0">
            {/* Credit Badge: #FFF0D6 with dark orange text #B34400 */}
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] font-mono text-xs font-bold">
              <Coins className="w-4 h-4 text-[#B34400]" />
              <span>{team?.current_credits ?? 200} Credits Allocated</span>
            </div>

            <span className="text-xs font-mono text-[#737373]">
              Round Duration: {gameState?.settings.level1DurationMinutes ?? 10} Minutes
            </span>
          </div>
        </div>

        {/* Direct Start Action: Primary CTA #FFC928 */}
        <div className="pt-6 border-t border-[#E5E5E5] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#F5F5F2] -mx-6 sm:-mx-8 -mb-6 sm:-mb-8 p-6 sm:p-8 rounded-b-2xl">
          <div className="space-y-1">
            <span className="text-xs font-heading font-bold text-[#171717] uppercase tracking-wide block">
              Ready to begin?
            </span>
            <p className="text-xs text-[#737373]">
              Click to launch the Level 1 neural media challenge immediately.
            </p>
          </div>

          <button
            type="button"
            disabled={isStarting}
            onClick={handleStartLevel1}
            className="px-8 py-3.5 rounded-xl font-heading font-bold text-sm tracking-wide text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer shrink-0 disabled:opacity-50"
          >
            {isStarting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                <span>STARTING LEVEL 1...</span>
              </>
            ) : isLevel1Active ? (
              <>
                <span>ENTER LEVEL 1 NOW</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-[#171717]" />
                <span>START LEVEL 1 INVESTIGATION</span>
              </>
            )}
          </button>
        </div>

        {startError && (
          <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/30 text-[#B42318] text-xs font-medium">
            {startError}
          </div>
        )}
      </div>

      {/* Two-Level Overview Cards: Cards #FFFFFF with #E5E5E5 borders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Level 1 Card */}
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-6 space-y-4 shadow-xs">
          <div className="w-10 h-10 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] flex items-center justify-center text-[#171717]">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#737373] font-bold">
              PHASE 01
            </span>
            <h2 className="text-lg font-heading font-bold text-[#171717] mt-0.5">
              Level 1: AI vs Human
            </h2>
          </div>
          <p className="text-xs text-[#737373] leading-relaxed">
            Inspect synthetic and authentic media artifacts across high-resolution imagery, audio transcripts, and technical code snippets.
          </p>
          <ul className="text-xs text-[#737373] space-y-2 border-t border-[#E5E5E5] pt-4">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#18794E]" />
              <span><strong>A. AI Made</strong> (+1 point if correct)</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#18794E]" />
              <span><strong>B. Human Made</strong> (+1 point if correct)</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#737373]" />
              <span><strong>C. Can't Define</strong> (0 points)</span>
            </li>
          </ul>
        </div>

        {/* Level 2 Card */}
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-6 space-y-4 shadow-xs">
          <div className="w-10 h-10 rounded-lg bg-[#FFF0D6] border border-[#FED7AA] flex items-center justify-center text-[#B34400]">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#B34400] font-bold">
              PHASE 02
            </span>
            <h2 className="text-lg font-heading font-bold text-[#171717] mt-0.5">
              Level 2: Clues with Credits
            </h2>
          </div>
          <p className="text-xs text-[#737373] leading-relaxed">
            Forensic incident investigation. Spend your allocated 200 credits to unlock classified network captures, badge logs, and malware memory dumps.
          </p>
          <ul className="text-xs text-[#737373] space-y-2 border-t border-[#E5E5E5] pt-4">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#B34400]" />
              <span>Purchase forensic clues with your team's credits.</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#B34400]" />
              <span>Synthesize conclusions citing evidence artifacts.</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#B34400]" />
              <span>Scored on Accuracy (10), Reasoning (5), and Efficiency (5).</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

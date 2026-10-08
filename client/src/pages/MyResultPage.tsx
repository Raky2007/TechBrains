import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useTeam } from '../layouts/TeamLayout';
import { LeaderboardEntry } from '@nexus/shared';
import confetti from 'canvas-confetti';

/** A team's own result only — never other teams, never a ranking. */
type OwnResult = Omit<LeaderboardEntry, 'rank'>;

/**
 * Participant "My Result" page (TechBrains).
 *
 * Privacy: shows ONLY this team's own score/status. There is no global
 * leaderboard, no ranking, and no visibility into other teams. This is
 * enforced server-side via GET /api/game/my-result (team-scoped); the full
 * standings endpoint is admin-only.
 */
export const MyResultPage: React.FC = () => {
  const { team } = useTeam();
  const [result, setResult] = useState<OwnResult | null>(null);
  const [isPublished, setIsPublished] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchResult = async () => {
    try {
      const res = await apiFetch<{ is_published: boolean; result: OwnResult | null }>(
        '/api/game/my-result'
      );
      setIsPublished(res.is_published);
      if (res.is_published && res.result) {
        setResult(res.result);
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 } });
      }
    } catch (err) {
      console.error('Failed to load your result:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchResult();

    const socket = getSocket();
    // Participants only receive a scores-free "results published" signal; they
    // then fetch their OWN result. They never receive global standings.
    const handlePublished = () => fetchResult();
    socket.on('results:published', handlePublished);
    return () => {
      socket.off('results:published', handlePublished);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center font-mono text-sm text-[#737373]">
        Loading your result…
      </div>
    );
  }

  if (!isPublished || !result) {
    return (
      <div className="max-w-md mx-auto my-16 bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-3 shadow-sm">
        <h2 className="text-xl font-heading font-bold text-[#171717]">Results Not Published Yet</h2>
        <p className="text-xs text-[#737373] leading-relaxed">
          The evaluation committee is reviewing submissions. Your result will
          appear here automatically once the administrator publishes it.
        </p>
      </div>
    );
  }

  const stats = [
    { label: 'Round 1', value: `${result.level1_score} pts`, sub: `${result.level1_accuracy_percent}% accuracy` },
    { label: 'Round 2', value: `${result.level2_score} pts`, sub: `${result.credits_spent} credits used` },
  ];

  return (
    <div className="max-w-xl mx-auto py-10 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl sm:text-3xl font-heading font-bold text-[#171717]">Your Result</h1>
        <p className="text-sm text-[#737373]">
          Team{' '}
          <span className="font-heading font-bold text-[#171717]">{team?.team_name ?? result.team_name}</span>
        </p>
      </div>

      {/* Total score highlight */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="bg-[#FFFFFF] border-2 border-[#FFC928] rounded-2xl p-8 text-center shadow-sm space-y-1"
      >
        <span className="text-xs font-mono uppercase tracking-wider text-[#737373] font-bold">
          Final Score
        </span>
        <div className="text-5xl font-heading font-extrabold text-[#171717] font-mono">
          {result.final_score}
        </div>
      </motion.div>

      {/* Per-round breakdown (own scores only) */}
      <div className="grid grid-cols-2 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-5 text-center shadow-xs">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#737373] font-bold block">
              {s.label}
            </span>
            <div className="text-xl font-heading font-bold text-[#171717] mt-1">{s.value}</div>
            <span className="text-xs text-[#737373] block mt-0.5">{s.sub}</span>
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] font-mono text-[#737373]">
        Only your team's own result is shown here.
      </p>
    </div>
  );
};

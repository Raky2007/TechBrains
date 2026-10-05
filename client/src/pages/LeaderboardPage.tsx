import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { LeaderboardEntry } from '@nexus/shared';
import confetti from 'canvas-confetti';
import { Trophy, Clock, RefreshCw } from 'lucide-react';

export const LeaderboardPage: React.FC = () => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isPublished, setIsPublished] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = async () => {
    try {
      const res = await apiFetch<{ is_published: boolean; leaderboard: LeaderboardEntry[]; message?: string }>('/api/game/leaderboard');
      setIsPublished(res.is_published);
      if (res.is_published) {
        setLeaderboard(res.leaderboard);
        if (res.leaderboard.length > 0) {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.6 }
          });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load leaderboard data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();

    const socket = getSocket();
    const handleLeaderboardPublished = (data: LeaderboardEntry[]) => {
      setIsPublished(true);
      setLeaderboard(data);
      confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
    };

    socket.on('leaderboard:published', handleLeaderboardPublished);
    return () => {
      socket.off('leaderboard:published', handleLeaderboardPublished);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center font-mono text-sm text-[#171717] gap-3">
        <RefreshCw className="w-6 h-6 animate-spin text-[#FFC928]" />
        <span>Tabulating authoritative tournament standings...</span>
      </div>
    );
  }

  if (!isPublished) {
    return (
      <div className="max-w-md mx-auto my-16 bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] mx-auto flex items-center justify-center">
          <Clock className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-heading font-bold text-[#171717]">
          Official Standings Embargoed
        </h2>
        <p className="text-xs text-[#6B7280] leading-relaxed">
          The evaluation committee is currently reviewing forensic conclusions. Final results will appear automatically once published by event officials.
        </p>
      </div>
    );
  }

  const top3 = leaderboard.slice(0, 3);

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-16">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F5F5F2] text-[#171717] font-mono text-xs border border-[#E5E5E5]">
          <Trophy className="w-3.5 h-3.5 text-[#FFC928]" />
          <span className="font-semibold">AUTHORITATIVE FINAL CLASSIFICATION</span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-heading font-bold text-[#171717]">
          Official Tournament Standings
        </h1>
        <p className="text-xs sm:text-sm text-[#6B7280] max-w-lg mx-auto">
          Final Score = Level 1 Score + Level 2 Score. Tie-breakers: Level 2 score, Level 1 accuracy %, submission timestamp.
        </p>
      </div>

      {/* Top 3 Podium Highlights */}
      {top3.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          {top3.map((entry, index) => {
            const isWinner = index === 0;
            const rankCardStyle = isWinner
              ? 'border-2 border-[#FFC928] bg-[#FFFFFF] shadow-md md:-translate-y-2'
              : 'border border-[#E5E5E5] bg-[#FFFFFF] shadow-sm';

            const badgeStyles = [
              'bg-[#FFC928] text-[#171717] font-bold',
              'bg-[#E5E5E5] text-[#171717] font-semibold',
              'bg-[#F5F5F2] text-[#171717] border border-[#E5E5E5] font-semibold',
            ][index];

            return (
              <motion.div
                key={entry.team_id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: index * 0.08 }}
                className={`rounded-2xl p-6 flex flex-col justify-between space-y-4 relative overflow-hidden ${rankCardStyle}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`px-2.5 py-0.5 rounded-full font-mono text-xs ${badgeStyles}`}>
                    RANK #{entry.rank}
                  </span>
                  <Trophy className={`w-5 h-5 ${isWinner ? 'text-[#FFC928]' : 'text-[#6B7280]'}`} />
                </div>

                <div>
                  <h3 className="text-lg font-heading font-bold text-[#171717] truncate" title={entry.team_name}>
                    {entry.team_name}
                  </h3>
                  <span className="text-xs font-mono text-[#6B7280]">
                    L1 Accuracy: {entry.level1_accuracy_percent}%
                  </span>
                </div>

                <div className="pt-3 border-t border-[#E5E5E5] grid grid-cols-3 gap-2 text-center font-mono">
                  <div>
                    <span className="text-[10px] text-[#6B7280] block">LEVEL 1</span>
                    <span className="text-sm font-semibold text-[#171717]">{entry.level1_score}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#6B7280] block">LEVEL 2</span>
                    <span className="text-sm font-semibold text-[#171717]">{entry.level2_score}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#171717] font-bold block">TOTAL</span>
                    <span className="text-base font-bold text-[#171717]">{entry.final_score}</span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Complete Standings Table (Optimized for 30+ teams) */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#E5E5E5] flex items-center justify-between bg-[#F5F5F2]">
          <span className="text-xs font-mono font-semibold text-[#171717] uppercase tracking-wider">
            ALL PARTICIPATING TEAMS ({leaderboard.length})
          </span>
          <span className="text-xs font-mono text-[#18794E] font-semibold">● LIVE VERIFIED</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#6B7280] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Team Designation</th>
                <th className="py-3 px-4 text-center">Level 1</th>
                <th className="py-3 px-4 text-center">L1 Acc</th>
                <th className="py-3 px-4 text-center">Level 2</th>
                <th className="py-3 px-4 text-center">Credits Used</th>
                <th className="py-3 px-4 text-right">Final Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5] font-mono">
              {leaderboard.map((entry, idx) => {
                const isEven = idx % 2 === 1;
                return (
                  <tr
                    key={entry.team_id}
                    className={`transition-colors hover:bg-[#FFF0D6]/40 ${
                      entry.rank === 1 ? 'bg-[#FFC928]/10 font-medium' : isEven ? 'bg-[#F5F5F2]/50' : 'bg-[#FFFFFF]'
                    }`}
                  >
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold ${
                          entry.rank === 1
                            ? 'bg-[#FFC928] text-[#171717]'
                            : entry.rank === 2
                            ? 'bg-[#E5E5E5] text-[#171717]'
                            : entry.rank === 3
                            ? 'bg-[#F5F5F2] text-[#171717] border border-[#E5E5E5]'
                            : 'text-[#6B7280]'
                        }`}
                      >
                        {entry.rank}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-heading font-medium text-[#171717] text-sm">
                      {entry.team_name}
                    </td>
                    <td className="py-3 px-4 text-center text-[#6B7280]">
                      {entry.level1_score} pts
                    </td>
                    <td className="py-3 px-4 text-center text-[#6B7280]">
                      {entry.level1_accuracy_percent}%
                    </td>
                    <td className="py-3 px-4 text-center text-[#6B7280]">
                      {entry.level2_score} pts
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[#FFF0D6] text-[#B34400] border border-[#FED7AA]">
                        {entry.credits_spent} CR
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-sm text-[#171717]">
                      {entry.final_score.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

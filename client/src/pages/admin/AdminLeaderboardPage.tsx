import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { LeaderboardEntry } from '@nexus/shared';
import { Download, RefreshCw } from 'lucide-react';

export const AdminLeaderboardPage: React.FC = () => {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchLeaderboard = async () => {
    try {
      const res = await apiFetch<{ leaderboard: LeaderboardEntry[] }>('/api/game/leaderboard');
      setLeaderboard(res.leaderboard || []);
    } catch (err) {
      console.error('Failed to load admin leaderboard:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const handleDownloadCsv = () => {
    window.open('/api/admin/leaderboard/csv', '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">
            Authoritative Tournament Leaderboard
          </h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Real-time calculated standings with forensic tie-breaking rules.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchLeaderboard}
            className="p-2.5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-[#171717] hover:bg-[#E5E5E5] transition-colors cursor-pointer"
            title="Refresh Standings"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-heading font-bold uppercase tracking-wider text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all shadow-xs cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>EXPORT CSV</span>
          </button>
        </div>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4 text-center">Level 1 Score</th>
                <th className="py-3 px-4 text-center">L1 Acc (%)</th>
                <th className="py-3 px-4 text-center">Level 2 Score</th>
                <th className="py-3 px-4 text-center">Credits Spent</th>
                <th className="py-3 px-4 text-center">Status</th>
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
                      entry.rank === 1 ? 'bg-[#FFC928]/10 font-medium' : isEven ? 'bg-[#F5F5F2]/40' : 'bg-[#FFFFFF]'
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
                            : 'text-[#737373]'
                        }`}
                      >
                        {entry.rank}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-heading font-bold text-[#171717] text-sm">
                      {entry.team_name}
                    </td>
                    <td className="py-3 px-4 text-center text-[#737373]">
                      {entry.level1_score} pts
                    </td>
                    <td className="py-3 px-4 text-center text-[#737373]">
                      {entry.level1_accuracy_percent}%
                    </td>
                    <td className="py-3 px-4 text-center text-[#737373]">
                      {entry.level2_score} pts
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400]">
                        {entry.credits_spent} CR
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          entry.evaluation_completed
                            ? 'bg-[#18794E]/10 border-[#18794E]/20 text-[#18794E]'
                            : entry.conclusion_submitted
                            ? 'bg-[#FFF0D6] border-[#FED7AA] text-[#B34400]'
                            : 'bg-[#F5F5F2] border-[#E5E5E5] text-[#737373]'
                        }`}
                      >
                        {entry.evaluation_completed
                          ? 'EVALUATED'
                          : entry.conclusion_submitted
                          ? 'SUBMITTED'
                          : 'IN PROGRESS'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-sm text-[#171717]">
                      {entry.final_score.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
              {leaderboard.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#737373] font-mono">
                    No leaderboard data generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

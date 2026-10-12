import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { getSocket } from '../lib/socket';
import { useTeam } from '../layouts/TeamLayout';
import { LeaderboardEntry } from '@nexus/shared';
import confetti from 'canvas-confetti';
import { Trophy, RefreshCw, Loader2, Award, CheckCircle2 } from 'lucide-react';

/** A team's own result only — competitive rank is stripped before publication. */
type OwnResult = Omit<LeaderboardEntry, 'rank'>;

export const MyResultPage: React.FC = () => {
  const { team, gameState } = useTeam();
  const [result, setResult] = useState<OwnResult | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isPublished, setIsPublished] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const confettiFired = useRef<boolean>(false);

  const fetchResult = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const res = await apiFetch<{ is_published: boolean; has_completed_l2: boolean; result: OwnResult | null }>(
        '/api/game/my-result'
      );
      setIsPublished(res.is_published);
      if (res.result) {
        setResult(res.result);
      }

      // If results are published, retrieve official tournament standings
      if (res.is_published) {
        try {
          const lbRes = await apiFetch<{ is_published: boolean; leaderboard: LeaderboardEntry[] }>(
            '/api/game/leaderboard'
          );
          if (lbRes.leaderboard && lbRes.leaderboard.length > 0) {
            setLeaderboard(lbRes.leaderboard);
            if (!confettiFired.current) {
              confettiFired.current = true;
              confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
            }
          }
        } catch (lbErr) {
          console.error('Failed to load published leaderboard:', lbErr);
        }
      }
    } catch (err) {
      console.error('Failed to load your result:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchResult();

    const socket = getSocket();
    const handlePublished = () => {
      fetchResult(true);
    };

    socket.on('results:published', handlePublished);
    socket.on('leaderboard:published', handlePublished);
    socket.on('game:state_changed', handlePublished);

    return () => {
      socket.off('results:published', handlePublished);
      socket.off('leaderboard:published', handlePublished);
      socket.off('game:state_changed', handlePublished);
    };
  }, []);

  // React immediately whenever gameState updates via context
  useEffect(() => {
    if (gameState?.settings?.resultsPublished || gameState?.status === 'completed') {
      fetchResult(true);
    }
  }, [gameState?.settings?.resultsPublished, gameState?.status]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    fetchResult(true);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 font-mono text-xs text-[#737373]">
        <Loader2 className="w-5 h-5 animate-spin text-[#171717]" />
        <span>Loading…</span>
      </div>
    );
  }

  // =========================================================================
  // EVALUATION (results not yet published) — no marks shown.
  // =========================================================================
  if (!isPublished) {
    const rolls = [team?.player1_roll, team?.player2_roll].filter(Boolean) as string[];
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5]">
          <h1 className="text-xl sm:text-2xl font-heading font-bold tracking-tight text-[#171717]">Evaluation</h1>
          <span className="font-mono text-xs text-[#171717]">
            Team: <strong>{team?.team_name}</strong>
          </span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center gap-6 py-6 max-w-xl mx-auto w-full">
          {/* Calculating */}
          <div className="w-full max-w-md rounded-2xl border border-[#E5E5E5] bg-[#F5F5F2] p-6 sm:p-8 space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-[#B34400] mx-auto" />
            <h2 className="text-lg sm:text-xl font-heading font-bold text-[#171717]">
              Final standings are being calculated.
            </h2>
            <p className="text-sm text-[#737373]">Please wait…</p>
          </div>

          {/* Thank you */}
          <h2 className="text-2xl sm:text-3xl font-heading font-extrabold text-[#171717]">
            Thank you for your participation!
          </h2>

          {/* Content other than marks */}
          <div className="w-full space-y-2.5 text-left">
            {[
              'Round 1 — AI vs Human: completed.',
              'Round 2 — Clues with Credits: submitted and under evaluation.',
              'Your answers are locked. The organizers will announce the official standings.'
            ].map((line) => (
              <div key={line} className="flex items-start gap-2.5 text-sm text-[#525252] leading-relaxed">
                <CheckCircle2 className="w-4 h-4 text-[#18794E] shrink-0 mt-0.5" />
                <span>{line}</span>
              </div>
            ))}
            {rolls.length > 0 && (
              <p className="text-xs font-mono text-[#737373] pt-1">
                Members: {rolls.join(' · ')}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="px-3.5 py-1.5 rounded-lg border border-[#E5E5E5] hover:bg-[#F5F5F2] text-xs font-mono font-medium text-[#171717] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Check for results</span>
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // PUBLISHED — official standings with scores.
  // =========================================================================
  const myRank = leaderboard.find((e) => e.team_id === team?.id)?.rank;

  return (
    <div className="max-w-4xl mx-auto w-full py-6 space-y-6">
      {/* Your Score */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E5E5E5]">
        <h1 className="text-xl sm:text-2xl font-heading font-bold tracking-tight text-[#171717]">Your Score</h1>
        <span className="font-mono text-xs text-[#171717]">
          Team: <strong>{team?.team_name ?? result?.team_name}</strong>
          {myRank !== undefined && <span className="ml-2 text-[#B34400] font-bold">· Rank #{myRank}</span>}
        </span>
      </div>

      {/* Your Total Score */}
      <div className="rounded-2xl border border-[#E5E5E5] bg-[#F5F5F2] p-6 sm:p-8 text-center space-y-1">
        <span className="text-[11px] font-mono uppercase tracking-wider text-[#737373] font-bold">Your Total Score</span>
        <div className="text-5xl sm:text-6xl font-heading font-black text-[#171717] font-mono leading-none">
          {result?.final_score ?? 0} <span className="text-2xl text-[#737373] font-normal">/ 40 pts</span>
        </div>
        {myRank !== undefined && (
          <span className="text-xs font-mono text-[#18794E] font-bold inline-flex items-center gap-1.5 pt-1">
            <Award className="w-3.5 h-3.5" />
            Rank #{myRank} of {leaderboard.length} teams
          </span>
        )}
      </div>

      {/* Score breakdown */}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'R1 Score', value: result.level1_score, max: 30 },
            { label: 'R2 Q1 Score', value: result.q1_score ?? 0, max: 5 },
            { label: 'R2 Q2 Score', value: result.q2_score ?? 0, max: 5 },
            { label: 'Overall Score', value: result.final_score, max: 40 }
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-[#E5E5E5] bg-[#FFFFFF] p-4 text-center">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#737373] font-bold block">{s.label}</span>
              <div className="text-xl font-heading font-bold font-mono text-[#171717] mt-1.5">
                {s.value} <span className="text-xs text-[#737373] font-normal">/ {s.max} pts</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-[#FF8A24]" />
            <h2 className="text-base sm:text-lg font-heading font-bold text-[#171717]">TechBrains Leaderboard</h2>
            {leaderboard.length > 0 && (
              <span className="text-xs font-mono text-[#737373]">({leaderboard.length} teams)</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] hover:bg-[#F5F5F2] text-xs font-mono font-medium text-[#171717] flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {leaderboard.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-[#737373]">No leaderboard entries recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-body">
              <thead className="text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
                <tr>
                  <th className="py-3 px-4 text-center w-16">Rank</th>
                  <th className="py-3 px-4">Team</th>
                  <th className="py-3 px-4 text-center">L1 (/30)</th>
                  <th className="py-3 px-4 text-center">L2 (/10)</th>
                  <th className="py-3 px-4 text-center font-bold text-[#171717]">Total (/40)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5E5] font-mono">
                {leaderboard.map((entry) => {
                  const isMyTeam = entry.team_id === team?.id;
                  return (
                    <tr key={entry.team_id} className={isMyTeam ? 'bg-[#FFF0D6]/70 font-bold' : 'bg-[#FFFFFF]'}>
                      <td className="py-3 px-4 text-center text-[#737373]">#{entry.rank}</td>
                      <td className="py-3 px-4 font-heading font-semibold text-[#171717]">
                        <div className="flex items-center gap-2">
                          <span>{entry.team_name}</span>
                          {isMyTeam && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#FF8A24] text-white font-bold">YOU</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center text-[#171717]">{entry.level1_score} / 30</td>
                      <td className="py-3 px-4 text-center text-[#171717]">{entry.level2_score} / 10</td>
                      <td className="py-3 px-4 text-center font-bold text-sm text-[#B34400]">{entry.final_score} / 40</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

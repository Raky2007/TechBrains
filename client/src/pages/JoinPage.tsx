import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BRANDING } from '@nexus/shared';
import { apiFetch, getStoredTeamToken, setStoredTeamToken } from '../lib/api';
import { ConnectionBadge } from '../components/ConnectionBadge';
import { ArrowRight, AlertCircle, Loader2, ShieldCheck, CheckSquare, Award } from 'lucide-react';

export const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [teamName, setTeamName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);

  // Auto-redirect if existing valid session token is found
  useEffect(() => {
    const existingToken = getStoredTeamToken();
    if (existingToken) {
      apiFetch('/api/auth/me')
        .then(() => {
          navigate('/waiting');
        })
        .catch(() => {
          setIsCheckingSession(false);
        });
    } else {
      setIsCheckingSession(false);
    }
  }, [navigate]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmed = teamName.trim();
    if (trimmed.length < 2) {
      setError('Team name must be at least 2 characters long.');
      return;
    }
    if (trimmed.length > 50) {
      setError('Team name cannot exceed 50 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch<{ team: any; token: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ team_name: trimmed })
      });

      if (res.token) {
        setStoredTeamToken(res.token);
      }
      navigate('/waiting');
    } catch (err: any) {
      setError(err.message || 'Failed to register team.');
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex items-center justify-center font-mono text-sm text-[#737373]">
        Verifying network session...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#171717] flex flex-col justify-between">
      {/* Top Header */}
      <header className="border-b border-[#E5E5E5] bg-[#FFFFFF] py-4 px-6 sm:px-12">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#FFC928] text-[#171717] flex items-center justify-center font-heading font-black text-sm">
              N
            </div>
            <div>
              <span className="font-heading font-bold text-base text-[#171717] tracking-tight">
                {BRANDING.title}
              </span>
              <span className="hidden sm:inline-block text-xs font-mono text-[#737373] ml-2.5 pl-2.5 border-l border-[#E5E5E5]">
                {BRANDING.eventEdition}
              </span>
            </div>
          </div>
          <ConnectionBadge />
        </div>
      </header>

      {/* Main Registration Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-md w-full my-auto space-y-6">
          {/* Card: #FFFFFF, border #E5E5E5 */}
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="space-y-2">
              <span className="inline-block text-[11px] font-mono uppercase font-bold tracking-wider px-2.5 py-0.5 rounded bg-[#F5F5F2] text-[#171717] border border-[#E5E5E5]">
                TEAM REGISTRATION
              </span>
              <h1 className="text-2xl sm:text-3xl font-heading font-bold text-[#171717] tracking-tight">
                Join Event Challenge
              </h1>
              <p className="text-xs text-[#737373] leading-relaxed">
                Enter your designated team name to connect to this session. No cloud login or external account required.
              </p>
            </div>

            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label
                  htmlFor="team-name"
                  className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-2"
                >
                  Team Designation
                </label>
                <input
                  id="team-name"
                  type="text"
                  required
                  autoFocus
                  maxLength={50}
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="e.g. CyberTitans-01"
                  disabled={isSubmitting}
                  className="w-full px-4 py-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] placeholder-[#A3A3A3] text-sm focus:outline-none focus:border-[#171717] transition-colors"
                />
                <span className="text-[11px] text-[#737373] mt-1.5 block">
                  Letters, numbers, spaces, and hyphens permitted.
                </span>
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{error}</span>
                </div>
              )}

              {/* Primary CTA: #FFC928 with bold black text */}
              <button
                type="submit"
                disabled={isSubmitting || !teamName.trim()}
                className="w-full py-3.5 px-6 rounded-xl font-heading font-bold text-sm tracking-wide text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                    <span>REGISTERING TEAM...</span>
                  </>
                ) : (
                  <>
                    <span>JOIN GAME</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Clean Information Section: Alternate section #F5F5F2 */}
          <div className="bg-[#F5F5F2] border border-[#E5E5E5] rounded-xl p-5 space-y-2.5 text-xs text-[#737373]">
            <div className="font-heading font-bold text-[#171717] flex items-center gap-1.5">
              <CheckSquare className="w-3.5 h-3.5 text-[#18794E]" />
              <span>Event Structure</span>
            </div>
            <p className="leading-relaxed">
              <strong className="text-[#171717]">Level 1: AI vs Human</strong> — Test your judgment on synthetic vs authentic media under a timed clock.
            </p>
            <p className="leading-relaxed">
              <strong className="text-[#171717]">Level 2: Clues with Credits</strong> — Spend your 200 credits to unlock forensic artifacts and submit your final verdict.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E5E5E5] bg-[#FFFFFF] py-4 px-6 sm:px-12 text-xs text-[#737373]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <span>COLLEGIATE TECHNICAL EVENT LAN SYSTEM</span>
          <span className="font-mono text-[11px] text-[#A3A3A3]">LAN ISOLATED • ZERO CLOUD DEPENDENCIES</span>
        </div>
      </footer>
    </div>
  );
};

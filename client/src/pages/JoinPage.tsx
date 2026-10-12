import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, getStoredTeamToken, setStoredTeamToken, removeStoredTeamToken } from '../lib/api';
import { AppHeader } from '../components/AppHeader';
import { AppFooter } from '../components/AppFooter';
import { ArrowRight, AlertCircle, Loader2 } from 'lucide-react';

export const JoinPage: React.FC = () => {
  const navigate = useNavigate();
  const [teamName, setTeamName] = useState<string>('');
  const [player1Roll, setPlayer1Roll] = useState<string>('');
  const [player2Roll, setPlayer2Roll] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ teamName?: string; player1Roll?: string; player2Roll?: string }>({});
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
        .catch((err: any) => {
          const msg = err?.message || '';
          // Only clear token if server explicitly confirms invalid/unauthorized credentials (HTTP 401/403)
          const isAuthFailure = /HTTP (401|403)|unauthorized|invalid token|invalid session/i.test(msg);
          if (isAuthFailure) {
            removeStoredTeamToken();
          }
          setIsCheckingSession(false);
        });
    } else {
      setIsCheckingSession(false);
    }
  }, [navigate]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedTeam = teamName.trim();
    const trimmedP1 = player1Roll.trim();
    const trimmedP2 = player2Roll.trim();

    const errors: { teamName?: string; player1Roll?: string; player2Roll?: string } = {};

    if (trimmedTeam.length < 2) {
      errors.teamName = 'Team name must be at least 2 characters long.';
    } else if (trimmedTeam.length > 50) {
      errors.teamName = 'Team name cannot exceed 50 characters.';
    }

    const rollRegex = /^[A-Za-z0-9_\-\.\/]+$/;

    if (!trimmedP1) {
      errors.player1Roll = 'Member 1 roll number is required.';
    } else if (trimmedP1.length < 2 || trimmedP1.length > 30 || !rollRegex.test(trimmedP1)) {
      errors.player1Roll = 'Enter a valid roll number (e.g. 21B91A0501).';
    }

    if (!trimmedP2) {
      errors.player2Roll = 'Member 2 roll number is required.';
    } else if (trimmedP2.length < 2 || trimmedP2.length > 30 || !rollRegex.test(trimmedP2)) {
      errors.player2Roll = 'Enter a valid roll number (e.g. 21B91A0502).';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError('Please fix the highlighted fields below.');
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await apiFetch<{ team: any; token: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          team_name: trimmedTeam,
          player1_roll: trimmedP1,
          player2_roll: trimmedP2
        })
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
        Verifying network session…
      </div>
    );
  }

  // Shared field classes
  const labelClass = 'block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-2';
  const inputBase =
    'w-full px-4 py-3 bg-[#FFFFFF] border rounded-xl text-[#171717] placeholder-[#A3A3A3] focus:outline-none focus:border-[#171717] transition-colors';

  return (
    <div className="h-screen overflow-hidden bg-[#FFFFFF] text-[#171717] flex flex-col">
      {/* ── Branded header: SPEC · TECHBRAINS · Gradient ── */}
      <AppHeader />

      {/* ── Main: team registration ── */}
      <main className="flex-1 min-h-0 overflow-y-auto w-full flex items-center justify-center">
        <div className="max-w-md w-full mx-auto px-4 sm:px-6 py-8">
            <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
              <div className="space-y-2">
                <span className="block text-[11px] font-mono uppercase font-bold tracking-wider text-[#737373]">
                  Team Registration
                </span>
                <h2 className="text-2xl sm:text-3xl font-heading font-bold text-[#171717] tracking-tight">
                  Join TechBrains
                </h2>
                <p className="text-xs text-[#737373] leading-relaxed">
                  Enter your team name exactly as it appears in the registration form.
                </p>
              </div>

              <form onSubmit={handleJoin} className="space-y-4">
                <div>
                  <label htmlFor="team-name" className={labelClass}>
                    Team Name
                  </label>
                  <input
                    id="team-name"
                    type="text"
                    required
                    autoFocus
                    maxLength={50}
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    placeholder="e.g. CyberTitans"
                    disabled={isSubmitting}
                    className={`${inputBase} text-sm ${fieldErrors.teamName ? 'border-[#B42318]' : 'border-[#E5E5E5]'}`}
                  />
                  {fieldErrors.teamName ? (
                    <span className="text-[11px] text-[#B42318] mt-1.5 block font-medium">{fieldErrors.teamName}</span>
                  ) : (
                    <span className="text-[11px] text-[#737373] mt-1.5 block">
                      Letters, numbers, spaces, and hyphens permitted.
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="player1-roll" className={labelClass}>
                    Team Member 1 Roll No
                  </label>
                  <input
                    id="player1-roll"
                    type="text"
                    required
                    maxLength={30}
                    value={player1Roll}
                    onChange={(e) => setPlayer1Roll(e.target.value)}
                    placeholder="e.g. 21B91A0501"
                    disabled={isSubmitting}
                    className={`${inputBase} text-xs font-mono py-2.5 ${fieldErrors.player1Roll ? 'border-[#B42318]' : 'border-[#E5E5E5]'}`}
                  />
                  {fieldErrors.player1Roll && (
                    <span className="text-[10px] text-[#B42318] mt-1 block font-medium">{fieldErrors.player1Roll}</span>
                  )}
                </div>

                <div>
                  <label htmlFor="player2-roll" className={labelClass}>
                    Team Member 2 Roll No
                  </label>
                  <input
                    id="player2-roll"
                    type="text"
                    required
                    maxLength={30}
                    value={player2Roll}
                    onChange={(e) => setPlayer2Roll(e.target.value)}
                    placeholder="e.g. 21B91A0502"
                    disabled={isSubmitting}
                    className={`${inputBase} text-xs font-mono py-2.5 ${fieldErrors.player2Roll ? 'border-[#B42318]' : 'border-[#E5E5E5]'}`}
                  />
                  {fieldErrors.player2Roll && (
                    <span className="text-[10px] text-[#B42318] mt-1 block font-medium">{fieldErrors.player2Roll}</span>
                  )}
                </div>

                {/* Attendance note */}
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#FFF0D6]/60 border border-[#FFC928]/40 text-[11px] leading-relaxed text-[#8A5A00]">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#B34400]" />
                  <span>
                    <strong className="font-semibold">Double-check both roll numbers.</strong> They are used for event
                    attendance, so make sure they are correct.
                  </span>
                </div>

                {error && (
                  <div className="p-3.5 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="font-medium">{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || !teamName.trim()}
                  className="w-full py-3.5 px-6 rounded-xl font-heading font-bold text-sm tracking-wide text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#171717]" />
                      <span>Registering…</span>
                    </>
                  ) : (
                    <>
                      <span>Join Game</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
        </div>
      </main>

      {/* ── Footer: Department · Powered by Gradient ── */}
      <AppFooter />
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { GameSettings, PublicGameState } from '@nexus/shared';
import { RoundControlPanel } from '../../components/RoundControlPanel';
import { Save, Loader2, HelpCircle, ArrowRight } from 'lucide-react';

/**
 * Round 1 admin settings.
 *
 * Groups everything that belongs to Round 1: the server-authoritative timer
 * controls (start / pause / resume / end) and the Round 1 configuration
 * (duration, per-team question randomization). Settings are persisted through
 * the existing PUT /api/admin/settings endpoint; the full settings object is
 * preserved so Round 2 configuration is never clobbered.
 */
export const Round1SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);

  const fetchState = async () => {
    const res = await apiFetch<PublicGameState>('/api/game/state');
    setGameState(res);
  };

  const fetchSettings = async () => {
    const res = await apiFetch<{ settings: GameSettings }>('/api/admin/overview');
    setSettings(res.settings);
  };

  useEffect(() => {
    Promise.all([fetchSettings(), fetchState()]).finally(() => setIsLoading(false));
    const socket = getSocket();
    const onState = (s: PublicGameState) => setGameState(s);
    socket.on('game:state_changed', onState);
    return () => {
      socket.off('game:state_changed', onState);
    };
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ settings: GameSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });
      setSettings(res.settings);
      setFeedback({ message: 'Round 1 settings saved.' });
    } catch (err: any) {
      setFeedback({ message: err.message || 'Failed to save settings.', isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !settings || !gameState) {
    return (
      <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[50vh]">
        Loading Round 1 settings…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-heading font-bold text-[#171717]">Round 1 · Settings</h1>
        <p className="text-xs text-[#737373] font-mono mt-0.5">
          AI vs Human discernment — timer and configuration.
        </p>
      </div>

      {/* Quick link to Round 1 questions */}
      <Link
        to="/admin/questions"
        className="flex items-center justify-between bg-[#F5F5F2] border border-[#E5E5E5] rounded-xl px-5 py-4 hover:bg-[#E5E5E5]/60 transition-colors"
      >
        <span className="flex items-center gap-2.5 text-sm font-heading font-bold text-[#171717]">
          <HelpCircle className="w-4 h-4" />
          Manage Round 1 Questions
        </span>
        <ArrowRight className="w-4 h-4 text-[#737373]" />
      </Link>

      {/* Timer controls (server-authoritative) */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 shadow-xs">
        <RoundControlPanel level={1} gameState={gameState} onChanged={fetchState} />
      </div>

      {/* Configuration */}
      <form onSubmit={handleSave} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
        <h2 className="text-sm font-heading font-bold text-[#171717] uppercase tracking-wider">Configuration</h2>

        <div>
          <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
            Round 1 Qualification Cutoff Score
          </label>
          <input
            type="number"
            min={-1000}
            max={1000}
            value={settings.round1CutoffScore}
            onChange={(e) => setSettings({ ...settings, round1CutoffScore: parseInt(e.target.value, 10) || 0 })}
            className="w-full max-w-[160px] px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
          />
          <p className="text-[11px] text-[#737373] mt-1.5 leading-relaxed">
            After Round 1 ends, only teams whose Round 1 score is <strong>at least this value</strong> qualify for Round 2.
            Enforced server-side. Use 0 to let every team through.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-[11px] text-[#737373] leading-relaxed">
          Round 1 has no overall timer. Each question carries its own timer (set per question on the
          <strong className="text-[#171717]"> Questions</strong> page); the round's total length is the sum of those timers.
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5]">
          <div>
            <span className="text-xs font-heading font-bold text-[#171717] block">
              Randomize Question Order Per Team
            </span>
            <span className="text-[11px] text-[#737373]">
              Shuffles question assignments independently for each team.
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.randomizeQuestionOrder}
            onChange={(e) => setSettings({ ...settings, randomizeQuestionOrder: e.target.checked })}
            className="w-4 h-4 accent-[#FFC928] cursor-pointer"
          />
        </div>

        {feedback && (
          <div
            className={`p-3 rounded-lg border text-xs ${
              feedback.isError
                ? 'bg-[#B42318]/5 border-[#B42318]/20 text-[#B42318]'
                : 'bg-[#18794E]/5 border-[#18794E]/20 text-[#18794E]'
            }`}
          >
            {feedback.message}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-[#E5E5E5]">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center gap-2 shadow-xs cursor-pointer"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save Round 1 Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
};

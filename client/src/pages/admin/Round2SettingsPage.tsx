import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { GameSettings, PublicGameState } from '@nexus/shared';
import { RoundControlPanel } from '../../components/RoundControlPanel';
import { Save, Loader2, FolderSearch, ArrowRight } from 'lucide-react';

/**
 * Round 2 admin settings.
 *
 * Groups everything that belongs to Round 2: the server-authoritative timer
 * controls and the Round 2 configuration (duration, default initial credits,
 * maximum evaluation score). Per-case configuration — case media viewing
 * duration, replay cost and per-case initial credits — lives on the Cases &
 * Clues page, linked below. Settings persist through PUT /api/admin/settings
 * with the full settings object preserved so Round 1 config is never clobbered.
 */
export const Round2SettingsPage: React.FC = () => {
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
      setFeedback({ message: 'Round 2 settings saved.' });
    } catch (err: any) {
      setFeedback({ message: err.message || 'Failed to save settings.', isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !settings || !gameState) {
    return (
      <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[50vh]">
        Loading Round 2 settings…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-heading font-bold text-[#171717]">Round 2 · Settings</h1>
        <p className="text-xs text-[#737373] font-mono mt-0.5">
          Case investigation — timer, credits and evaluation.
        </p>
      </div>

      {/* Quick link to Round 2 cases & clues */}
      <Link
        to="/admin/cases"
        className="flex items-center justify-between bg-[#F5F5F2] border border-[#E5E5E5] rounded-xl px-5 py-4 hover:bg-[#E5E5E5]/60 transition-colors"
      >
        <span className="flex items-center gap-2.5 text-sm font-heading font-bold text-[#171717]">
          <FolderSearch className="w-4 h-4" />
          Manage Round 2 Cases, Clues &amp; Media
        </span>
        <ArrowRight className="w-4 h-4 text-[#737373]" />
      </Link>

      {/* Timer controls (server-authoritative) */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 shadow-xs">
        <RoundControlPanel level={2} gameState={gameState} onChanged={fetchState} />
      </div>

      {/* Configuration */}
      <form onSubmit={handleSave} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
        <h2 className="text-sm font-heading font-bold text-[#171717] uppercase tracking-wider">Configuration</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Round 2 Duration (Minutes)
            </label>
            <input
              type="number"
              min={1}
              max={180}
              value={settings.level2DurationMinutes}
              onChange={(e) => setSettings({ ...settings, level2DurationMinutes: parseInt(e.target.value, 10) })}
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Default Initial Credits per Team
            </label>
            <input
              type="number"
              min={10}
              max={10000}
              value={settings.initialCredits}
              onChange={(e) => setSettings({ ...settings, initialCredits: parseInt(e.target.value, 10) })}
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Round 2 Maximum Score
            </label>
            <input
              type="number"
              min={1}
              max={1000}
              value={settings.round2MaxScore}
              onChange={(e) => setSettings({ ...settings, round2MaxScore: parseInt(e.target.value, 10) })}
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
            />
          </div>
        </div>

        <p className="text-[11px] text-[#737373] font-mono">
          Case media viewing duration, replay cost and per-case credits are configured per case on the Cases &amp; Clues page.
        </p>

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
            <span>Save Round 2 Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { GameSettings } from '@nexus/shared';
import { Settings, Save, Database, AlertCircle, CheckCircle2, Loader2, Download } from 'lucide-react';

export const AdminSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean } | null>(null);

  const fetchSettings = async () => {
    try {
      const res = await apiFetch<{ settings: GameSettings }>('/api/admin/overview');
      setSettings(res.settings);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    setFeedback(null);

    try {
      const res = await apiFetch<{ success: boolean; settings: GameSettings }>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(settings)
      });
      setSettings(res.settings);
      setFeedback({ message: 'Settings successfully updated and applied.' });
    } catch (err: any) {
      setFeedback({ message: err.message || 'Failed to update settings.', isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsBackingUp(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ success: boolean; message: string; backup_dir: string }>('/api/admin/backup', {
        method: 'POST'
      });
      setFeedback({ message: `Authoritative backup created: ${res.backup_dir}` });
    } catch (err: any) {
      setFeedback({ message: err.message || 'Backup failed.', isError: true });
    } finally {
      setIsBackingUp(false);
    }
  };

  if (isLoading || !settings) {
    return (
      <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[50vh]">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-heading font-bold text-[#171717]">
          Tournament Settings & Maintenance
        </h1>
        <p className="text-xs text-[#737373] font-mono mt-0.5">
          Configure authoritative round durations, initial credits, and create backups.
        </p>
      </div>

      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.isError
              ? 'bg-[#B42318]/5 border-[#B42318]/20 text-[#B42318]'
              : 'bg-[#18794E]/5 border-[#18794E]/20 text-[#18794E]'
          }`}
        >
          {feedback.isError ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Settings Form: Card #FFFFFF */}
      <form onSubmit={handleSaveSettings} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
        <h2 className="text-sm font-heading font-bold text-[#171717] uppercase tracking-wider flex items-center gap-2">
          <Settings className="w-4 h-4 text-[#171717]" />
          <span>Game Parameters</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Level 1 Round Duration (Minutes)
            </label>
            <input
              type="number"
              min={1}
              max={180}
              value={settings.level1DurationMinutes}
              onChange={(e) =>
                setSettings({ ...settings, level1DurationMinutes: parseInt(e.target.value, 10) })
              }
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Level 2 Round Duration (Minutes)
            </label>
            <input
              type="number"
              min={1}
              max={180}
              value={settings.level2DurationMinutes}
              onChange={(e) =>
                setSettings({ ...settings, level2DurationMinutes: parseInt(e.target.value, 10) })
              }
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Initial Allocated Credits per Team
            </label>
            <input
              type="number"
              min={10}
              max={10000}
              value={settings.initialCredits}
              onChange={(e) =>
                setSettings({ ...settings, initialCredits: parseInt(e.target.value, 10) })
              }
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
              onChange={(e) =>
                setSettings({ ...settings, round2MaxScore: parseInt(e.target.value, 10) })
              }
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
            />
          </div>

          <div>
            <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1.5">
              Tie-Breaker Rule
            </label>
            <select
              value={settings.tieBreakerRule}
              onChange={(e) =>
                setSettings({ ...settings, tieBreakerRule: e.target.value as any })
              }
              className="w-full px-4 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
            >
              <option value="default">Default: Level 2 Score, then L1 Accuracy, then Time</option>
              <option value="l2_first">Level 2 Score Priority</option>
              <option value="l1_accuracy">Level 1 Accuracy Priority</option>
              <option value="time_first">Submission Timestamp Priority</option>
            </select>
          </div>
        </div>

        {/* Toggles: Alternate sections #F5F5F2 */}
        <div className="pt-4 border-t border-[#E5E5E5] space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5]">
            <div>
              <span className="text-xs font-heading font-bold text-[#171717] block">
                Randomize Question Order Per Team
              </span>
              <span className="text-[11px] text-[#737373]">
                Shuffles question assignments independently for each participating team.
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.randomizeQuestionOrder}
              onChange={(e) => setSettings({ ...settings, randomizeQuestionOrder: e.target.checked })}
              className="w-4 h-4 accent-[#FFC928] cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5]">
            <div>
              <span className="text-xs font-heading font-bold text-[#171717] block">
                Publish Final Leaderboard Results
              </span>
              <span className="text-[11px] text-[#737373]">
                When enabled, the final standings table becomes visible to all participant terminals.
              </span>
            </div>
            <input
              type="checkbox"
              checked={settings.resultsPublished}
              onChange={(e) => setSettings({ ...settings, resultsPublished: e.target.checked })}
              className="w-4 h-4 accent-[#FFC928] cursor-pointer"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-[#E5E5E5] flex justify-end">
          {/* Primary CTA: #FFC928 */}
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl font-heading font-bold text-xs tracking-wider uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all flex items-center gap-2 shadow-xs cursor-pointer"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin text-[#171717]" /> : <Save className="w-4 h-4" />}
            <span>Save Settings</span>
          </button>
        </div>
      </form>

      {/* Database Backup Card */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-heading font-bold text-[#171717] uppercase tracking-wider flex items-center gap-2">
              <Database className="w-4 h-4 text-[#FF8A24]" />
              <span>Authoritative Database & Uploads Backup</span>
            </h2>
            <p className="text-xs text-[#737373] mt-0.5">
              Creates a point-in-time snapshot of the SQLite WAL database and media uploads.
            </p>
          </div>

          {/* Secondary CTA: #FF8A24 */}
          <button
            type="button"
            disabled={isBackingUp}
            onClick={handleCreateBackup}
            className="px-4 py-2 rounded-xl text-xs font-heading font-bold uppercase text-white bg-[#FF8A24] hover:bg-[#F27D16] transition-colors flex items-center gap-2 shadow-2xs cursor-pointer shrink-0"
          >
            {isBackingUp ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Download className="w-4 h-4 text-white" />
            )}
            <span>Trigger Backup</span>
          </button>
        </div>
      </div>
    </div>
  );
};

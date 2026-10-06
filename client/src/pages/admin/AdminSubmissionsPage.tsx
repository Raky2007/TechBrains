import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { AlertCircle, X, Sparkles, Loader2 } from 'lucide-react';

export const AdminSubmissionsPage: React.FC = () => {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Override modal state
  const [override, setOverride] = useState<any | null>(null);
  const [score, setScore] = useState<number>(0);
  const [verdict, setVerdict] = useState<string>('');
  const [reasoning, setReasoning] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchSubmissions = async () => {
    try {
      const res = await apiFetch<{ submissions: any[] }>('/api/admin/submissions');
      setSubmissions(res.submissions);
    } catch (err) {
      console.error('Failed to load submissions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubmissions();
    const socket = getSocket();
    const refresh = () => fetchSubmissions();
    socket.on('submission:created', refresh);
    return () => {
      socket.off('submission:created', refresh);
    };
  }, []);

  const runAi = async (conclusionId: string) => {
    setRunningId(conclusionId);
    try {
      await apiFetch(`/api/admin/evaluations/${conclusionId}/evaluate`, { method: 'POST' });
      await fetchSubmissions();
    } catch (err: any) {
      alert(err.message || 'AI evaluation failed.');
    } finally {
      setRunningId(null);
    }
  };

  const openOverride = (sub: any) => {
    setOverride(sub);
    setScore(sub.evaluation_score ?? 0);
    setVerdict(sub.evaluation_verdict ?? '');
    setReasoning(sub.evaluation_reasoning ?? '');
    setModalError(null);
  };

  const saveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!override) return;
    setIsSaving(true);
    setModalError(null);
    try {
      await apiFetch('/api/admin/evaluations/override', {
        method: 'POST',
        body: JSON.stringify({
          conclusion_id: override.conclusion_id,
          score: Number(score),
          verdict: verdict.trim(),
          reasoning: reasoning.trim() || null
        })
      });
      setOverride(null);
      await fetchSubmissions();
    } catch (err: any) {
      setModalError(err.message || 'Failed to save override.');
    } finally {
      setIsSaving(false);
    }
  };

  const statusBadge = (s: any) => {
    const st = s.evaluation_status as string | null;
    if (!st) return { label: 'NOT EVALUATED', cls: 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]' };
    if (st === 'completed') return { label: s.evaluation_is_overridden ? 'OVERRIDDEN' : 'EVALUATED', cls: 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/20' };
    if (st === 'pending') return { label: 'PENDING', cls: 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]' };
    return { label: 'FAILED', cls: 'bg-[#B42318]/5 text-[#B42318] border-[#B42318]/20' };
  };

  if (isLoading) {
    return <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[40vh]">Loading submissions...</div>;
  }

  const pending = submissions.filter((s) => s.evaluation_status !== 'completed').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">Round 2 Submissions & AI Evaluation</h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Final answers are AI-evaluated (score / verdict / reasoning). Admins can re-run the AI or manually override.
          </p>
        </div>
        <span className="px-3.5 py-1.5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] font-mono text-xs text-[#171717]">
          Queue: <strong className="text-[#FF8A24]">{pending} pending</strong>
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Clues / Replays / Credits</th>
                <th className="py-3 px-4">Final Answer</th>
                <th className="py-3 px-4 text-center">Score</th>
                <th className="py-3 px-4 text-center">Verdict</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {submissions.map((sub, idx) => {
                const badge = statusBadge(sub);
                return (
                  <tr key={sub.conclusion_id} className={idx % 2 ? 'bg-[#F5F5F2]/40' : 'bg-[#FFFFFF]'}>
                    <td className="py-3 px-4 font-heading font-bold text-[#171717]">{sub.team_name}</td>
                    <td className="py-3 px-4 font-mono text-[#737373]">
                      <div>Clues: <strong className="text-[#171717]">{sub.unlocked_count}</strong></div>
                      <div>Replays: <strong className="text-[#171717]">{sub.replay_count}</strong></div>
                      <div>Spent: <strong className="text-[#B34400]">{(sub.clue_credits_spent || 0) + (sub.replay_credits_spent || 0)} CR</strong></div>
                    </td>
                    <td className="py-3 px-4 text-[#737373] max-w-xs"><p className="line-clamp-2 leading-relaxed">{sub.conclusion_text}</p></td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-sm text-[#171717]">
                      {sub.evaluation_status === 'completed' ? `${sub.evaluation_score} / ${sub.evaluation_max_score}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-[#171717]">{sub.evaluation_verdict || '—'}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-bold border ${badge.cls}`}>{badge.label}</span>
                      {sub.evaluation_status === 'failed' && sub.evaluation_error && (
                        <div className="text-[10px] text-[#B42318] mt-1 max-w-[160px] truncate" title={sub.evaluation_error}>{sub.evaluation_error}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => runAi(sub.conclusion_id)}
                        disabled={runningId === sub.conclusion_id}
                        className="px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase text-white bg-[#171717] hover:bg-[#333] transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        {runningId === sub.conclusion_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                        <span>{sub.evaluation_status === 'completed' ? 'Re-run AI' : 'Run AI'}</span>
                      </button>
                      <button
                        onClick={() => openOverride(sub)}
                        className="px-3 py-1.5 rounded-lg text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] transition-colors cursor-pointer"
                      >
                        Override
                      </button>
                    </td>
                  </tr>
                );
              })}
              {submissions.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-[#737373] font-mono">No final answers submitted yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Override modal */}
      {override && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-2xl w-full my-8 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <div>
                <span className="text-[10px] font-mono text-[#18794E] uppercase tracking-wider font-bold">MANUAL OVERRIDE</span>
                <h2 className="text-lg font-heading font-bold text-[#171717]">Team: {override.team_name}</h2>
              </div>
              <button onClick={() => setOverride(null)} className="text-[#737373] hover:text-[#171717] cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            {override.evaluation_status === 'completed' && (
              <div className="p-3 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-xs font-mono text-[#737373]">
                Current ({override.evaluation_is_overridden ? 'manual' : 'AI'}): <strong className="text-[#171717]">{override.evaluation_score}/{override.evaluation_max_score}</strong> — {override.evaluation_verdict}
                {override.evaluation_reasoning && <p className="mt-1 italic">{override.evaluation_reasoning}</p>}
              </div>
            )}

            <div>
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">Submitted Final Answer</label>
              <div className="p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-xs text-[#171717] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">{override.conclusion_text}</div>
            </div>

            <form onSubmit={saveOverride} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">Score (0 – {override.evaluation_max_score ?? 20})</label>
                  <input type="number" min={0} max={override.evaluation_max_score ?? 20} step={0.5} value={score} onChange={(e) => setScore(parseFloat(e.target.value))} className="w-full px-3.5 py-2.5 border border-[#E5E5E5] rounded-xl text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">Verdict</label>
                  <input type="text" required value={verdict} onChange={(e) => setVerdict(e.target.value)} placeholder="e.g. Strong / Partial / Incorrect" className="w-full px-3.5 py-2.5 border border-[#E5E5E5] rounded-xl text-xs" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">Reasoning (optional)</label>
                <textarea rows={3} value={reasoning} onChange={(e) => setReasoning(e.target.value)} className="w-full p-3 border border-[#E5E5E5] rounded-xl text-xs leading-relaxed" />
              </div>

              {modalError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /><span>{modalError}</span>
                </div>
              )}

              <div className="pt-3 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button type="button" onClick={() => setOverride(null)} className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSaving} className="px-5 py-2.5 text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] rounded-lg shadow-xs cursor-pointer">{isSaving ? 'Saving...' : 'Save Override'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

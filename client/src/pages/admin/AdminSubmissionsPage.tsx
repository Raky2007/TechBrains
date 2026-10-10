import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import {
  AlertCircle,
  X,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  KeyRound,
  UserCheck,
  RotateCcw
} from 'lucide-react';

export const AdminSubmissionsPage: React.FC = () => {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [runningId, setRunningId] = useState<string | null>(null);

  // Expanded inspection modal state
  const [inspectingSub, setInspectingSub] = useState<any | null>(null);

  // Override modal state
  const [override, setOverride] = useState<any | null>(null);
  const [q1Score, setQ1Score] = useState<number>(0);
  const [q2Score, setQ2Score] = useState<number>(0);
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
    setQ1Score(sub.q1_score ?? 0);
    setQ2Score(sub.q2_score ?? sub.evaluation_score ?? 0);
    setVerdict(sub.evaluation_verdict ?? (sub.q2_score >= 4 ? 'Strong' : 'Partial'));
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
          score: Number(q2Score),
          q1_score: Number(q1Score),
          verdict: verdict.trim() || 'Manual Override',
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
    if (!st || st === 'not_evaluated') return { label: 'PENDING', cls: 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]' };
    if (st === 'completed') return { label: s.evaluation_is_overridden ? 'OVERRIDDEN' : 'EVALUATED', cls: 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/20' };
    if (st === 'pending') return { label: 'PENDING', cls: 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]' };
    return { label: 'FAILED', cls: 'bg-[#B42318]/5 text-[#B42318] border-[#B42318]/20' };
  };

  if (isLoading) {
    return <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[40vh]">Loading submissions...</div>;
  }

  const pendingCount = submissions.filter((s) => s.evaluation_status !== 'completed').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">Level 2 Submissions &amp; AI Evaluation</h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Question 1 is deterministically scored (0 or 5). Question 2 is evaluated by NVIDIA Nemotron (0-5).
          </p>
        </div>
        <span className="px-3.5 py-1.5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] font-mono text-xs text-[#171717]">
          Queue: <strong className="text-[#FF8A24]">{pendingCount} pending</strong>
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Question 1 (Vault PIN)</th>
                <th className="py-3 px-4">Question 2 (Suspect)</th>
                <th className="py-3 px-4 text-center">Nemotron (Q2)</th>
                <th className="py-3 px-4 text-center">Level 2 Total</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {submissions.map((sub, idx) => {
                const badge = statusBadge(sub);
                const totalL2 = ((sub.q1_score ?? 0) + (sub.q2_score ?? sub.evaluation_score ?? 0));
                return (
                  <tr key={sub.conclusion_id || sub.team_id} className={idx % 2 ? 'bg-[#F5F5F2]/40' : 'bg-[#FFFFFF]'}>
                    <td className="py-3 px-4 font-heading font-bold text-[#171717]">
                      <div>{sub.team_name}</div>
                      <div className="font-mono text-[10px] text-[#737373] font-normal">
                        {sub.submitted_at ? new Date(sub.submitted_at).toLocaleTimeString() : 'In Progress'}
                      </div>
                    </td>

                    {/* Q1 Cell */}
                    <td className="py-3 px-4 font-mono text-xs">
                      {sub.q1_submitted ? (
                        <div className="flex items-center gap-2">
                          {sub.q1_is_correct ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-[#18794E] shrink-0" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-[#B42318] shrink-0" />
                          )}
                          <span className="font-bold text-[#171717]">{sub.q1_pin}</span>
                          <span className="text-[10px] text-[#737373]">({sub.q1_score}/5 pts)</span>
                        </div>
                      ) : (
                        <span className="text-[#A3A3A3] italic">Not submitted</span>
                      )}
                    </td>

                    {/* Q2 Cell */}
                    <td className="py-3 px-4 max-w-xs">
                      {sub.q2_submitted ? (
                        <div>
                          <div className="font-heading font-bold text-[#171717] text-[11px]">
                            {sub.q2_selected_suspect || 'Unspecified'}
                          </div>
                          <p className="line-clamp-1 text-[#737373] text-[11px] font-mono leading-relaxed">
                            {sub.q2_explanation}
                          </p>
                        </div>
                      ) : (
                        <span className="text-[#A3A3A3] italic font-mono">Not submitted</span>
                      )}
                    </td>

                    {/* Nemotron Score Cell */}
                    <td className="py-3 px-4 text-center font-mono font-bold text-sm text-[#171717]">
                      {sub.q2_status === 'completed' || sub.evaluation_status === 'completed'
                        ? `${sub.q2_score ?? sub.evaluation_score} / 5`
                        : '—'}
                    </td>

                    {/* Level 2 Total Score */}
                    <td className="py-3 px-4 text-center font-mono font-bold text-sm text-[#B34400]">
                      {totalL2} / 10
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-bold border ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {sub.evaluation_status === 'failed' && sub.evaluation_error && (
                        <div className="text-[10px] text-[#B42318] mt-1 max-w-[140px] truncate" title={sub.evaluation_error}>
                          {sub.evaluation_error}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setInspectingSub(sub)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] transition-colors cursor-pointer inline-flex items-center gap-1"
                        title="View Full Submission & Analysis"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => runAi(sub.conclusion_id)}
                        disabled={runningId === sub.conclusion_id}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-heading font-bold uppercase text-white bg-[#171717] hover:bg-[#333] transition-colors cursor-pointer inline-flex items-center gap-1"
                        title="Re-run AI evaluation"
                      >
                        {runningId === sub.conclusion_id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                        <span>AI</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => openOverride(sub)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] transition-colors cursor-pointer"
                        title="Manual Score Override"
                      >
                        Override
                      </button>
                    </td>
                  </tr>
                );
              })}
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#737373] font-mono">
                    No submissions recorded yet for Level 2.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* =========================================================================
          DETAILED INSPECTION MODAL
         ========================================================================= */}
      {inspectingSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-3xl w-full my-8 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <div>
                <span className="text-[10px] font-mono text-[#B34400] uppercase tracking-wider font-bold">
                  SUBMISSION INSPECTION
                </span>
                <h2 className="text-xl font-heading font-bold text-[#171717]">{inspectingSub.team_name}</h2>
              </div>
              <button onClick={() => setInspectingSub(null)} className="text-[#737373] hover:text-[#171717] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Q1 Inspection */}
            <div className="p-4 rounded-xl border border-[#E5E5E5] bg-[#F5F5F2] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-heading font-bold text-xs uppercase tracking-wider text-[#171717] flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-[#B34400]" /> Question 1: Vault Keypad PIN
                </span>
                <span className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                  inspectingSub.q1_is_correct ? 'bg-[#18794E]/10 text-[#18794E]' : 'bg-[#B42318]/10 text-[#B42318]'
                }`}>
                  {inspectingSub.q1_is_correct ? 'CORRECT' : 'INCORRECT'} · {inspectingSub.q1_score}/5 PTS
                </span>
              </div>
              <div className="font-mono text-xs text-[#171717]">
                Submitted PIN: <strong>{inspectingSub.q1_pin || 'None'}</strong>
                {inspectingSub.q1_pin_normalized && (
                  <span className="text-[#737373] ml-2">(Normalized: {inspectingSub.q1_pin_normalized})</span>
                )}
              </div>
            </div>

            {/* Q2 Inspection */}
            <div className="p-4 rounded-xl border border-[#E5E5E5] bg-[#FFFFFF] space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-heading font-bold text-xs uppercase tracking-wider text-[#171717] flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-[#B34400]" /> Question 2: Suspect Identification &amp; Reasoning
                </span>
                <span className="font-mono text-xs font-bold text-[#171717]">
                  Score: {inspectingSub.q2_score ?? inspectingSub.evaluation_score} / 5 PTS
                </span>
              </div>

              <div>
                <span className="text-[10px] font-mono uppercase text-[#737373]">Chosen Suspect:</span>
                <div className="font-heading font-bold text-sm text-[#171717]">
                  {inspectingSub.q2_selected_suspect || 'None'}
                </div>
              </div>

              <div>
                <span className="text-[10px] font-mono uppercase text-[#737373]">Team Explanation:</span>
                <p className="text-xs text-[#171717] leading-relaxed whitespace-pre-wrap p-3 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] mt-1">
                  {inspectingSub.q2_explanation || 'No explanation provided.'}
                </p>
              </div>

              {/* Evaluation Breakdown */}
              <div className="space-y-2 pt-2 border-t border-[#E5E5E5]">
                <div className="flex items-center justify-between">
                  <span className="font-heading font-bold text-xs text-[#171717]">Nemotron Evaluation Details</span>
                  <span className="text-[10px] font-mono text-[#737373]">
                    Source: {inspectingSub.evaluation_source} · Verdict: {inspectingSub.evaluation_verdict || '—'}
                  </span>
                </div>

                {inspectingSub.accuracy_summary && (
                  <div>
                    <span className="text-[10px] font-mono text-[#737373]">Accuracy Summary:</span>
                    <p className="text-xs text-[#171717] italic">{inspectingSub.accuracy_summary}</p>
                  </div>
                )}

                {Array.isArray(inspectingSub.matched_evidence) && inspectingSub.matched_evidence.length > 0 && (
                  <div>
                    <span className="text-[10px] font-mono text-[#18794E]">Matched Evidence:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {inspectingSub.matched_evidence.map((ev: string, idx: number) => (
                        <span key={idx} className="px-2 py-0.5 rounded text-[10px] bg-[#18794E]/10 text-[#18794E]">
                          ✓ {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(inspectingSub.missing_evidence) && inspectingSub.missing_evidence.length > 0 && (
                  <div>
                    <span className="text-[10px] font-mono text-[#B34400]">Missing Evidence:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {inspectingSub.missing_evidence.map((ev: string, idx: number) => (
                        <span key={idx} className="px-2 py-0.5 rounded text-[10px] bg-[#B34400]/10 text-[#B34400]">
                          • {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {inspectingSub.feedback && (
                  <div>
                    <span className="text-[10px] font-mono text-[#737373]">Evaluator Feedback:</span>
                    <p className="text-xs text-[#737373] mt-0.5">{inspectingSub.feedback}</p>
                  </div>
                )}

                {inspectingSub.closest_answer && (
                  <div>
                    <span className="text-[10px] font-mono text-[#737373]">Reference Model Summary:</span>
                    <p className="text-[11px] text-[#737373] italic bg-[#F5F5F2] p-2 rounded border border-[#E5E5E5] mt-0.5">
                      {inspectingSub.closest_answer}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setInspectingSub(null)}
                className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-xl border border-[#E5E5E5] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          OVERRIDE MODAL
         ========================================================================= */}
      {override && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-2xl w-full my-8 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <div>
                <span className="text-[10px] font-mono text-[#18794E] uppercase tracking-wider font-bold">
                  MANUAL SCORE OVERRIDE
                </span>
                <h2 className="text-lg font-heading font-bold text-[#171717]">Team: {override.team_name}</h2>
              </div>
              <button onClick={() => setOverride(null)} className="text-[#737373] hover:text-[#171717] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={saveOverride} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Question 1 PIN Score (0 – 5)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    value={q1Score}
                    onChange={(e) => setQ1Score(parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2.5 border border-[#E5E5E5] rounded-xl text-xs font-mono"
                  />
                  <span className="text-[10px] text-[#737373] mt-1 block">PIN Submitted: {override.q1_pin || 'None'}</span>
                </div>

                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Question 2 Reasoning Score (0 – 5)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.5}
                    value={q2Score}
                    onChange={(e) => setQ2Score(parseFloat(e.target.value) || 0)}
                    className="w-full px-3.5 py-2.5 border border-[#E5E5E5] rounded-xl text-xs font-mono"
                  />
                  <span className="text-[10px] text-[#737373] mt-1 block">Suspect: {override.q2_selected_suspect || 'None'}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Verdict Label
                </label>
                <input
                  type="text"
                  required
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value)}
                  placeholder="e.g. Strong / Partial / Incorrect"
                  className="w-full px-3.5 py-2.5 border border-[#E5E5E5] rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Reasoning / Override Note
                </label>
                <textarea
                  rows={3}
                  value={reasoning}
                  onChange={(e) => setReasoning(e.target.value)}
                  placeholder="Explain why this score was manually modified (recorded in audit log)"
                  className="w-full p-3 border border-[#E5E5E5] rounded-xl text-xs leading-relaxed"
                />
              </div>

              {modalError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="pt-3 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOverride(null)}
                  className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Override</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

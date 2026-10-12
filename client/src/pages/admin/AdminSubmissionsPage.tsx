import React, { useState, useEffect } from 'react';
import { apiFetch, downloadFile } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import {
  AlertCircle,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Eye,
  KeyRound,
  UserCheck,
  RotateCcw,
  Download
} from 'lucide-react';

export const AdminSubmissionsPage: React.FC = () => {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [queueStats, setQueueStats] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [isDownloadingL2, setIsDownloadingL2] = useState<boolean>(false);
  const [isDownloadingL1, setIsDownloadingL1] = useState<boolean>(false);

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

  const handleDownloadSubmissionsCsv = async () => {
    setIsDownloadingL2(true);
    try {
      await downloadFile('/api/admin/submissions/csv', `techbrains_level2_submissions_${Date.now()}.csv`);
    } catch (err: any) {
      alert(err.message || 'Failed to download Level 2 submissions CSV.');
    } finally {
      setIsDownloadingL2(false);
    }
  };

  const handleDownloadLevel1Csv = async () => {
    setIsDownloadingL1(true);
    try {
      await downloadFile('/api/admin/submissions/level1/csv', `techbrains_level1_responses_${Date.now()}.csv`);
    } catch (err: any) {
      alert(err.message || 'Failed to download Level 1 responses CSV.');
    } finally {
      setIsDownloadingL1(false);
    }
  };

  const fetchSubmissions = async () => {
    try {
      const res = await apiFetch<{ submissions: any[]; queue_stats?: any }>('/api/admin/submissions');
      setSubmissions(res.submissions);
      if (res.queue_stats) setQueueStats(res.queue_stats);
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
    socket.on('team:score_updated', refresh);
    socket.on('team:private_updated', refresh);
    return () => {
      socket.off('submission:created', refresh);
      socket.off('team:score_updated', refresh);
      socket.off('team:private_updated', refresh);
    };
  }, []);

  const runAi = async (conclusionId: string) => {
    setRunningId(conclusionId);
    try {
      await apiFetch(`/api/admin/evaluations/${conclusionId}/evaluate`, { method: 'POST' });
      await fetchSubmissions();
    } catch (err: any) {
      alert(err.message || 'Evaluation failed.');
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
    const st = (s.q2_status || s.evaluation_status) as string | null;
    if (s.evaluation_is_overridden || st === 'overridden') {
      return { label: 'OVERRIDDEN', cls: 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/30' };
    }
    if (st === 'processing') {
      return { label: 'PROCESSING', cls: 'bg-[#0284C7]/10 text-[#0284C7] border-[#0284C7]/30' };
    }
    if (st === 'completed') {
      return { label: 'COMPLETED', cls: 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/20' };
    }
    if (st === 'failed') {
      return { label: 'FAILED', cls: 'bg-[#B42318]/5 text-[#B42318] border-[#B42318]/20' };
    }
    return { label: 'PENDING', cls: 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]' };
  };

  if (isLoading) {
    return <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[40vh]">Loading submissions...</div>;
  }

  const counts = queueStats?.db_counts || {
    pending: submissions.filter((s) => s.evaluation_status === 'pending').length,
    processing: submissions.filter((s) => s.evaluation_status === 'processing').length,
    completed: submissions.filter((s) => s.evaluation_status === 'completed').length,
    failed: submissions.filter((s) => s.evaluation_status === 'failed').length,
    overridden: submissions.filter((s) => s.evaluation_is_overridden).length
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">Level 2 Submissions &amp; Evaluation</h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Question 1 is deterministically scored (0 or 5). Question 2 is evaluated automatically (0-5).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="px-3 py-1 rounded-xl bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400]">
              Pending: <strong>{counts.pending}</strong>
            </span>
            {counts.processing > 0 && (
              <span className="px-3 py-1 rounded-xl bg-[#0284C7]/10 border border-[#0284C7]/30 text-[#0284C7]">
                Processing: <strong>{counts.processing}</strong>
              </span>
            )}
            <span className="px-3 py-1 rounded-xl bg-[#18794E]/10 border border-[#18794E]/30 text-[#18794E]">
              Completed: <strong>{counts.completed}</strong>
            </span>
            {counts.failed > 0 && (
              <span className="px-3 py-1 rounded-xl bg-[#B42318]/10 border border-[#B42318]/30 text-[#B42318]">
                Failed: <strong>{counts.failed}</strong>
              </span>
            )}
            {counts.overridden > 0 && (
              <span className="px-3 py-1 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-[#171717]">
                Overridden: <strong>{counts.overridden}</strong>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadSubmissionsCsv}
              disabled={submissions.length === 0 || isDownloadingL2}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-heading font-bold uppercase tracking-wider text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
              title="Download Level 2 Submissions CSV"
            >
              {isDownloadingL2 ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>EXPORT L2 SUBMISSIONS CSV</span>
            </button>
            <button
              onClick={handleDownloadLevel1Csv}
              disabled={isDownloadingL1}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-heading font-semibold uppercase tracking-wider text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] border border-[#E5E5E5] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs cursor-pointer"
              title="Download Level 1 Question Responses CSV"
            >
              {isDownloadingL1 ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#737373]" />
              ) : (
                <Download className="w-4 h-4 text-[#737373]" />
              )}
              <span>L1 RESPONSES CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Evaluation Diagnostics & Credential Observability */}
      {queueStats && (
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-4 shadow-xs space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E5E5] pb-3">
            <div className="flex items-center gap-2">
              <span className="font-heading font-bold text-sm text-[#171717]">
                Evaluation Engine Diagnostics
              </span>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-[#F5F5F2] text-[#737373] border border-[#E5E5E5]">
                {queueStats.provider || 'unknown'} &bull; {queueStats.model || 'default'}
              </span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-[#737373]">
                Queue: <strong>{queueStats.queued || 0}</strong> queued / <strong>{queueStats.active || 0}</strong> active (Limit: {queueStats.concurrency_limit || 2})
              </span>
            </div>
          </div>

          {!queueStats.is_configured && (
            <div className="p-3 rounded-xl bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] text-xs flex items-center justify-between gap-3 font-mono">
              <div className="flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-[#B34400]" />
                <span>
                  <strong>Automatic evaluation is not configured</strong> (<code>AI_PROVIDER={queueStats.provider || 'none'}</code>).
                  Participant submissions are securely preserved. Evaluations can be manually scored via the Override button or processed after setting credentials in <code>.env</code>.
                </span>
              </div>
            </div>
          )}

          {queueStats.sharedQuotaDetected && (
            <div className="p-2.5 rounded-xl bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-[#B42318]" />
              <span>
                <strong>Shared Rate Limit Detected:</strong> Both primary and secondary credentials encountered HTTP 429 within 30s. Provider appears to enforce account-level or IP-level quota sharing.
              </span>
            </div>
          )}

          {queueStats.provider === 'ollama' ? (
            <div className="p-3.5 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] text-xs font-mono text-[#166534] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#18794E] shrink-0" />
                <span>
                  Local Ollama Engine Active: <strong>{queueStats.model || 'qwen3:8b'}</strong> on <strong>127.0.0.1:11434</strong> (Offline LAN mode & zero rate limits).
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-[#18794E] text-white shrink-0">
                OLLAMA READY
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Primary Key Slot */}
              {(() => {
                const cred = queueStats.credentials?.primary || (Array.isArray(queueStats.credentials_list) ? queueStats.credentials_list.find((c: any) => c.slot === 'primary') : null);
                const isCooling = cred?.rateLimitedUntil && new Date(cred.rateLimitedUntil).getTime() > Date.now();
                return (
                  <div className={`p-3 rounded-xl border text-xs font-mono transition-all ${
                    !cred?.configured 
                      ? 'bg-[#F5F5F2]/50 border-[#E5E5E5] text-[#737373]' 
                      : !cred.usable
                      ? 'bg-[#B42318]/5 border-[#B42318]/30 text-[#B42318]'
                      : isCooling
                      ? 'bg-[#FFF0D6] border-[#FED7AA] text-[#B34400]'
                      : 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                  }`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold flex items-center gap-1.5 text-[#171717]">
                        <KeyRound className="w-3.5 h-3.5" />
                        Credential Slot 1 (Primary)
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        !cred?.configured
                          ? 'bg-[#E5E5E5] text-[#525252]'
                          : !cred.usable
                          ? 'bg-[#B42318] text-white'
                          : isCooling
                          ? 'bg-[#F59E0B] text-white'
                          : 'bg-[#18794E] text-white'
                      }`}>
                        {!cred?.configured ? 'NOT CONFIGURED' : !cred.usable ? 'AUTH FAILED / DISABLED' : isCooling ? 'COOLING (429)' : 'ACTIVE & READY'}
                      </span>
                    </div>
                    {cred?.configured ? (
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-[#525252] mt-2">
                        <div>Requests: <strong className="text-[#171717]">{cred.requestCount}</strong></div>
                        <div>Errors: <strong className="text-[#171717]">{cred.errorCount}</strong></div>
                        <div>Rate Limits (429): <strong className="text-[#171717]">{cred.rateLimitCount}</strong></div>
                        <div>Auth Failures: <strong className="text-[#171717]">{cred.authErrorCount}</strong></div>
                        {isCooling && (
                          <div className="col-span-2 text-[#B34400] font-semibold mt-1">
                            Cooldown: {cred.retryDelaySeconds}s delay (until {new Date(cred.rateLimitedUntil).toLocaleTimeString()})
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#737373] mt-1">
                        API key is not configured in .env.
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Secondary Key Slot */}
              {(() => {
                const cred = queueStats.credentials?.secondary || (Array.isArray(queueStats.credentials_list) ? queueStats.credentials_list.find((c: any) => c.slot === 'secondary') : null);
                const isCooling = cred?.rateLimitedUntil && new Date(cred.rateLimitedUntil).getTime() > Date.now();
                return (
                  <div className={`p-3 rounded-xl border text-xs font-mono transition-all ${
                    !cred?.configured 
                      ? 'bg-[#F5F5F2]/50 border-[#E5E5E5] text-[#737373]' 
                      : !cred.usable
                      ? 'bg-[#B42318]/5 border-[#B42318]/30 text-[#B42318]'
                      : isCooling
                      ? 'bg-[#FFF0D6] border-[#FED7AA] text-[#B34400]'
                      : 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                  }`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold flex items-center gap-1.5 text-[#171717]">
                        <KeyRound className="w-3.5 h-3.5" />
                        Credential Slot 2 (Secondary)
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        !cred?.configured
                          ? 'bg-[#E5E5E5] text-[#525252]'
                          : !cred.usable
                          ? 'bg-[#B42318] text-white'
                          : isCooling
                          ? 'bg-[#F59E0B] text-white'
                          : 'bg-[#18794E] text-white'
                      }`}>
                        {!cred?.configured ? 'NOT CONFIGURED' : !cred.usable ? 'AUTH FAILED / DISABLED' : isCooling ? 'COOLING (429)' : 'ACTIVE & READY'}
                      </span>
                    </div>
                    {cred?.configured ? (
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-[#525252] mt-2">
                        <div>Requests: <strong className="text-[#171717]">{cred.requestCount}</strong></div>
                        <div>Errors: <strong className="text-[#171717]">{cred.errorCount}</strong></div>
                        <div>Rate Limits (429): <strong className="text-[#171717]">{cred.rateLimitCount}</strong></div>
                        <div>Auth Failures: <strong className="text-[#171717]">{cred.authErrorCount}</strong></div>
                        {isCooling && (
                          <div className="col-span-2 text-[#B34400] font-semibold mt-1">
                            Cooldown: {cred.retryDelaySeconds}s delay (until {new Date(cred.rateLimitedUntil).toLocaleTimeString()})
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#737373] mt-1">
                        Secondary key is optional.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Question 1 (Vault PIN)</th>
                <th className="py-3 px-4">Question 2 (Suspect)</th>
                <th className="py-3 px-4 text-center">Evaluation (Q2)</th>
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
                    <td className="py-3 px-4">
                      <div className="font-heading font-bold text-[#171717]">{sub.team_name}</div>
                      {(sub.player1_roll || sub.player2_roll) && (
                        <div className="font-mono text-[10px] text-[#737373]">
                          P1: {sub.player1_roll || '—'} &bull; P2: {sub.player2_roll || '—'}
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-[#A3A3A3] font-normal">
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

                    {/* Evaluation Score Cell */}
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
                        title="Re-run evaluation"
                      >
                        {runningId === sub.conclusion_id && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        <span>Eval</span>
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
                {(inspectingSub.player1_roll || inspectingSub.player2_roll) && (
                  <div className="text-xs font-mono text-[#737373] mt-0.5">
                    Player 1 Roll: <strong className="text-[#171717]">{inspectingSub.player1_roll || '—'}</strong> · Player 2 Roll: <strong className="text-[#171717]">{inspectingSub.player2_roll || '—'}</strong>
                  </div>
                )}
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
                  <span className="font-heading font-bold text-xs text-[#171717]">Evaluation Details</span>
                  <span className="text-[10px] font-mono text-[#737373]">
                    Source: {inspectingSub.evaluation_source} · Verdict: {inspectingSub.evaluation_verdict || '—'}
                  </span>
                </div>

                {(inspectingSub.suspect_score !== undefined && inspectingSub.suspect_score !== null) && (
                  <div className="grid grid-cols-3 gap-2 py-1">
                    <div className="p-2 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] text-center">
                      <span className="text-[10px] font-mono text-[#737373] uppercase block font-semibold">Suspect ID</span>
                      <span className="font-mono font-bold text-xs text-[#171717]">{inspectingSub.suspect_score} / 2 pts</span>
                    </div>
                    <div className="p-2 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] text-center">
                      <span className="text-[10px] font-mono text-[#737373] uppercase block font-semibold">Evidence</span>
                      <span className="font-mono font-bold text-xs text-[#171717]">{inspectingSub.evidence_score ?? 0} / 2 pts</span>
                    </div>
                    <div className="p-2 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] text-center">
                      <span className="text-[10px] font-mono text-[#737373] uppercase block font-semibold">Reasoning</span>
                      <span className="font-mono font-bold text-xs text-[#171717]">{inspectingSub.logic_score ?? 0} / 1 pt</span>
                    </div>
                  </div>
                )}

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

                {inspectingSub.evaluation_status === 'failed' && inspectingSub.evaluation_error && (
                  <div className="p-3 rounded-lg bg-[#B42318]/10 border border-[#B42318]/30 text-[#B42318] text-xs space-y-1">
                    <span className="font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Evaluation Failure:
                    </span>
                    <p className="font-mono text-[11px] break-all">{inspectingSub.evaluation_error}</p>
                    <span className="text-[10px] text-[#737373] block">
                      Attempts recorded: {inspectingSub.evaluation_attempts || 1}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-between items-center">
              <div>
                {inspectingSub.evaluation_status === 'failed' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const id = inspectingSub.conclusion_id;
                      setInspectingSub(null);
                      await runAi(id);
                    }}
                    className="px-3.5 py-2 text-xs font-heading font-bold text-white bg-[#171717] hover:bg-[#333] rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Evaluation</span>
                  </button>
                )}
              </div>
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

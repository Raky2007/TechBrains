import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import {
  AlertCircle,
  X,
  RotateCcw
} from 'lucide-react';

export const AdminSubmissionsPage: React.FC = () => {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeSubmissionToEvaluate, setActiveSubmissionToEvaluate] = useState<any | null>(null);

  // Evaluation Form State
  const [accuracyScore, setAccuracyScore] = useState<number>(8);
  const [reasoningScore, setReasoningScore] = useState<number>(4);
  const [efficiencyScore, setEfficiencyScore] = useState<number>(4);
  const [feedback, setFeedback] = useState<string>('');
  const [isSubmittingEval, setIsSubmittingEval] = useState<boolean>(false);
  const [evalError, setEvalError] = useState<string | null>(null);

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
    const handleNewSubmission = () => fetchSubmissions();
    socket.on('submission:created', handleNewSubmission);
    return () => {
      socket.off('submission:created', handleNewSubmission);
    };
  }, []);

  const openEvaluationModal = (sub: any) => {
    setActiveSubmissionToEvaluate(sub);
    setAccuracyScore(sub.accuracy_score ?? 8);
    setReasoningScore(sub.reasoning_score ?? 4);
    setEfficiencyScore(sub.efficiency_score ?? 4);
    setFeedback(sub.feedback || '');
    setEvalError(null);
  };

  const handleSaveEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSubmissionToEvaluate) return;

    setIsSubmittingEval(true);
    setEvalError(null);

    try {
      await apiFetch('/api/admin/evaluations', {
        method: 'POST',
        body: JSON.stringify({
          conclusion_id: activeSubmissionToEvaluate.conclusion_id,
          accuracy_score: Number(accuracyScore),
          reasoning_score: Number(reasoningScore),
          efficiency_score: Number(efficiencyScore),
          feedback: feedback.trim() || null
        })
      });

      setActiveSubmissionToEvaluate(null);
      await fetchSubmissions();
    } catch (err: any) {
      setEvalError(err.message || 'Failed to record evaluation.');
    } finally {
      setIsSubmittingEval(false);
    }
  };

  const handleReopen = async (conclusionId: string) => {
    if (!window.confirm('Reopen this conclusion to allow the team to edit their submission?')) return;
    try {
      await apiFetch(`/api/admin/submissions/${conclusionId}/reopen`, { method: 'POST' });
      await fetchSubmissions();
    } catch (err: any) {
      alert(err.message || 'Failed to reopen submission.');
    }
  };

  const totalCalculatedScore = Number((accuracyScore + reasoningScore + efficiencyScore).toFixed(2));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">
            Level 2 Forensic Submissions & Evaluation
          </h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Grade investigative synthesis using standard collegiate forensic rubrics (Max: 20 pts).
          </p>
        </div>
        <span className="px-3.5 py-1.5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] font-mono text-xs text-[#171717]">
          Queue: <strong className="text-[#FF8A24]">{submissions.filter((s) => !s.evaluation_id).length} Pending</strong>
        </span>
      </div>

      {/* Submissions List */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Clues & Credits</th>
                <th className="py-3 px-4">Conclusion Snippet</th>
                <th className="py-3 px-4 text-center">Score (Max 20)</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {submissions.map((sub, idx) => {
                const isEven = idx % 2 === 1;
                return (
                  <tr key={sub.conclusion_id} className={`transition-colors hover:bg-[#FFF0D6]/40 ${isEven ? 'bg-[#F5F5F2]/40' : 'bg-[#FFFFFF]'}`}>
                    <td className="py-3 px-4 font-heading font-bold text-[#171717]">
                      {sub.team_name}
                    </td>
                    <td className="py-3 px-4 font-mono text-[#737373]">
                      <div>Unlocked: <strong className="text-[#171717]">{sub.unlocked_count} clues</strong></div>
                      <div>Spent: <strong className="text-[#B34400]">{sub.credits_spent} CR</strong></div>
                    </td>
                    <td className="py-3 px-4 text-[#737373] max-w-sm">
                      <p className="line-clamp-2 leading-relaxed font-body">
                        {sub.conclusion_text}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-sm text-[#171717]">
                      {sub.evaluation_id ? `${sub.total_score} pts` : '—'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-full font-mono text-[10px] font-bold border ${
                          sub.evaluation_id
                            ? 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/20'
                            : 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]'
                        }`}
                      >
                        {sub.evaluation_id ? 'GRADED' : 'AWAITING EVALUATION'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      {/* Primary CTA: #FFC928 */}
                      <button
                        onClick={() => openEvaluationModal(sub)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] transition-colors cursor-pointer shadow-2xs"
                      >
                        {sub.evaluation_id ? 'Re-Evaluate' : 'Evaluate'}
                      </button>
                      <button
                        onClick={() => handleReopen(sub.conclusion_id)}
                        title="Reopen for team editing"
                        className="p-1.5 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#F5F5F2] transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[#737373] font-mono">
                    No teams have submitted Level 2 forensic conclusions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Evaluation Rubric Modal */}
      {activeSubmissionToEvaluate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-2xl w-full my-8 shadow-xl space-y-6 relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <div>
                <span className="text-[10px] font-mono text-[#18794E] uppercase tracking-wider font-bold">
                  RUBRIC EVALUATION
                </span>
                <h2 className="text-lg font-heading font-bold text-[#171717]">
                  Team: {activeSubmissionToEvaluate.team_name}
                </h2>
              </div>
              <button
                onClick={() => setActiveSubmissionToEvaluate(null)}
                className="text-[#737373] hover:text-[#171717] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Team Intel Stats */}
            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-center text-xs font-mono">
              <div>
                <span className="text-[#737373] block text-[10px]">CLUES UNLOCKED</span>
                <span className="font-bold text-[#171717]">{activeSubmissionToEvaluate.unlocked_count} clues</span>
              </div>
              <div>
                <span className="text-[#737373] block text-[10px]">CREDITS SPENT</span>
                <span className="font-bold text-[#B34400]">{activeSubmissionToEvaluate.credits_spent} CR</span>
              </div>
              <div>
                <span className="text-[#737373] block text-[10px]">REMAINING</span>
                <span className="font-bold text-[#171717]">{activeSubmissionToEvaluate.current_credits} CR</span>
              </div>
            </div>

            {/* Submitted Conclusion Text */}
            <div className="space-y-1.5">
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">
                Submitted Forensic Synthesis
              </label>
              <div className="p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] text-xs sm:text-sm text-[#171717] leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-body">
                {activeSubmissionToEvaluate.conclusion_text}
              </div>
            </div>

            {/* Rubric Inputs */}
            <form onSubmit={handleSaveEvaluation} className="space-y-5">
              <div className="space-y-4 p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-heading font-bold text-[#171717] uppercase">
                    Scoring Rubric Breakdown
                  </span>
                  <span className="text-sm font-mono font-bold text-[#171717]">
                    Total: {totalCalculatedScore} / 20 pts
                  </span>
                </div>

                {/* 1. Accuracy (0-10) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#171717]">1. Accuracy & Root Cause Identification (0 – 10):</span>
                    <span className="font-bold text-[#171717]">{accuracyScore} pts</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={accuracyScore}
                    onChange={(e) => setAccuracyScore(parseFloat(e.target.value))}
                    className="w-full accent-[#FFC928] cursor-pointer"
                  />
                </div>

                {/* 2. Reasoning (0-5) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#171717]">2. Reasoning & Artifact Linkage (0 – 5):</span>
                    <span className="font-bold text-[#171717]">{reasoningScore} pts</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.5}
                    value={reasoningScore}
                    onChange={(e) => setReasoningScore(parseFloat(e.target.value))}
                    className="w-full accent-[#FFC928] cursor-pointer"
                  />
                </div>

                {/* 3. Efficiency (0-5) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-[#171717]">3. Credit Efficiency & Clue Economy (0 – 5):</span>
                    <span className="font-bold text-[#171717]">{efficiencyScore} pts</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.5}
                    value={efficiencyScore}
                    onChange={(e) => setEfficiencyScore(parseFloat(e.target.value))}
                    className="w-full accent-[#FFC928] cursor-pointer"
                  />
                </div>
              </div>

              {/* Feedback */}
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Evaluator Feedback
                </label>
                <textarea
                  rows={2}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Provide concise analytical feedback for the team."
                  className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717]"
                />
              </div>

              {evalError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{evalError}</span>
                </div>
              )}

              <div className="pt-3 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveSubmissionToEvaluate(null)}
                  className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEval}
                  className="px-5 py-2.5 text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] rounded-lg shadow-xs cursor-pointer"
                >
                  {isSubmittingEval ? 'Saving...' : 'Save Evaluation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

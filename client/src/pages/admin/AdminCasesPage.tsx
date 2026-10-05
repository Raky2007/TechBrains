import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { Level2Case, Clue } from '@nexus/shared';
import {
  Plus,
  Trash2,
  X,
  AlertCircle
} from 'lucide-react';

export const AdminCasesPage: React.FC = () => {
  const [cases, setCases] = useState<(Level2Case & { clues: Clue[] })[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCaseModalOpen, setIsCaseModalOpen] = useState<boolean>(false);
  const [isClueModalOpen, setIsClueModalOpen] = useState<boolean>(false);
  const [activeCaseIdForClue, setActiveCaseIdForClue] = useState<string | null>(null);

  // Case Form State
  const [caseTitle, setCaseTitle] = useState<string>('');
  const [situationDescription, setSituationDescription] = useState<string>('');
  const [caseMediaPath, setCaseMediaPath] = useState<string>('');
  const [initialCredits, setInitialCredits] = useState<number>(200);

  // Clue Form State
  const [clueTitle, setClueTitle] = useState<string>('');
  const [clueContent, setClueContent] = useState<string>('');
  const [clueCost, setClueCost] = useState<number>(30);
  const [displayOrder, setDisplayOrder] = useState<number>(1);

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchCases = async () => {
    try {
      const res = await apiFetch<{ cases: (Level2Case & { clues: Clue[] })[] }>('/api/admin/cases');
      setCases(res.cases);
    } catch (err) {
      console.error('Failed to load cases:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, []);

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      await apiFetch('/api/admin/cases', {
        method: 'POST',
        body: JSON.stringify({
          title: caseTitle.trim(),
          situation_description: situationDescription.trim(),
          media_path: caseMediaPath || null,
          initial_credits: initialCredits,
          is_active: 1
        })
      });

      setIsCaseModalOpen(false);
      setCaseTitle('');
      setSituationDescription('');
      setCaseMediaPath('');
      await fetchCases();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create case.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveClue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCaseIdForClue) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      await apiFetch('/api/admin/clues', {
        method: 'POST',
        body: JSON.stringify({
          case_id: activeCaseIdForClue,
          title: clueTitle.trim(),
          content: clueContent.trim(),
          credit_cost: clueCost,
          display_order: displayOrder,
          is_active: 1
        })
      });

      setIsClueModalOpen(false);
      setClueTitle('');
      setClueContent('');
      setClueCost(30);
      await fetchCases();
    } catch (err: any) {
      setFormError(err.message || 'Failed to add clue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClue = async (clueId: string) => {
    if (!window.confirm('Remove this clue?')) return;
    try {
      await apiFetch(`/api/admin/clues/${clueId}`, { method: 'DELETE' });
      await fetchCases();
    } catch (err: any) {
      alert(err.message || 'Failed to delete clue.');
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">
            Level 2 Cases & Forensic Clues
          </h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Configure incident situations, encrypted clues, and credit pricing.
          </p>
        </div>

        {/* Primary CTA: #FFC928 */}
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setIsCaseModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-heading font-bold uppercase tracking-wider text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all shadow-xs self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#171717]" />
          <span>UPLOAD NEW CASE</span>
        </button>
      </div>

      {/* Cases List */}
      <div className="space-y-6">
        {cases.map((c) => (
          <div key={c.id} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E5E5E5]">
              <div>
                <span className="text-[10px] font-mono text-[#18794E] uppercase tracking-widest font-bold">
                  CASE DOSSIER
                </span>
                <h2 className="text-xl font-heading font-bold text-[#171717] mt-0.5">
                  {c.title}
                </h2>
              </div>
              <div className="flex items-center gap-3">
                {/* Credit balance: #FFF0D6 with dark orange text #B34400 */}
                <span className="px-3 py-1.5 rounded-lg bg-[#FFF0D6] border border-[#FED7AA] font-mono text-xs text-[#B34400] font-bold">
                  Initial Credits: {c.initial_credits} CR
                </span>
                {/* Secondary CTA: #FF8A24 */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveCaseIdForClue(c.id);
                    setFormError(null);
                    setDisplayOrder(c.clues.length + 1);
                    setIsClueModalOpen(true);
                  }}
                  className="px-3.5 py-1.5 rounded-lg font-heading font-bold text-xs tracking-wider uppercase text-white bg-[#FF8A24] hover:bg-[#F27D16] transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ADD CLUE</span>
                </button>
              </div>
            </div>

            {/* Situation Description: Alternate section #F5F5F2 */}
            <p className="text-xs sm:text-sm text-[#171717] leading-relaxed whitespace-pre-wrap bg-[#F5F5F2] p-4 rounded-xl border border-[#E5E5E5] font-body">
              {c.situation_description}
            </p>

            {/* Clues Table */}
            <div className="space-y-3">
              <h3 className="text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">
                Classified Clues ({c.clues.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {c.clues.map((clue) => (
                  <div
                    key={clue.id}
                    className="p-4 rounded-xl bg-[#FFFFFF] border border-[#E5E5E5] flex flex-col justify-between space-y-3 hover:border-[#171717] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-[#F5F5F2] border border-[#E5E5E5] flex items-center justify-center font-mono text-xs font-bold text-[#171717]">
                          #{clue.display_order}
                        </span>
                        <h4 className="font-heading font-bold text-xs text-[#171717]">
                          {clue.title}
                        </h4>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] shrink-0">
                        {clue.credit_cost} CR
                      </span>
                    </div>

                    <p className="text-xs text-[#737373] font-mono leading-relaxed line-clamp-3">
                      {clue.content}
                    </p>

                    <div className="pt-2 border-t border-[#E5E5E5] flex items-center justify-end">
                      <button
                        onClick={() => handleDeleteClue(clue.id)}
                        className="text-[11px] text-[#737373] hover:text-[#B42318] transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Create Case Modal */}
      {isCaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-xl w-full shadow-xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <h2 className="text-lg font-heading font-bold text-[#171717]">Upload Level 2 Forensic Case</h2>
              <button onClick={() => setIsCaseModalOpen(false)} className="text-[#737373] hover:text-[#171717] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveCase} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Case Title
                </label>
                <input
                  type="text"
                  required
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  placeholder="e.g. Case 501: Autonomous Drone Grid Infiltration"
                  className="w-full px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717]"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Situation & Narrative
                </label>
                <textarea
                  rows={4}
                  required
                  value={situationDescription}
                  onChange={(e) => setSituationDescription(e.target.value)}
                  placeholder="Describe the crime scene, telemetry anomaly, and forensic context."
                  className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717] leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Initial Allocated Credits per Team
                </label>
                <input
                  type="number"
                  min={10}
                  value={initialCredits}
                  onChange={(e) => setInitialCredits(parseInt(e.target.value, 10))}
                  className="w-full px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717]"
                />
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="pt-4 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCaseModalOpen(false)}
                  className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] rounded-lg shadow-xs cursor-pointer"
                >
                  {isSubmitting ? 'Creating...' : 'Save Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Clue Modal */}
      {isClueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-xl w-full shadow-xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <h2 className="text-lg font-heading font-bold text-[#171717]">Add Encrypted Clue</h2>
              <button onClick={() => setIsClueModalOpen(false)} className="text-[#737373] hover:text-[#171717] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveClue} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Clue Title
                </label>
                <input
                  type="text"
                  required
                  value={clueTitle}
                  onChange={(e) => setClueTitle(e.target.value)}
                  placeholder="e.g. Clue 03: Rogue Wi-Fi Beacon Packets"
                  className="w-full px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717]"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Decrypted Evidence Content
                </label>
                <textarea
                  rows={4}
                  required
                  value={clueContent}
                  onChange={(e) => setClueContent(e.target.value)}
                  placeholder="The detailed forensic evidence revealed to the team upon purchase."
                  className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717] leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Credit Price
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={clueCost}
                    onChange={(e) => setClueCost(parseInt(e.target.value, 10))}
                    className="w-full px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Display Order
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10))}
                    className="w-full px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs"
                  />
                </div>
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="pt-4 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsClueModalOpen(false)}
                  className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-heading font-bold uppercase text-white bg-[#FF8A24] hover:bg-[#F27D16] active:bg-[#D96B07] rounded-lg shadow-xs cursor-pointer"
                >
                  {isSubmitting ? 'Adding...' : 'Add Clue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

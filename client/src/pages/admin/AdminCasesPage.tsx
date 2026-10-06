import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { Level2Case, Clue, CaseMedia } from '@nexus/shared';
import { Plus, Trash2, X, AlertCircle, Pencil, Film, Upload } from 'lucide-react';

type CaseWithChildren = Level2Case & { clues: Clue[]; media: CaseMedia[] };

const emptyCaseForm = {
  title: '',
  situation_description: '',
  initial_credits: 200,
  viewing_duration_seconds: 60,
  replay_cost: 20,
  reference_answer: '',
  evaluation_guidance: ''
};

const emptyClueForm = { title: '', content: '', credit_cost: 30, display_order: 1 };

export const AdminCasesPage: React.FC = () => {
  const [cases, setCases] = useState<CaseWithChildren[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Case modal (create or edit)
  const [caseModal, setCaseModal] = useState<{ open: boolean; editingId: string | null }>({ open: false, editingId: null });
  const [caseForm, setCaseForm] = useState({ ...emptyCaseForm });

  // Clue modal (create or edit)
  const [clueModal, setClueModal] = useState<{ open: boolean; caseId: string | null; editingId: string | null }>({ open: false, caseId: null, editingId: null });
  const [clueForm, setClueForm] = useState({ ...emptyClueForm });

  // Media add per case
  const [mediaForm, setMediaForm] = useState<{ caseId: string | null; media_type: 'image' | 'video' | 'audio'; media_path: string; caption: string }>({ caseId: null, media_type: 'image', media_path: '', caption: '' });
  const [isUploading, setIsUploading] = useState(false);

  const fetchCases = async () => {
    try {
      const res = await apiFetch<{ cases: CaseWithChildren[] }>('/api/admin/cases');
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

  const openCreateCase = () => {
    setCaseForm({ ...emptyCaseForm });
    setFormError(null);
    setCaseModal({ open: true, editingId: null });
  };

  const openEditCase = (c: CaseWithChildren) => {
    setCaseForm({
      title: c.title,
      situation_description: c.situation_description,
      initial_credits: c.initial_credits,
      viewing_duration_seconds: c.viewing_duration_seconds,
      replay_cost: c.replay_cost,
      reference_answer: c.reference_answer || '',
      evaluation_guidance: c.evaluation_guidance || ''
    });
    setFormError(null);
    setCaseModal({ open: true, editingId: c.id });
  };

  const handleSaveCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      const body = JSON.stringify({ ...caseForm, is_active: 1 });
      if (caseModal.editingId) {
        await apiFetch(`/api/admin/cases/${caseModal.editingId}`, { method: 'PUT', body });
      } else {
        await apiFetch('/api/admin/cases', { method: 'POST', body });
      }
      setCaseModal({ open: false, editingId: null });
      await fetchCases();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save case.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCreateClue = (caseId: string, nextOrder: number) => {
    setClueForm({ ...emptyClueForm, display_order: nextOrder });
    setFormError(null);
    setClueModal({ open: true, caseId, editingId: null });
  };

  const openEditClue = (caseId: string, clue: Clue) => {
    setClueForm({ title: clue.title, content: clue.content, credit_cost: clue.credit_cost, display_order: clue.display_order });
    setFormError(null);
    setClueModal({ open: true, caseId, editingId: clue.id });
  };

  const handleSaveClue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      if (clueModal.editingId) {
        await apiFetch(`/api/admin/clues/${clueModal.editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: clueForm.title.trim(),
            content: clueForm.content.trim(),
            credit_cost: clueForm.credit_cost,
            display_order: clueForm.display_order
          })
        });
      } else {
        await apiFetch('/api/admin/clues', {
          method: 'POST',
          body: JSON.stringify({
            case_id: clueModal.caseId,
            title: clueForm.title.trim(),
            content: clueForm.content.trim(),
            credit_cost: clueForm.credit_cost,
            display_order: clueForm.display_order,
            is_active: 1
          })
        });
      }
      setClueModal({ open: false, caseId: null, editingId: null });
      await fetchCases();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save clue.');
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

  const handleUploadMedia = async (file: File) => {
    setIsUploading(true);
    setFormError(null);
    try {
      const fd = new FormData();
      fd.append('media', file);
      const res = await apiFetch<{ media_path: string }>('/api/admin/upload', { method: 'POST', body: fd });
      setMediaForm((prev) => ({ ...prev, media_path: res.media_path }));
    } catch (err: any) {
      setFormError(err.message || 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddMedia = async (caseId: string) => {
    if (!mediaForm.media_path) {
      alert('Provide a media URL or upload a file first.');
      return;
    }
    try {
      await apiFetch('/api/admin/case-media', {
        method: 'POST',
        body: JSON.stringify({
          case_id: caseId,
          media_type: mediaForm.media_type,
          media_path: mediaForm.media_path,
          caption: mediaForm.caption || null,
          display_order: 1
        })
      });
      setMediaForm({ caseId: null, media_type: 'image', media_path: '', caption: '' });
      await fetchCases();
    } catch (err: any) {
      alert(err.message || 'Failed to add media.');
    }
  };

  const handleDeleteMedia = async (mediaId: string) => {
    if (!window.confirm('Remove this media asset?')) return;
    try {
      await apiFetch(`/api/admin/case-media/${mediaId}`, { method: 'DELETE' });
      await fetchCases();
    } catch (err: any) {
      alert(err.message || 'Failed to delete media.');
    }
  };

  const input = 'w-full px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717]';
  const label = 'block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1';

  if (isLoading) {
    return <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[40vh]">Loading cases...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">Round 2 Cases & Clues</h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Configure the case, media viewing window, replay cost, text clues, reference answer and AI guidance.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateCase}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-heading font-bold uppercase tracking-wider text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] transition-all shadow-xs self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>NEW CASE</span>
        </button>
      </div>

      <div className="space-y-6">
        {cases.map((c) => (
          <div key={c.id} className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-[#E5E5E5]">
              <div>
                <span className="text-[10px] font-mono text-[#18794E] uppercase tracking-widest font-bold">CASE</span>
                <h2 className="text-xl font-heading font-bold text-[#171717] mt-0.5">{c.title}</h2>
                <div className="flex flex-wrap gap-2 mt-2 text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] font-bold">Credits: {c.initial_credits}</span>
                  <span className="px-2 py-0.5 rounded bg-[#F5F5F2] border border-[#E5E5E5] text-[#737373]">View: {c.viewing_duration_seconds}s</span>
                  <span className="px-2 py-0.5 rounded bg-[#F5F5F2] border border-[#E5E5E5] text-[#737373]">Replay: {c.replay_cost} CR</span>
                  <span className={`px-2 py-0.5 rounded border ${c.reference_answer ? 'bg-[#18794E]/10 border-[#18794E]/20 text-[#18794E]' : 'bg-[#B42318]/5 border-[#B42318]/20 text-[#B42318]'}`}>
                    {c.reference_answer ? 'Reference set' : 'No reference answer'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditCase(c)}
                  className="px-3 py-1.5 rounded-lg font-heading font-bold text-xs uppercase text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] border border-[#E5E5E5] flex items-center gap-1.5 cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => openCreateClue(c.id, c.clues.length + 1)}
                  className="px-3 py-1.5 rounded-lg font-heading font-bold text-xs uppercase text-white bg-[#FF8A24] hover:bg-[#F27D16] flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" /> Clue
                </button>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-[#171717] leading-relaxed whitespace-pre-wrap bg-[#F5F5F2] p-4 rounded-xl border border-[#E5E5E5] font-body">
              {c.situation_description}
            </p>

            {/* Case media */}
            <div className="space-y-3">
              <h3 className="text-xs font-heading font-bold uppercase tracking-wider text-[#171717] flex items-center gap-2">
                <Film className="w-3.5 h-3.5" /> Case Media ({c.media?.length || 0})
              </h3>
              <div className="flex flex-wrap gap-2">
                {(c.media || []).map((m) => (
                  <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] text-[11px] font-mono text-[#171717]">
                    <span className="uppercase text-[#737373]">{m.media_type}</span>
                    <span className="max-w-[180px] truncate">{m.media_path}</span>
                    <button onClick={() => handleDeleteMedia(m.id)} className="text-[#737373] hover:text-[#B42318] cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {/* Add media row */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <select
                  value={mediaForm.caseId === c.id ? mediaForm.media_type : 'image'}
                  onChange={(e) => setMediaForm({ caseId: c.id, media_type: e.target.value as any, media_path: mediaForm.caseId === c.id ? mediaForm.media_path : '', caption: mediaForm.caseId === c.id ? mediaForm.caption : '' })}
                  className="px-2 py-1.5 rounded-lg border border-[#E5E5E5] text-xs font-mono"
                >
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="audio">audio</option>
                </select>
                <input
                  type="text"
                  placeholder="media URL or /uploads/..."
                  value={mediaForm.caseId === c.id ? mediaForm.media_path : ''}
                  onChange={(e) => setMediaForm({ caseId: c.id, media_type: mediaForm.caseId === c.id ? mediaForm.media_type : 'image', media_path: e.target.value, caption: mediaForm.caseId === c.id ? mediaForm.caption : '' })}
                  className="flex-1 min-w-[160px] px-3 py-1.5 rounded-lg border border-[#E5E5E5] text-xs"
                />
                <label className="px-2.5 py-1.5 rounded-lg border border-[#E5E5E5] bg-[#F5F5F2] text-xs font-mono cursor-pointer flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  {isUploading && mediaForm.caseId === c.id ? 'Uploading...' : 'Upload'}
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setMediaForm((prev) => ({ ...prev, caseId: c.id }));
                        handleUploadMedia(f);
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => handleAddMedia(c.id)}
                  className="px-3 py-1.5 rounded-lg font-heading font-bold text-xs uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Clues */}
            <div className="space-y-3">
              <h3 className="text-xs font-heading font-bold uppercase tracking-wider text-[#171717]">Clues ({c.clues.length}) — text only</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {c.clues.map((clue) => (
                  <div key={clue.id} className="p-4 rounded-xl bg-[#FFFFFF] border border-[#E5E5E5] flex flex-col justify-between space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-[#F5F5F2] border border-[#E5E5E5] flex items-center justify-center font-mono text-xs font-bold text-[#171717]">#{clue.display_order}</span>
                        <h4 className="font-heading font-bold text-xs text-[#171717]">{clue.title}</h4>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] shrink-0">{clue.credit_cost} CR</span>
                    </div>
                    <p className="text-xs text-[#737373] font-mono leading-relaxed line-clamp-3">{clue.content}</p>
                    <div className="pt-2 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                      <button onClick={() => openEditClue(c.id, clue)} className="text-[11px] text-[#737373] hover:text-[#171717] transition-colors flex items-center gap-1 cursor-pointer">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={() => handleDeleteClue(clue.id)} className="text-[11px] text-[#737373] hover:text-[#B42318] transition-colors flex items-center gap-1 cursor-pointer">
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        {cases.length === 0 && (
          <div className="text-center py-12 text-sm font-mono text-[#737373] border border-dashed border-[#E5E5E5] rounded-2xl">
            No cases yet. Create one to configure Round 2.
          </div>
        )}
      </div>

      {/* Case modal */}
      {caseModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-2xl w-full shadow-xl my-8">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <h2 className="text-lg font-heading font-bold text-[#171717]">{caseModal.editingId ? 'Edit Case' : 'New Case'}</h2>
              <button onClick={() => setCaseModal({ open: false, editingId: null })} className="text-[#737373] hover:text-[#171717] cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveCase} className="space-y-4 pt-4">
              <div>
                <label className={label}>Case Title</label>
                <input type="text" required value={caseForm.title} onChange={(e) => setCaseForm({ ...caseForm, title: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label}>Situation & Narrative</label>
                <textarea rows={4} required value={caseForm.situation_description} onChange={(e) => setCaseForm({ ...caseForm, situation_description: e.target.value })} className={`${input} leading-relaxed`} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={label}>Initial Credits</label>
                  <input type="number" min={0} value={caseForm.initial_credits} onChange={(e) => setCaseForm({ ...caseForm, initial_credits: parseInt(e.target.value, 10) })} className={input} />
                </div>
                <div>
                  <label className={label}>Viewing Duration (s)</label>
                  <input type="number" min={0} value={caseForm.viewing_duration_seconds} onChange={(e) => setCaseForm({ ...caseForm, viewing_duration_seconds: parseInt(e.target.value, 10) })} className={input} />
                </div>
                <div>
                  <label className={label}>Replay Cost (CR)</label>
                  <input type="number" min={0} value={caseForm.replay_cost} onChange={(e) => setCaseForm({ ...caseForm, replay_cost: parseInt(e.target.value, 10) })} className={input} />
                </div>
              </div>
              <div>
                <label className={label}>Reference / Expected Answer (for AI evaluation)</label>
                <textarea rows={3} value={caseForm.reference_answer} onChange={(e) => setCaseForm({ ...caseForm, reference_answer: e.target.value })} className={`${input} leading-relaxed`} placeholder="The correct conclusion the AI should grade against." />
              </div>
              <div>
                <label className={label}>Evaluation Guidance (optional)</label>
                <textarea rows={3} value={caseForm.evaluation_guidance} onChange={(e) => setCaseForm({ ...caseForm, evaluation_guidance: e.target.value })} className={`${input} leading-relaxed`} placeholder="Key points to reward / penalise." />
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /><span>{formError}</span>
                </div>
              )}

              <div className="pt-4 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button type="button" onClick={() => setCaseModal({ open: false, editingId: null })} className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-5 py-2 text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] rounded-lg shadow-xs cursor-pointer">{isSubmitting ? 'Saving...' : 'Save Case'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Clue modal */}
      {clueModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-xl w-full shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <h2 className="text-lg font-heading font-bold text-[#171717]">{clueModal.editingId ? 'Edit Clue' : 'Add Clue'}</h2>
              <button onClick={() => setClueModal({ open: false, caseId: null, editingId: null })} className="text-[#737373] hover:text-[#171717] cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSaveClue} className="space-y-4 pt-4">
              <div>
                <label className={label}>Clue Title</label>
                <input type="text" required value={clueForm.title} onChange={(e) => setClueForm({ ...clueForm, title: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label}>Clue Text (text only)</label>
                <textarea rows={4} required value={clueForm.content} onChange={(e) => setClueForm({ ...clueForm, content: e.target.value })} className={`${input} leading-relaxed`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={label}>Credit Cost</label>
                  <input type="number" min={0} value={clueForm.credit_cost} onChange={(e) => setClueForm({ ...clueForm, credit_cost: parseInt(e.target.value, 10) })} className={input} />
                </div>
                <div>
                  <label className={label}>Display Order</label>
                  <input type="number" min={1} value={clueForm.display_order} onChange={(e) => setClueForm({ ...clueForm, display_order: parseInt(e.target.value, 10) })} className={input} />
                </div>
              </div>

              {formError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /><span>{formError}</span>
                </div>
              )}

              <div className="pt-4 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button type="button" onClick={() => setClueModal({ open: false, caseId: null, editingId: null })} className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-5 py-2 text-xs font-heading font-bold uppercase text-white bg-[#FF8A24] hover:bg-[#F27D16] rounded-lg shadow-xs cursor-pointer">{isSubmitting ? 'Saving...' : 'Save Clue'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

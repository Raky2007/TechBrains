import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { Level1Question, ContentType, Level1AnswerChoice } from '@nexus/shared';
import { Plus, Trash2, Edit2, AlertCircle, Loader2, X, Clock } from 'lucide-react';

const ANSWER_LABELS: Record<Level1AnswerChoice, string> = {
  AI: 'AI Made',
  HUMAN: 'Human Made',
  CANT_DEFINE: "Can't Determine"
};

/**
 * Simplified TechBrains Round 1 question editor.
 *
 * The editor intentionally exposes only what a Round 1 question needs: the
 * content/media, the correct AI/Human answer, and the per-question timer.
 * The deprecated prompt / category / difficulty / explanation / status fields
 * are no longer shown (the columns remain in the database for compatibility).
 */
export const AdminQuestionsPage: React.FC = () => {
  const [questions, setQuestions] = useState<Level1Question[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Form state (simplified)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [contentType, setContentType] = useState<ContentType>('text');
  const [mediaPath, setMediaPath] = useState<string>('');
  const [correctAnswer, setCorrectAnswer] = useState<Level1AnswerChoice>('AI');
  const [timeLimit, setTimeLimit] = useState<number>(30);

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchQuestions = async () => {
    try {
      const res = await apiFetch<{ questions: Level1Question[] }>('/api/admin/questions');
      setQuestions(res.questions);
    } catch (err) {
      console.error('Failed to load questions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setContentType('text');
    setMediaPath('');
    setCorrectAnswer('AI');
    setTimeLimit(30);
    setFormError(null);
  };

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (q: Level1Question) => {
    setEditingId(q.id);
    setTitle(q.title);
    setContentType(q.content_type);
    setMediaPath(q.media_path || '');
    setCorrectAnswer(q.correct_answer);
    setTimeLimit(q.time_limit_seconds ?? 30);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setFormError(null);
    const formData = new FormData();
    formData.append('media', file);
    try {
      const res = await apiFetch<{ success: boolean; media_path: string }>('/api/admin/upload', {
        method: 'POST',
        body: formData
      });
      setMediaPath(res.media_path);
    } catch (err: any) {
      setFormError(err.message || 'File upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Only the fields a Round 1 question needs. is_active defaults to active.
    const payload = {
      title: title.trim(),
      content_type: contentType,
      media_path: mediaPath || null,
      correct_answer: correctAnswer,
      time_limit_seconds: timeLimit,
      is_active: 1
    };

    try {
      if (editingId) {
        await apiFetch(`/api/admin/questions/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/admin/questions', { method: 'POST', body: JSON.stringify(payload) });
      }
      setIsModalOpen(false);
      resetForm();
      await fetchQuestions();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save question.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete or archive this question?')) return;
    try {
      await apiFetch(`/api/admin/questions/${id}`, { method: 'DELETE' });
      await fetchQuestions();
    } catch (err: any) {
      alert(err.message || 'Delete operation failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">Round 1 · Questions</h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Each question holds its content/media, the correct answer, and its own timer.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-heading font-bold uppercase tracking-wider text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all shadow-xs self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#171717]" />
          <span>Add Question</span>
        </button>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Question</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Correct Answer</th>
                <th className="py-3 px-4 text-center">Time</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {questions.map((q, idx) => (
                <tr key={q.id} className={`transition-colors hover:bg-[#FFF0D6]/40 ${idx % 2 === 1 ? 'bg-[#F5F5F2]/40' : 'bg-[#FFFFFF]'}`}>
                  <td className="py-3 px-4 font-heading font-medium text-[#171717] max-w-md truncate">{q.title}</td>
                  <td className="py-3 px-4 font-mono uppercase text-[11px] text-[#737373]">{q.content_type}</td>
                  <td className="py-3 px-4 font-mono font-bold">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] border ${
                        q.correct_answer === 'AI'
                          ? 'bg-[#FFC928]/20 text-[#171717] border-[#FFC928]'
                          : q.correct_answer === 'HUMAN'
                          ? 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/30'
                          : 'bg-[#F5F5F2] text-[#737373] border-[#E5E5E5]'
                      }`}
                    >
                      {ANSWER_LABELS[q.correct_answer]}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-[#171717]">{q.time_limit_seconds ?? 30}s</td>
                  <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                    <button
                      onClick={() => openEditModal(q)}
                      title="Edit Question"
                      className="p-1.5 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#F5F5F2] transition-colors cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(q.id)}
                      title="Delete / Archive Question"
                      className="p-1.5 rounded-lg text-[#737373] hover:text-[#B42318] hover:bg-[#B42318]/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {questions.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs font-mono text-[#737373]">
                    No questions yet. Click “Add Question” to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-xl w-full my-8 shadow-xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-[#E5E5E5]">
              <h2 className="text-lg font-heading font-bold text-[#171717]">
                {editingId ? 'Edit Question' : 'Add Question'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-[#737373] hover:text-[#171717] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveQuestion} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Question
                </label>
                <textarea
                  rows={2}
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="The content to judge (or a short label for the media below)."
                  className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717] leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Content Type
                  </label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value as ContentType)}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717]"
                  >
                    <option value="text">Text Only</option>
                    <option value="image">Image File</option>
                    <option value="video">Video File</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Correct Answer
                  </label>
                  <select
                    value={correctAnswer}
                    onChange={(e) => setCorrectAnswer(e.target.value as Level1AnswerChoice)}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717] font-semibold"
                  >
                    <option value="AI">AI Made (+1)</option>
                    <option value="HUMAN">Human Made (+1)</option>
                    <option value="CANT_DEFINE">Can't Determine (0)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Question Time (seconds)
                </label>
                <input
                  type="number"
                  min={3}
                  max={600}
                  required
                  value={timeLimit}
                  onChange={(e) => setTimeLimit(parseInt(e.target.value, 10) || 0)}
                  className="w-full max-w-[160px] px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] font-mono text-sm focus:outline-none focus:border-[#171717]"
                />
                <p className="text-[11px] text-[#737373] mt-1">
                  The participant has this long to answer. Total Round 1 length is the sum of all question timers.
                </p>
              </div>

              {contentType !== 'text' && (
                <div className="space-y-2 p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5]">
                  <label className="block text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">
                    {contentType.toUpperCase()} Media File
                  </label>
                  <input
                    type="file"
                    accept={contentType === 'image' ? 'image/*' : 'video/*'}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                    className="block w-full text-xs text-[#737373] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#FFC928] file:text-[#171717] hover:file:bg-[#F5BE18] cursor-pointer"
                  />
                  {isUploading && (
                    <div className="flex items-center gap-2 text-xs font-mono text-[#18794E]">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading…</span>
                    </div>
                  )}
                  {mediaPath && <div className="text-xs font-mono text-[#18794E] truncate font-semibold">✓ {mediaPath}</div>}
                </div>
              )}

              {formError && (
                <div className="p-3 rounded-lg bg-[#B42318]/5 border border-[#B42318]/20 text-[#B42318] text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="pt-4 border-t border-[#E5E5E5] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-heading font-bold text-[#171717] bg-[#F5F5F2] hover:bg-[#E5E5E5] rounded-lg border border-[#E5E5E5] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-heading font-bold uppercase text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] rounded-lg shadow-xs cursor-pointer"
                >
                  Save Question
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { Level1Question, ContentType, Level1AnswerChoice } from '@nexus/shared';
import {
  Plus,
  Trash2,
  Eye,
  Edit2,
  AlertCircle,
  Loader2,
  X
} from 'lucide-react';

export const AdminQuestionsPage: React.FC = () => {
  const [questions, setQuestions] = useState<Level1Question[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [previewQuestion, setPreviewQuestion] = useState<Level1Question | null>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [contentType, setContentType] = useState<ContentType>('text');
  const [mediaPath, setMediaPath] = useState<string>('');
  const [correctAnswer, setCorrectAnswer] = useState<Level1AnswerChoice>('AI');
  const [explanation, setExplanation] = useState<string>('');
  const [category, setCategory] = useState<string>('Synthetic Media');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [isActive, setIsActive] = useState<number>(1);

  // Upload state
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
    setPrompt('');
    setContentType('text');
    setMediaPath('');
    setCorrectAnswer('AI');
    setExplanation('');
    setCategory('Synthetic Media');
    setDifficulty('medium');
    setIsActive(1);
    setFormError(null);
  };

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (q: Level1Question) => {
    setEditingId(q.id);
    setTitle(q.title);
    setPrompt(q.prompt);
    setContentType(q.content_type);
    setMediaPath(q.media_path || '');
    setCorrectAnswer(q.correct_answer);
    setExplanation(q.explanation || '');
    setCategory(q.category || '');
    setDifficulty(q.difficulty || 'medium');
    setIsActive(q.is_active);
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

    const payload = {
      title: title.trim(),
      prompt: prompt.trim(),
      content_type: contentType,
      media_path: mediaPath || null,
      correct_answer: correctAnswer,
      explanation: explanation.trim() || null,
      category: category.trim() || null,
      difficulty,
      is_active: isActive
    };

    try {
      if (editingId) {
        await apiFetch(`/api/admin/questions/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await apiFetch('/api/admin/questions', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
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
      {/* Top Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">
            Level 1 Questions Pool
          </h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Manage forensic discrimination artifacts for Level 1 rounds.
          </p>
        </div>

        {/* Primary CTA: #FFC928 */}
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-heading font-bold uppercase tracking-wider text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all shadow-xs self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#171717]" />
          <span>UPLOAD QUESTION</span>
        </button>
      </div>

      {/* Questions Table */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Correct Answer</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Difficulty</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {questions.map((q, idx) => {
                const isEven = idx % 2 === 1;
                return (
                  <tr key={q.id} className={`transition-colors hover:bg-[#FFF0D6]/40 ${isEven ? 'bg-[#F5F5F2]/40' : 'bg-[#FFFFFF]'}`}>
                    <td className="py-3 px-4 font-heading font-medium text-[#171717] max-w-xs truncate">
                      {q.title}
                    </td>
                    <td className="py-3 px-4 font-mono uppercase text-[11px] text-[#737373]">
                      {q.content_type}
                    </td>
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
                        {q.correct_answer}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[#737373] font-mono text-[11px]">
                      {q.category || '—'}
                    </td>
                    <td className="py-3 px-4 font-mono uppercase text-[10px] text-[#737373]">
                      {q.difficulty || 'medium'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border ${
                          q.is_active
                            ? 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/20'
                            : 'bg-[#F5F5F2] text-[#737373] border-[#E5E5E5]'
                        }`}
                      >
                        {q.is_active ? 'ACTIVE' : 'ARCHIVED'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                      <button
                        onClick={() => setPreviewQuestion(q)}
                        title="Preview Question"
                        className="p-1.5 rounded-lg text-[#737373] hover:text-[#171717] hover:bg-[#F5F5F2] transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload / Edit Question Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-2xl w-full my-8 shadow-xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-[#E5E5E5]">
              <h2 className="text-lg font-heading font-bold text-[#171717]">
                {editingId ? 'Edit Level 1 Question' : 'Upload Level 1 Question'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-[#737373] hover:text-[#171717] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveQuestion} className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Question Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Subject Sigma: Neural Portrait Synthesis"
                  className="w-full px-3.5 py-2.5 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717]"
                />
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Prompt & Instructions
                </label>
                <textarea
                  rows={3}
                  required
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Analyze the artifact below. Examine edge artifacts, specular reflections, and chromatic markers."
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
                    Correct Authoritative Answer
                  </label>
                  <select
                    value={correctAnswer}
                    onChange={(e) => setCorrectAnswer(e.target.value as Level1AnswerChoice)}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717] font-semibold"
                  >
                    <option value="AI">AI Made (+1 pt)</option>
                    <option value="HUMAN">Human Made (+1 pt)</option>
                    <option value="CANT_DEFINE">Can't Define (0 pts)</option>
                  </select>
                </div>
              </div>

              {/* Media File Upload */}
              {contentType !== 'text' && (
                <div className="space-y-2 p-4 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5]">
                  <label className="block text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">
                    Select {contentType.toUpperCase()} Media File (JPG, PNG, WEBP, MP4, WEBM)
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
                      <span>Validating MIME signature and uploading...</span>
                    </div>
                  )}
                  {mediaPath && (
                    <div className="text-xs font-mono text-[#18794E] truncate font-semibold">
                      ✓ Uploaded: {mediaPath}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                  Explanation & Forensic Markers (Revealed after submission)
                </label>
                <textarea
                  rows={2}
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder="Explain why this artifact is synthetic or authentic."
                  className="w-full p-3 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs focus:outline-none focus:border-[#171717] leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Difficulty
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as any)}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-[#171717] mb-1">
                    Status
                  </label>
                  <select
                    value={isActive}
                    onChange={(e) => setIsActive(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl text-[#171717] text-xs"
                  >
                    <option value={1}>Active Pool</option>
                    <option value={0}>Archived</option>
                  </select>
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

      {/* Preview Modal */}
      {previewQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 sm:p-8 max-w-lg w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E5E5E5]">
              <span className="text-xs font-mono text-[#18794E] font-bold">QUESTION PREVIEW</span>
              <button onClick={() => setPreviewQuestion(null)} className="text-[#737373] hover:text-[#171717] cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <h3 className="text-lg font-heading font-bold text-[#171717]">{previewQuestion.title}</h3>
            <p className="text-xs text-[#737373] leading-relaxed whitespace-pre-wrap">{previewQuestion.prompt}</p>
            {previewQuestion.media_path && (
              <div className="rounded-xl overflow-hidden border border-[#E5E5E5] bg-[#F5F5F2] p-1">
                <img src={previewQuestion.media_path} alt={previewQuestion.title} className="max-h-64 w-full object-contain rounded" />
              </div>
            )}
            <div className="p-3.5 rounded-lg bg-[#F5F5F2] border border-[#E5E5E5] space-y-1 text-xs font-mono">
              <div>Correct Answer: <strong className="text-[#171717]">{previewQuestion.correct_answer}</strong></div>
              {previewQuestion.explanation && (
                <div className="text-[#737373] font-body text-xs pt-1">{previewQuestion.explanation}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

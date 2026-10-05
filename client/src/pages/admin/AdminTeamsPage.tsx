import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { Trash2 } from 'lucide-react';

export const AdminTeamsPage: React.FC = () => {
  const [teams, setTeams] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchTeams = async () => {
    try {
      const res = await apiFetch<{ teams: any[] }>('/api/admin/teams');
      setTeams(res.teams);
    } catch (err) {
      console.error('Failed to load teams:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();

    const socket = getSocket();
    const handleUpdate = () => fetchTeams();
    socket.on('team:registered', handleUpdate);
    socket.on('team:score_updated', handleUpdate);
    socket.on('team:credits_updated', handleUpdate);

    return () => {
      socket.off('team:registered', handleUpdate);
      socket.off('team:score_updated', handleUpdate);
      socket.off('team:credits_updated', handleUpdate);
    };
  }, []);

  const handleDeleteTeam = async (teamId: string, teamName: string) => {
    if (!window.confirm(`Are you sure you want to remove team "${teamName}"?`)) return;
    try {
      await apiFetch(`/api/admin/teams/${teamId}`, { method: 'DELETE' });
      await fetchTeams();
    } catch (err: any) {
      alert(err.message || 'Failed to remove team.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">
            Registered Participant Teams
          </h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Active teams connected over the local area network.
          </p>
        </div>
        <div className="px-3.5 py-1.5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] font-mono text-xs text-[#171717]">
          Total Registered: <strong className="text-[#18794E]">{teams.length}</strong>
        </div>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Team Designation</th>
                <th className="py-3 px-4 text-center">Level 1 Score</th>
                <th className="py-3 px-4 text-center">Level 2 Score</th>
                <th className="py-3 px-4 text-center">Current Credits</th>
                <th className="py-3 px-4 text-center">Clues Unlocked</th>
                <th className="py-3 px-4 text-center">Conclusion</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5] font-mono">
              {teams.map((t, idx) => {
                const isEven = idx % 2 === 1;
                return (
                  <tr key={t.id} className={`transition-colors hover:bg-[#FFF0D6]/40 ${isEven ? 'bg-[#F5F5F2]/40' : 'bg-[#FFFFFF]'}`}>
                    <td className="py-3 px-4 font-heading font-bold text-[#171717] text-sm">
                      {t.team_name}
                    </td>
                    <td className="py-3 px-4 text-center text-[#171717] font-bold">
                      {t.level1_score} pts
                    </td>
                    <td className="py-3 px-4 text-center text-[#171717] font-bold">
                      {t.level2_score} pts
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400]">
                        {t.current_credits} CR
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center text-[#737373]">
                      {t.clues_unlocked_count || 0}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          t.conclusion_status === 'submitted'
                            ? 'bg-[#18794E]/10 border-[#18794E]/20 text-[#18794E]'
                            : 'bg-[#F5F5F2] border-[#E5E5E5] text-[#737373]'
                        }`}
                      >
                        {t.conclusion_status ? t.conclusion_status.toUpperCase() : 'PENDING'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDeleteTeam(t.id, t.team_name)}
                        title="Remove team"
                        className="p-1.5 rounded-lg text-[#737373] hover:text-[#B42318] hover:bg-[#B42318]/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {teams.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#737373]">
                    No teams have joined this game session yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

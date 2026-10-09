import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { Trash2, Ban, RotateCcw, X, ShieldAlert } from 'lucide-react';
import { AdminTeamListItem, TeamPresencePayload } from '@nexus/shared';

export const AdminTeamsPage: React.FC = () => {
  const [teams, setTeams] = useState<AdminTeamListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [banningTeam, setBanningTeam] = useState<AdminTeamListItem | null>(null);
  const [banReason, setBanReason] = useState<string>('');
  const [isSubmittingBan, setIsSubmittingBan] = useState<boolean>(false);

  const fetchTeams = async () => {
    try {
      const res = await apiFetch<{ teams: AdminTeamListItem[] }>('/api/admin/teams');
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
    const handlePresence = (presence: TeamPresencePayload) => {
      setTeams((prev) =>
        prev.map((t) =>
          t.id === presence.team_id
            ? {
                ...t,
                is_connected: presence.is_connected,
                ip_address: presence.ip_address,
                ip_addresses: presence.ip_addresses,
                connections_count: presence.connections_count,
                last_connected_at: presence.last_connected_at
              }
            : t
        )
      );
    };

    socket.on('team:registered', handleUpdate);
    socket.on('team:score_updated', handleUpdate);
    socket.on('team:credits_updated', handleUpdate);
    socket.on('admin:team_presence', handlePresence);

    return () => {
      socket.off('team:registered', handleUpdate);
      socket.off('team:score_updated', handleUpdate);
      socket.off('team:credits_updated', handleUpdate);
      socket.off('admin:team_presence', handlePresence);
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

  const handleConfirmBan = async () => {
    if (!banningTeam) return;
    setIsSubmittingBan(true);
    try {
      await apiFetch(`/api/admin/teams/${banningTeam.id}/ban`, {
        method: 'POST',
        body: JSON.stringify({ reason: banReason.trim() || undefined })
      });
      setBanningTeam(null);
      await fetchTeams();
    } catch (err: any) {
      alert(err.message || 'Failed to ban team.');
    } finally {
      setIsSubmittingBan(false);
    }
  };

  const handleUnbanTeam = async (teamId: string, teamName: string) => {
    if (!window.confirm(`Are you sure you want to unban team "${teamName}"? This will restore their login eligibility.`)) return;
    try {
      await apiFetch(`/api/admin/teams/${teamId}/unban`, { method: 'POST' });
      await fetchTeams();
    } catch (err: any) {
      alert(err.message || 'Failed to unban team.');
    }
  };

  const onlineCount = teams.filter((t) => t.is_connected && !t.is_banned).length;
  const bannedCount = teams.filter((t) => t.is_banned).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">
            Registered Participant Teams
          </h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Active teams and network terminal connections over LAN.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {bannedCount > 0 && (
            <div className="px-3.5 py-1.5 rounded-xl bg-[#B42318]/10 border border-[#B42318]/30 font-mono text-xs text-[#B42318]">
              Disqualified: <strong>{bannedCount}</strong>
            </div>
          )}
          <div className="px-3.5 py-1.5 rounded-xl bg-[#F5F5F2] border border-[#E5E5E5] font-mono text-xs text-[#171717]">
            Online: <strong className="text-[#18794E]">{onlineCount}</strong> / {teams.length}
          </div>
        </div>
      </div>

      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-body">
            <thead className="bg-[#F5F5F2] text-[#737373] font-mono text-[11px] uppercase tracking-wider border-b border-[#E5E5E5]">
              <tr>
                <th className="py-3 px-4">Team Designation</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Client IP</th>
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
                    <td className="py-3 px-4 text-center">
                      {t.is_banned ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#B42318]/10 border border-[#B42318]/30 text-[#B42318]">
                            <Ban className="w-3 h-3" />
                            <span>BANNED</span>
                          </span>
                          {t.ban_reason && (
                            <span className="text-[10px] text-[#737373] max-w-[140px] truncate" title={t.ban_reason}>
                              {t.ban_reason}
                            </span>
                          )}
                        </div>
                      ) : t.is_connected ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#18794E]/10 border border-[#18794E]/30 text-[#18794E]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#18794E] animate-pulse" />
                          <span>ONLINE</span>
                          {(t.connections_count ?? 0) > 1 && (
                            <span className="text-[9px] opacity-75 font-normal">({t.connections_count} tabs)</span>
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F5F5F2] border border-[#E5E5E5] text-[#737373]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#A3A3A3]" />
                          <span>OFFLINE</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {t.ip_address ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-[#F5F5F2] border border-[#E5E5E5] text-[11px] text-[#171717] font-semibold">
                          {t.ip_address}
                        </span>
                      ) : (
                        <span className="text-[#A3A3A3] text-xs">—</span>
                      )}
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
                      <div className="flex items-center justify-end gap-1.5">
                        {t.is_banned ? (
                          <button
                            onClick={() => handleUnbanTeam(t.id, t.team_name)}
                            title="Unban team"
                            className="p-1.5 rounded-lg text-[#18794E] hover:text-[#0E5B35] hover:bg-[#18794E]/10 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setBanningTeam(t);
                              setBanReason('');
                            }}
                            title="Disqualify / Ban team"
                            className="p-1.5 rounded-lg text-[#B42318] hover:text-[#7A1610] hover:bg-[#B42318]/10 transition-colors cursor-pointer"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteTeam(t.id, t.team_name)}
                          title="Remove team"
                          className="p-1.5 rounded-lg text-[#737373] hover:text-[#B42318] hover:bg-[#B42318]/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {teams.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[#737373]">
                    No teams have joined this game session yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal for Banning a Team */}
      {banningTeam && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#B42318] font-bold font-heading">
                <ShieldAlert className="w-5 h-5" />
                <span>Disqualify Team</span>
              </div>
              <button
                onClick={() => setBanningTeam(null)}
                className="text-[#737373] hover:text-[#171717] p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[#737373]">
              Are you sure you want to ban team <strong className="text-[#171717]">{banningTeam.team_name}</strong>?
              This will immediately terminate their active session, disconnect all open terminals, and block all further game activity.
            </p>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono text-[#737373] uppercase tracking-wider">
                Reason (Optional, max 300 characters)
              </label>
              <textarea
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                maxLength={300}
                rows={3}
                placeholder="e.g. Unauthorized secondary device detected, collusion"
                className="w-full text-xs p-2.5 rounded-xl border border-[#E5E5E5] focus:outline-none focus:border-[#B42318] font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setBanningTeam(null)}
                disabled={isSubmittingBan}
                className="px-4 py-2 rounded-xl border border-[#E5E5E5] text-xs font-mono text-[#737373] hover:bg-[#F5F5F2]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBan}
                disabled={isSubmittingBan}
                className="px-4 py-2 rounded-xl bg-[#B42318] hover:bg-[#7A1610] text-xs font-mono text-white font-bold disabled:opacity-50"
              >
                {isSubmittingBan ? 'Disqualifying...' : 'Confirm Disqualification'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

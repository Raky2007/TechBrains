import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import {
  Users,
  Radio,
  HelpCircle,
  FolderSearch,
  FileCheck2,
  ArrowRight,
  Activity
} from 'lucide-react';

export const AdminOverviewPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchOverview = async () => {
    try {
      const res = await apiFetch('/api/admin/overview');
      setData(res);
    } catch (err) {
      console.error('Failed to load admin overview:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();

    const socket = getSocket();
    const handleUpdate = () => fetchOverview();

    socket.on('game:state_changed', handleUpdate);
    socket.on('team:registered', handleUpdate);
    socket.on('submission:created', handleUpdate);

    return () => {
      socket.off('game:state_changed', handleUpdate);
      socket.off('team:registered', handleUpdate);
      socket.off('submission:created', handleUpdate);
    };
  }, []);

  if (isLoading || !data) {
    return (
      <div className="font-mono text-sm text-[#737373] flex items-center justify-center min-h-[50vh]">
        Loading tournament operations overview...
      </div>
    );
  }

  const { stats, session, active_round, recent_events } = data;

  const statCards = [
    {
      title: 'Registered Teams',
      value: stats.registered_teams,
      subtitle: 'Accessible over LAN',
      icon: Users,
      badge: 'bg-[#F5F5F2] text-[#171717] border-[#E5E5E5]',
      link: '/admin/teams'
    },
    {
      title: 'Game Status',
      value: session.status.toUpperCase(),
      subtitle: active_round ? `Level ${active_round.level} active` : 'Ready to start',
      icon: Radio,
      badge: 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/30',
      link: '/admin/control'
    },
    {
      title: 'Level 1 Questions',
      value: stats.level1_questions,
      subtitle: 'Active question pool',
      icon: HelpCircle,
      badge: 'bg-[#FFC928]/20 text-[#171717] border-[#FFC928]',
      link: '/admin/questions'
    },
    {
      title: 'Level 2 Clues',
      value: stats.level2_clues,
      subtitle: 'Forensic vault items',
      icon: FolderSearch,
      badge: 'bg-[#FFF0D6] text-[#B34400] border-[#FED7AA]',
      link: '/admin/cases'
    },
    {
      title: 'Pending Evaluations',
      value: stats.pending_evaluations,
      subtitle: 'Submissions in queue',
      icon: FileCheck2,
      badge: stats.pending_evaluations > 0 ? 'bg-[#B42318]/10 text-[#B42318] border-[#B42318]/30' : 'bg-[#18794E]/10 text-[#18794E] border-[#18794E]/30',
      link: '/admin/submissions'
    }
  ];

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-[#171717]">
            Operations Overview
          </h1>
          <p className="text-xs text-[#737373] font-mono mt-0.5">
            Authoritative session: {session.id}
          </p>
        </div>
        <Link
          to="/admin/control"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-heading font-bold uppercase tracking-wider text-[#171717] bg-[#FFC928] hover:bg-[#F5BE18] active:bg-[#E0AD0E] transition-all shadow-xs self-start sm:self-auto cursor-pointer"
        >
          <span>Live Game Control</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Metrics Grid: Cards #FFFFFF with #E5E5E5 border */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Link
              key={i}
              to={stat.link}
              className="bg-[#FFFFFF] border border-[#E5E5E5] hover:border-[#171717] rounded-xl p-5 space-y-3 transition-colors block group shadow-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-heading font-bold text-[#737373] uppercase tracking-wider">
                  {stat.title}
                </span>
                <div className={`p-2 rounded-lg border ${stat.badge}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div>
                <div className="text-2xl font-heading font-bold text-[#171717]">
                  {stat.value}
                </div>
                <div className="text-[11px] text-[#737373] font-mono mt-0.5">
                  {stat.subtitle}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Recent Game Events & Audit Logs */}
      <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-xs">
        <div className="p-4 border-b border-[#E5E5E5] flex items-center justify-between bg-[#F5F5F2]">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#18794E]" />
            <h2 className="text-xs font-heading font-bold text-[#171717] uppercase tracking-wider">
              Recent Game Events & Audit Logs
            </h2>
          </div>
          <span className="text-xs font-mono text-[#737373]">
            {recent_events?.length || 0} Events Logged
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#F5F5F2] text-[#737373] text-[11px] uppercase border-b border-[#E5E5E5]">
              <tr>
                <th className="py-2.5 px-4">Timestamp (UTC)</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Entity</th>
                <th className="py-2.5 px-4">Entity ID</th>
                <th className="py-2.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {recent_events && recent_events.length > 0 ? (
                recent_events.map((evt: any, idx: number) => {
                  const isEven = idx % 2 === 1;
                  return (
                    <tr key={evt.id} className={`transition-colors hover:bg-[#FFF0D6]/40 ${isEven ? 'bg-[#F5F5F2]/50' : 'bg-[#FFFFFF]'}`}>
                      <td className="py-2.5 px-4 text-[#737373]">
                        {new Date(evt.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-[#171717]">
                        {evt.action}
                      </td>
                      <td className="py-2.5 px-4 text-[#737373]">
                        {evt.entity_type}
                      </td>
                      <td className="py-2.5 px-4 text-[#737373] text-[11px]">
                        {evt.entity_id ? evt.entity_id.slice(0, 8) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-[#737373] max-w-xs truncate" title={evt.details_json}>
                        {evt.details_json || '—'}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#737373]">
                    No recent events logged yet.
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

import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { BRANDING } from '@nexus/shared';
import { apiFetch, getStoredAdminToken, removeStoredAdminToken } from '../lib/api';
import { ConnectionBadge } from '../components/ConnectionBadge';
import {
  LayoutDashboard,
  HelpCircle,
  FolderSearch,
  Users,
  Radio,
  FileCheck2,
  Trophy,
  Settings,
  Database,
  LogOut,
  Shield,
  Menu,
  X
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [adminUser, setAdminUser] = useState<{ id: string; username: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const token = getStoredAdminToken();
    if (!token) {
      navigate('/admin/login');
      return;
    }

    apiFetch<{ admin: { id: string; username: string } }>('/api/auth/admin/me')
      .then((res) => {
        setAdminUser(res.admin);
      })
      .catch(() => {
        removeStoredAdminToken();
        navigate('/admin/login');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/admin/logout', { method: 'POST' });
    } catch (e) {}
    removeStoredAdminToken();
    navigate('/admin/login');
  };

  // Primary structure is organised around the two rounds (Questions + Settings
  // each), with event-wide monitoring/controls kept in their own section.
  const navSections: {
    heading: string;
    items: { label: string; to: string; icon: typeof LayoutDashboard; end?: boolean }[];
  }[] = [
    {
      heading: 'Round 1',
      items: [
        { label: 'Questions', to: '/admin/questions', icon: HelpCircle },
        { label: 'Settings', to: '/admin/round1', icon: Settings },
      ],
    },
    {
      heading: 'Round 2',
      items: [
        { label: 'Questions', to: '/admin/cases', icon: FolderSearch },
        { label: 'Settings', to: '/admin/round2', icon: Settings },
      ],
    },
    {
      heading: 'Event',
      items: [
        { label: 'Overview', to: '/admin', icon: LayoutDashboard, end: true },
        { label: 'Live Game Control', to: '/admin/control', icon: Radio },
        { label: 'Registered Teams', to: '/admin/teams', icon: Users },
        { label: 'Submissions', to: '/admin/submissions', icon: FileCheck2 },
        { label: 'Leaderboard', to: '/admin/leaderboard', icon: Trophy },
        { label: 'System & Backup', to: '/admin/settings', icon: Database },
      ],
    },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex items-center justify-center font-mono text-sm text-[#737373]">
        Authorizing Administrator Session...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#171717] flex flex-col md:flex-row">
      {/* Mobile Top Header */}
      <header className="md:hidden flex items-center justify-between p-4 bg-[#F5F5F2] border-b border-[#E5E5E5]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#FFC928] text-[#171717] flex items-center justify-center font-bold font-mono text-xs">
            T
          </div>
          <span className="font-heading font-bold text-sm tracking-tight text-[#171717]">{BRANDING.shortTitle} ADMIN</span>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge />
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1.5 rounded-lg bg-[#FFFFFF] border border-[#E5E5E5] text-[#171717]"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Sidebar Navigation: Alternate section #F5F5F2 with #E5E5E5 border */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-[#F5F5F2] border-r border-[#E5E5E5] flex flex-col transition-transform duration-200 shrink-0 ${
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Brand header */}
        <div className="p-6 border-b border-[#E5E5E5] hidden md:flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#FFC928] text-[#171717] flex items-center justify-center shadow-xs">
              <Shield className="w-5 h-5 text-[#171717]" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-base tracking-tight text-[#171717] leading-none">
                {BRANDING.shortTitle}
              </h1>
              <span className="text-[10px] font-mono text-[#18794E] font-bold uppercase tracking-wider block mt-1">
                ● ADMIN CONTROL
              </span>
            </div>
          </div>
        </div>

        {/* Navigation list: grouped by Round 1 / Round 2 / Event */}
        <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          {navSections.map((section) => (
            <div key={section.heading} className="space-y-1.5">
              <span className="px-3.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#A3A3A3] block">
                {section.heading}
              </span>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all ${
                        isActive
                          ? 'bg-[#FFC928] text-[#171717] font-bold shadow-xs'
                          : 'text-[#737373] hover:text-[#171717] hover:bg-[#E5E5E5]/60 font-medium'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer info & logout */}
        <div className="p-4 border-t border-[#E5E5E5] space-y-3 bg-[#F5F5F2]">
          <div className="hidden md:block">
            <ConnectionBadge />
          </div>
          <div className="flex items-center justify-between pt-1 text-xs">
            <div className="font-mono text-[#737373] truncate">
              User: <span className="text-[#171717] font-bold">{adminUser?.username || 'admin'}</span>
            </div>
            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-1.5 rounded-lg hover:bg-[#B42318]/10 text-[#737373] hover:text-[#B42318] transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-[#FFFFFF] p-4 sm:p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

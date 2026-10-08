import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { BRANDING } from '@nexus/shared';
import { ConnectionBadge } from './ConnectionBadge';
import { Coins, LogOut } from 'lucide-react';
import { removeStoredTeamToken } from '../lib/api';

interface NavbarProps {
  team?: {
    id: string;
    team_name: string;
    current_credits: number;
    level1_score: number;
    level2_score: number;
  } | null;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ team, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLeaveTeam = () => {
    removeStoredTeamToken();
    if (onLogout) onLogout();
    navigate('/');
  };

  const navLinks = [
    { label: 'Waiting Room', path: '/waiting' },
    { label: 'Round 1', path: '/level1' },
    { label: 'Round 2', path: '/level2' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#FFFFFF] border-b border-[#E5E5E5] px-4 lg:px-8 py-3.5 shadow-xs">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand identity */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-[#FFC928] text-[#171717] flex items-center justify-center font-heading font-black text-sm shadow-xs">
              T
            </div>
            <div>
              <span className="font-heading font-bold text-base tracking-tight text-[#171717]">
                {BRANDING.shortTitle}
              </span>
              <span className="hidden sm:inline-block text-[11px] font-mono text-[#737373] ml-2 border-l border-[#E5E5E5] pl-2 font-medium">
                Department of CSE · DAC
              </span>
            </div>
          </Link>

          {/* Active Navigation: Black text with yellow indicator */}
          {team && (
            <nav className="hidden lg:flex items-center gap-6 ml-4">
              {navLinks.map((link) => {
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`text-xs font-heading font-semibold transition-all relative py-1 ${
                      isActive
                        ? 'text-[#171717] after:content-[""] after:absolute after:bottom-[-8px] after:left-0 after:right-0 after:h-[2.5px] after:bg-[#FFC928] after:rounded-full'
                        : 'text-[#737373] hover:text-[#171717]'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Status & Team context */}
        <div className="flex items-center gap-3 sm:gap-4">
          <ConnectionBadge />

          {team && (
            <div className="flex items-center gap-2.5 sm:gap-3.5 pl-3 border-l border-[#E5E5E5]">
              {/* Credit Balance Badge: #FFF0D6 with dark orange text #B34400 */}
              <div
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#FFF0D6] border border-[#FED7AA] text-[#B34400] font-mono text-xs font-bold shadow-2xs"
                title="Allocated Investigation Credits"
              >
                <Coins className="w-3.5 h-3.5 text-[#B34400]" />
                <span>{team.current_credits}</span>
                <span className="text-[10px] uppercase font-semibold">CR</span>
              </div>

              {/* Team Name Badge */}
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#F5F5F2] border border-[#E5E5E5] text-xs font-medium text-[#171717]">
                <span className="text-[#737373]">Team:</span>
                <span className="font-bold text-[#171717]">{team.team_name}</span>
              </div>

              {/* Leave / Exit */}
              <button
                onClick={handleLeaveTeam}
                title="Exit Team Session"
                className="p-1.5 rounded-md text-[#737373] hover:text-[#B42318] hover:bg-[#F5F5F2] transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

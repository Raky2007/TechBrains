import React, { useEffect, useState, createContext, useContext } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { apiFetch, getStoredTeamToken, removeStoredTeamToken } from '../lib/api';
import { getSocket, refreshSocketAuth } from '../lib/socket';
import { PublicGameState, Team } from '@nexus/shared';
import { Loader2 } from 'lucide-react';

interface TeamContextType {
  team: Team | null;
  gameState: PublicGameState | null;
  refreshTeam: () => Promise<void>;
  refreshGameState: () => Promise<PublicGameState | null>;
}

const TeamContext = createContext<TeamContextType>({
  team: null,
  gameState: null,
  refreshTeam: async () => {},
  refreshGameState: async () => null
});

export const useTeam = () => useContext(TeamContext);

export const TeamLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [team, setTeam] = useState<Team | null>(null);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchTeamProfile = async () => {
    try {
      const res = await apiFetch<{ team: Team }>('/api/auth/me');
      setTeam(res.team);
    } catch (err) {
      removeStoredTeamToken();
      navigate('/');
    }
  };

  const fetchGameState = async () => {
    try {
      const state = await apiFetch<PublicGameState>('/api/game/state');
      setGameState(state);
      return state;
    } catch (err) {
      console.error('Failed to fetch game state:', err);
      return null;
    }
  };

  useEffect(() => {
    const token = getStoredTeamToken();
    if (!token) {
      navigate('/');
      return;
    }

    Promise.all([fetchTeamProfile(), fetchGameState()]).finally(() => {
      setIsLoading(false);
    });

    refreshSocketAuth();
    const socket = getSocket();

    const handleStateChange = (state: PublicGameState) => {
      setGameState(state);

      // Authoritative state-based navigation
      if (state.status === 'level1_active' && location.pathname === '/waiting') {
        navigate('/level1');
      } else if (state.status === 'level2_active' && (location.pathname === '/waiting' || location.pathname === '/level1')) {
        navigate('/level2');
      } else if (state.status === 'completed' || state.settings?.resultsPublished) {
        if (location.pathname !== '/leaderboard') {
          // If results published, show leaderboard
          navigate('/leaderboard');
        }
      }
    };

    socket.on('game:state_changed', handleStateChange);
    socket.on('round:started', () => {
      fetchGameState().then((state) => {
        if (state?.current_level === 1) navigate('/level1');
        if (state?.current_level === 2) navigate('/level2');
      });
    });

    return () => {
      socket.off('game:state_changed', handleStateChange);
    };
  }, [location.pathname, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bgMain flex flex-col items-center justify-center text-textSecondary gap-4 font-mono">
        <Loader2 className="w-8 h-8 animate-spin text-primaryYellow" />
        <span className="text-sm tracking-widest uppercase">Synchronizing with authoritative LAN host...</span>
      </div>
    );
  }

  return (
    <TeamContext.Provider value={{ team, gameState, refreshTeam: fetchTeamProfile, refreshGameState: fetchGameState }}>
      <div className="min-h-screen bg-bgMain flex flex-col">
        <Navbar team={team} onLogout={() => setTeam(null)} />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </TeamContext.Provider>
  );
};

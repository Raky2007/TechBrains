import React, { useEffect, useState, useRef, createContext, useContext, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { apiFetch, getStoredTeamToken, removeStoredTeamToken } from '../lib/api';
import { getSocket, refreshSocketAuth } from '../lib/socket';
import { PublicGameState, Team, TeamPrivateState, TeamStage } from '@nexus/shared';
import { Loader2 } from 'lucide-react';

interface TeamContextType {
  team: Team | null;
  gameState: PublicGameState | null;
  stage: TeamStage | null;
  refreshTeam: () => Promise<void>;
  refreshGameState: () => Promise<PublicGameState | null>;
}

const TeamContext = createContext<TeamContextType>({
  team: null,
  gameState: null,
  stage: null,
  refreshTeam: async () => {},
  refreshGameState: async () => null
});

export const useTeam = () => useContext(TeamContext);

/** Map THIS team's server-authoritative stage to its route. */
function pathForStage(stage: TeamStage): string {
  switch (stage) {
    case 'waiting':
      return '/waiting';
    case 'round1':
    case 'round1_done':
      return '/level1';
    case 'round2':
    case 'not_qualified':
      return '/level2';
    case 'result':
      return '/result';
    default:
      return '/waiting';
  }
}

export const TeamLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [team, setTeam] = useState<Team | null>(null);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [stage, setStage] = useState<TeamStage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Keep the latest path in a ref so socket handlers (registered once) always
  // see the current route without re-subscribing.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const teamIdRef = useRef<string | null>(null);

  const fetchTeamProfile = useCallback(async () => {
    try {
      const res = await apiFetch<{ team: Team }>('/api/auth/me');
      setTeam(res.team);
      teamIdRef.current = res.team.id;
    } catch (err) {
      removeStoredTeamToken();
      navigate('/');
    }
  }, [navigate]);

  const fetchGameState = useCallback(async () => {
    try {
      const state = await apiFetch<PublicGameState>('/api/game/state');
      setGameState(state);
      return state;
    } catch (err) {
      console.error('Failed to fetch game state:', err);
      return null;
    }
  }, []);

  /**
   * Fetch THIS team's own authoritative state and navigate strictly by its own
   * stage. A team's route is never decided by global status or by any other
   * team — only by the server's team-specific `stage`. Global socket events
   * merely trigger this re-fetch.
   */
  const syncTeamStage = useCallback(async () => {
    try {
      const res = await apiFetch<TeamPrivateState>('/api/game/team-state');
      setStage(res.stage);
      if (res.team?.id) {
        setTeam((prev) =>
          prev
            ? { ...prev, current_credits: res.team.current_credits, level1_score: res.team.level1_score, level2_score: res.team.level2_score }
            : prev
        );
      }
      const target = pathForStage(res.stage);
      if (pathRef.current !== target) navigate(target);
      return res.stage;
    } catch (err) {
      console.error('Failed to sync team stage:', err);
      return null;
    }
  }, [navigate]);

  useEffect(() => {
    const token = getStoredTeamToken();
    if (!token) {
      navigate('/');
      return;
    }

    Promise.all([fetchTeamProfile(), fetchGameState(), syncTeamStage()]).finally(() => {
      setIsLoading(false);
    });

    refreshSocketAuth();
    const socket = getSocket();

    // Every GLOBAL event is only a trigger to re-evaluate THIS team's own
    // server-authoritative stage. We never navigate directly off global status.
    const onGlobalChange = (state?: PublicGameState) => {
      if (state) setGameState(state);
      else fetchGameState();
      syncTeamStage();
    };

    // team:private_updated is room-scoped to this team; defense-in-depth: ignore
    // any payload that is not for the authenticated team.
    const onPrivateUpdate = (payload: TeamPrivateState) => {
      if (payload?.team?.id && teamIdRef.current && payload.team.id !== teamIdRef.current) return;
      if (payload?.stage) {
        setStage(payload.stage);
        const target = pathForStage(payload.stage);
        if (pathRef.current !== target) navigate(target);
      } else {
        syncTeamStage();
      }
    };

    socket.on('game:state_changed', onGlobalChange);
    socket.on('round:started', () => onGlobalChange());
    socket.on('round:paused', () => onGlobalChange());
    socket.on('round:resumed', () => onGlobalChange());
    socket.on('round:ended', () => onGlobalChange());
    socket.on('results:published', () => onGlobalChange());
    socket.on('team:private_updated', onPrivateUpdate);

    return () => {
      socket.off('game:state_changed', onGlobalChange);
      socket.off('round:started');
      socket.off('round:paused');
      socket.off('round:resumed');
      socket.off('round:ended');
      socket.off('results:published', onGlobalChange);
      socket.off('team:private_updated', onPrivateUpdate);
    };
    // Registered once for the lifetime of the layout; handlers use refs for path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bgMain flex flex-col items-center justify-center text-textSecondary gap-4 font-mono">
        <Loader2 className="w-8 h-8 animate-spin text-primaryYellow" />
        <span className="text-sm tracking-widest uppercase">Synchronizing with authoritative LAN host...</span>
      </div>
    );
  }

  return (
    <TeamContext.Provider value={{ team, gameState, stage, refreshTeam: fetchTeamProfile, refreshGameState: fetchGameState }}>
      <div className="min-h-screen bg-bgMain flex flex-col">
        <Navbar team={team} onLogout={() => setTeam(null)} />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </TeamContext.Provider>
  );
};

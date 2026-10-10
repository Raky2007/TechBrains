import React, { useEffect, useState, useRef, createContext, useContext, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { apiFetch, getStoredTeamToken, removeStoredTeamToken } from '../lib/api';
import { getSocket, refreshSocketAuth } from '../lib/socket';
import { PublicGameState, Team, TeamPrivateState, TeamStage, SessionReplacedPayload, TeamBannedPayload } from '@nexus/shared';
import { Loader2, ShieldAlert } from 'lucide-react';

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
  const [isSessionReplaced, setIsSessionReplaced] = useState<boolean>(false);
  const [replacedMessage, setReplacedMessage] = useState<string>('');
  const [isBanned, setIsBanned] = useState<boolean>(false);
  const [banReason, setBanReason] = useState<string>('');

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
    } catch (err: any) {
      if (err?.is_banned || err?.status === 403) {
        setIsBanned(true);
        setBanReason(err.ban_reason || 'Your team has been disqualified and banned by an administrator.');
        const socket = getSocket();
        socket.disconnect();
        return;
      }
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
    } catch (err: any) {
      if (err?.is_banned || err?.status === 403) {
        setIsBanned(true);
        setBanReason(err.ban_reason || 'Your team has been disqualified and banned by an administrator.');
        const socket = getSocket();
        socket.disconnect();
        return null;
      }
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

    const onGameReset = () => {
      console.log('[Socket] Tournament game has been reset by administrator');
      removeStoredTeamToken();
      window.location.href = '/';
    };

    socket.on('game:state_changed', onGlobalChange);
    socket.on('round:started', () => onGlobalChange());
    socket.on('round:paused', () => onGlobalChange());
    socket.on('round:resumed', () => onGlobalChange());
    socket.on('round:ended', () => onGlobalChange());
    socket.on('results:published', () => onGlobalChange());
    socket.on('team:private_updated', onPrivateUpdate);
    socket.on('game:reset', onGameReset);

    const onSessionReplaced = (payload?: SessionReplacedPayload) => {
      console.warn('[Socket] Team session replaced by another connection');
      setIsSessionReplaced(true);
      if (payload?.message) {
        setReplacedMessage(payload.message);
      }
      socket.disconnect();
    };
    socket.on('team:session_replaced', onSessionReplaced);

    const onTeamBanned = (payload?: TeamBannedPayload) => {
      console.warn('[Socket] Team has been banned by an administrator');
      setIsBanned(true);
      if (payload?.reason) {
        setBanReason(payload.reason);
      } else {
        setBanReason('Your team has been disqualified and banned by an administrator.');
      }
      socket.disconnect();
    };
    socket.on('team:banned', onTeamBanned);

    return () => {
      socket.off('game:state_changed', onGlobalChange);
      socket.off('round:started');
      socket.off('round:paused');
      socket.off('round:resumed');
      socket.off('round:ended');
      socket.off('results:published', onGlobalChange);
      socket.off('team:private_updated', onPrivateUpdate);
      socket.off('game:reset', onGameReset);
      socket.off('team:session_replaced', onSessionReplaced);
      socket.off('team:banned', onTeamBanned);
    };
    // Registered once for the lifetime of the layout; handlers use refs for path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard against direct URL changes: if user navigates to a route not permitted
  // for their server-authoritative stage, immediately snap back to allowed path.
  useEffect(() => {
    if (isLoading || isSessionReplaced || isBanned || !stage) return;
    const currentPath = location.pathname;
    const isPathAllowed = (path: string, currentStage: TeamStage): boolean => {
      switch (currentStage) {
        case 'waiting':
          return path === '/waiting';
        case 'round1':
          return path === '/level1';
        case 'round1_done':
          return path === '/level1' || path === '/waiting';
        case 'round2':
        case 'not_qualified':
          return path === '/level2' || path === '/level1';
        case 'result':
          return path === '/result' || path === '/level1' || path === '/level2';
        default:
          return path === '/waiting';
      }
    };

    if (!isPathAllowed(currentPath, stage)) {
      const target = pathForStage(stage);
      navigate(target, { replace: true });
    }
  }, [location.pathname, stage, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bgMain flex flex-col items-center justify-center text-textSecondary gap-4 font-mono">
        <Loader2 className="w-8 h-8 animate-spin text-primaryYellow" />
        <span className="text-sm tracking-widest uppercase">Synchronizing with authoritative LAN host...</span>
      </div>
    );
  }

  if (isBanned) {
    return (
      <div className="min-h-screen bg-bgMain flex flex-col">
        <Navbar team={team} stage={stage} onLogout={() => setTeam(null)} />
        <main className="flex-1 max-w-2xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center">
          <div className="bg-bgCard border border-[#B42318]/40 rounded-xl p-8 shadow-xl text-center space-y-6">
            <div className="inline-flex p-4 rounded-full bg-[#B42318]/10 text-[#B42318] mb-2">
              <ShieldAlert className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-bold font-mono text-[#B42318] tracking-wide">
              Team Disqualified
            </h2>
            <div className="bg-[#B42318]/5 border border-[#B42318]/20 rounded-lg p-4 text-left">
              <p className="text-xs font-mono text-[#737373] uppercase tracking-wider mb-1">
                Notice:
              </p>
              <p className="text-sm font-body text-[#171717] font-medium leading-relaxed">
                {banReason || 'Your team has been disqualified and banned from this game session by an administrator.'}
              </p>
            </div>
            <p className="text-xs text-[#737373] font-body leading-relaxed">
              All further access to game rounds and submissions has been revoked for this team. If you believe this is an error, please speak directly to the event invigilators.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (isSessionReplaced) {
    return (
      <div className="min-h-screen bg-bgMain flex flex-col">
        <Navbar team={team} stage={stage} onLogout={() => setTeam(null)} />
        <main className="flex-1 max-w-2xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center">
          <div className="bg-bgCard border border-primaryYellow/40 rounded-xl p-8 shadow-xl text-center space-y-6">
            <div className="inline-flex p-4 rounded-full bg-primaryYellow/10 text-primaryYellow mb-2">
              <ShieldAlert className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-bold font-mono text-textPrimary tracking-wide">
              Session Active in Another Window
            </h2>
            <p className="text-textSecondary text-sm sm:text-base leading-relaxed">
              {replacedMessage || 'Your team session was opened in another tab or device. Only one active connection is permitted per team to maintain game integrity.'}
            </p>
            <div className="pt-2 flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-primaryYellow hover:bg-yellow-400 text-bgMain font-bold font-mono rounded-lg transition-all shadow-md active:scale-95"
              >
                Resume in This Window
              </button>
            </div>
            <p className="text-xs text-textMuted font-mono">
              Resuming here will automatically transfer the active session to this window and disconnect the other tab.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <TeamContext.Provider value={{ team, gameState, stage, refreshTeam: fetchTeamProfile, refreshGameState: fetchGameState }}>
      <div className="min-h-screen bg-bgMain flex flex-col">
        <Navbar team={team} stage={stage} onLogout={() => setTeam(null)} />
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </TeamContext.Provider>
  );
};

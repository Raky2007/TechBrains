import { io, Socket } from 'socket.io-client';
import { getStoredTeamToken, getStoredAdminToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const socketUrl = (import.meta as any).env?.VITE_SOCKET_URL || (import.meta as any).env?.VITE_API_URL || window.location.origin;
    socket = io(socketUrl, {
      auth: (cb) => {
        cb({
          teamToken: getStoredTeamToken(),
          adminToken: getStoredAdminToken()
        });
      },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      reconnectionDelay: 1000
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected to authoritative host:', socket?.id);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] Connection issue:', err.message);
    });
  }

  return socket;
}

let lastTeamToken: string | null = null;
let lastAdminToken: string | null = null;

export function refreshSocketAuth(): void {
  const currentTeam = getStoredTeamToken();
  const currentAdmin = getStoredAdminToken();

  if (socket) {
    socket.auth = (cb: (data: any) => void) => {
      cb({
        teamToken: currentTeam,
        adminToken: currentAdmin
      });
    };
    if (currentTeam !== lastTeamToken || currentAdmin !== lastAdminToken) {
      lastTeamToken = currentTeam;
      lastAdminToken = currentAdmin;
      if (socket.connected) {
        socket.disconnect().connect();
      } else {
        socket.connect();
      }
    } else if (!socket.connected) {
      socket.connect();
    }
  } else {
    lastTeamToken = currentTeam;
    lastAdminToken = currentAdmin;
  }
}

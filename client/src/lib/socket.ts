import { io, Socket } from 'socket.io-client';
import { getStoredTeamToken, getStoredAdminToken } from './api';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
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

export function refreshSocketAuth(): void {
  if (socket) {
    socket.auth = (cb: (data: any) => void) => {
      cb({
        teamToken: getStoredTeamToken(),
        adminToken: getStoredAdminToken()
      });
    };
    if (socket.connected) {
      socket.disconnect().connect();
    } else {
      socket.connect();
    }
  }
}

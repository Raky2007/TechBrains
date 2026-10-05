import React, { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';
import { Wifi, WifiOff } from 'lucide-react';

export const ConnectionBadge: React.FC = () => {
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    const socket = getSocket();
    setIsConnected(socket.connected);

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <div
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
        isConnected
          ? 'bg-[#F5F5F2] text-[#171717] border-[#E5E5E5]'
          : 'bg-[#B42318]/5 text-[#B42318] border-[#B42318]/30'
      }`}
      title={isConnected ? 'Connected to authoritative host laptop' : 'Attempting to reach host laptop...'}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          isConnected ? 'bg-[#18794E]' : 'bg-[#B42318]'
        }`}
      />
      {isConnected ? (
        <span className="flex items-center gap-1 font-semibold text-[11px] tracking-wide">
          <Wifi className="w-3 h-3 text-[#18794E]" />
          <span>LAN LIVE</span>
        </span>
      ) : (
        <span className="flex items-center gap-1 font-semibold text-[11px] tracking-wide">
          <WifiOff className="w-3 h-3" />
          <span>OFFLINE</span>
        </span>
      )}
    </div>
  );
};

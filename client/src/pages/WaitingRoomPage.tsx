import React from 'react';
import { useTeam } from '../layouts/TeamLayout';
import { motion } from 'framer-motion';

/**
 * Participant Waiting Room (TechBrains).
 *
 * Intentionally minimal. It communicates exactly one idea: the team has joined
 * successfully and is waiting for the administrator to start the event. There
 * are NO participant controls here — the event is started only by the admin,
 * and the participant is moved to Round 1 / Round 2 automatically by the
 * server-authoritative state handled in TeamLayout.
 */
export const WaitingRoomPage: React.FC = () => {
  const { team } = useTeam();

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md mx-auto text-center space-y-8"
      >
        {/* Brand lockup: gradient TechBrains wordmark + department line */}
        <div className="space-y-2">
          <h1 className="text-4xl sm:text-5xl font-heading font-extrabold tracking-tight bg-gradient-to-r from-[#FFC928] via-[#FF8A24] to-[#B34400] bg-clip-text text-transparent">
            TechBrains
          </h1>
          <p className="text-xs font-mono uppercase tracking-[0.2em] text-[#737373]">
            Department of CSM · DAC
          </p>
        </div>

        {/* Joined confirmation + waiting status */}
        <div className="bg-[#FFFFFF] border border-[#E5E5E5] rounded-2xl p-8 space-y-6 shadow-sm">
          <div className="space-y-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#18794E] font-bold">
              ● Joined successfully
            </span>
            <p className="text-sm text-[#171717] font-body">
              Team{' '}
              <span className="font-heading font-bold underline decoration-[#FFC928] decoration-2 underline-offset-4">
                {team?.team_name}
              </span>{' '}
              is connected.
            </p>
          </div>

          <div className="pt-6 border-t border-[#E5E5E5] space-y-4">
            {/* Subtle pulsing indicator communicates the live "waiting" state */}
            <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-2 h-2 rounded-full bg-[#FFC928]"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
            <p className="text-base font-heading font-semibold text-[#171717]">
              Waiting for admin to start…
            </p>
            <p className="text-xs text-[#737373] font-body leading-relaxed">
              The event will begin automatically on your screen when the
              administrator starts the level. No action is needed from you.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

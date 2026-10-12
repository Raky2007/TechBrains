import React from 'react';
import { useTeam } from '../layouts/TeamLayout';

/**
 * Participant Waiting Room (TechBrains). Fits within the viewport without
 * scrolling: welcome/confirmation and the Rules & Regulations sit side by side
 * on wider screens.
 */
export const WaitingRoomPage: React.FC = () => {
  const { team } = useTeam();

  const level1Rules = [
    '30 questions — one point for each correct answer.',
    'Wrong or unattempted answers score zero (no negative marking).',
    '45 seconds per question.',
    'If the timer runs out before you answer, that question scores zero.'
  ];
  const level2Rules = [
    'Two questions — both are mandatory.',
    'Spend your team’s credits to unlock investigation clues.',
    'Study the case, then submit your final answers before Round 2 ends.'
  ];

  return (
    <div className="flex-1 flex flex-col justify-center gap-4 sm:gap-5">
      <h1 className="text-xl sm:text-2xl font-heading font-bold tracking-tight text-[#171717]">
        Waiting Room
      </h1>

      <div className="grid gap-5 sm:gap-8 md:grid-cols-2 items-start">
        {/* Welcome / confirmation */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <h2 className="text-lg sm:text-xl font-heading font-bold text-[#171717]">
              Welcome, <span className="text-[#B34400]">{team?.team_name}</span>
            </h2>
            <p className="text-sm text-[#171717] leading-relaxed">
              You have successfully joined <span className="font-semibold">TechBrains</span>.
            </p>
          </div>

          {/* Registered members */}
          <div className="pt-3 border-t border-[#E5E5E5] space-y-2">
            <span className="block text-[11px] font-heading font-bold uppercase tracking-wider text-[#737373]">
              Registered Members
            </span>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#737373]">Member 1</span>
                <span className="font-mono font-semibold text-[#171717]">{team?.player1_roll || '—'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#737373]">Member 2</span>
                <span className="font-mono font-semibold text-[#171717]">{team?.player2_roll || '—'}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-[#525252] leading-relaxed pt-1">
            Keep this screen open. When the admin starts the event, you will move to Round 1
            automatically — no action is needed from you.
          </p>

          <p className="text-sm font-heading font-semibold text-[#171717]">
            Waiting until the admin starts Round 1…
          </p>
        </div>

        {/* Rules & Regulations */}
        <div className="space-y-5 md:border-l md:border-[#E5E5E5] md:pl-8">
          <h2 className="text-lg sm:text-xl font-heading font-bold text-[#171717] tracking-tight">
            Rules &amp; Regulations
          </h2>

          <div className="space-y-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-heading font-black text-sm text-[#171717]">L1</span>
              <span className="font-heading font-bold text-sm text-[#171717]">— AI vs Human</span>
            </div>
            <ul className="space-y-1.5">
              {level1Rules.map((rule) => (
                <li key={rule} className="flex items-start gap-2.5 text-xs text-[#525252] leading-relaxed">
                  <span className="mt-2 h-px w-3 bg-[#A3A3A3] shrink-0" aria-hidden="true" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-heading font-black text-sm text-[#FF8A24]">L2</span>
              <span className="font-heading font-bold text-sm text-[#171717]">— Clues with Credits</span>
            </div>
            <ul className="space-y-1.5">
              {level2Rules.map((rule) => (
                <li key={rule} className="flex items-start gap-2.5 text-xs text-[#525252] leading-relaxed">
                  <span className="mt-2 h-px w-3 bg-[#A3A3A3] shrink-0" aria-hidden="true" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Clock, PauseCircle, AlertTriangle } from 'lucide-react';

interface CountdownTimerProps {
  deadlineAt: string | null;
  isPaused: boolean;
  remainingSeconds: number;
  onExpire?: () => void;
  className?: string;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({
  deadlineAt,
  isPaused,
  remainingSeconds: initialRemainingSeconds,
  onExpire,
  className = ''
}) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(initialRemainingSeconds);

  useEffect(() => {
    if (isPaused) {
      setSecondsLeft(initialRemainingSeconds);
      return;
    }

    if (!deadlineAt) {
      setSecondsLeft(0);
      return;
    }

    const calculateRemaining = () => {
      const diffMs = new Date(deadlineAt).getTime() - Date.now();
      const sec = Math.max(0, Math.floor(diffMs / 1000));
      setSecondsLeft(sec);
      if (sec === 0 && onExpire) {
        onExpire();
      }
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);

    return () => clearInterval(interval);
  }, [deadlineAt, isPaused, initialRemainingSeconds, onExpire]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const isUrgent = secondsLeft > 0 && secondsLeft <= 60;
  const isExpired = secondsLeft === 0;

  return (
    <div
      className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border font-mono tracking-wider transition-colors ${
        isPaused
          ? 'bg-[#FFF0D6] text-[#B34400] border-[#FF8A24]/40'
          : isUrgent
          ? 'bg-[#FFF0D6] text-[#FF8A24] border-[#FF8A24] font-bold'
          : isExpired
          ? 'bg-[#F5F5F2] text-[#737373] border-[#E5E5E5]'
          : 'bg-[#F5F5F2] text-[#171717] border-[#E5E5E5]'
      } ${className}`}
    >
      {isPaused ? (
        <PauseCircle className="w-4 h-4 text-[#FF8A24]" />
      ) : isUrgent ? (
        <AlertTriangle className="w-4 h-4 text-[#FF8A24]" />
      ) : (
        <Clock className="w-4 h-4 text-[#171717]" />
      )}
      <span className="text-sm font-semibold">
        {formattedTime}
      </span>
      {isPaused && (
        <span className="text-[10px] uppercase font-bold tracking-widest text-[#FF8A24] ml-1">
          PAUSED
        </span>
      )}
    </div>
  );
};

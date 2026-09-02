import React, { useEffect } from 'react';
import { Phone, PhoneOff, BellRing } from 'lucide-react';
import { CallInfo } from '@/types';

interface IncomingCallModalProps {
  callInfo: CallInfo | null;
  onAnswer: () => void;
  onDecline: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  callInfo,
  onAnswer,
  onDecline,
}) => {
  // Keyboard shortcuts: Enter to answer, Escape to decline
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onAnswer();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDecline();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onAnswer, onDecline]);

  if (!callInfo) return null;

  const getInitials = (name?: string): string => {
    if (!name) return 'IN';
    const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (name[0] || 'IN').toUpperCase();
  };

  const initials = getInitials(callInfo.remoteIdentity);

  return (
    <div className="absolute inset-0 z-40 bg-[var(--surface-1)]/98 backdrop-blur-lg flex flex-col justify-between p-6 select-none animate-in fade-in zoom-in-95 duration-200">
      {/* Top Banner */}
      <div className="flex items-center justify-center pt-2">
        <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[var(--accent-subtle)]/60 border border-[var(--accent)]/30 text-[var(--accent)] text-[11px] font-semibold uppercase tracking-wider">
          <BellRing className="w-3.5 h-3.5 animate-bounce" />
          <span>Incoming Call</span>
        </div>
      </div>

      {/* Caller Avatar & Info Centerpiece */}
      <div className="flex flex-col items-center justify-center my-auto relative">
        {/* Concentric radar rings */}
        <div className="relative mb-6 flex items-center justify-center">
          <div className="absolute w-28 h-28 rounded-full border-2 border-[var(--accent)]/30 animate-radar-1" />
          <div className="absolute w-28 h-28 rounded-full border-2 border-[var(--accent)]/40 animate-radar-2" />
          <div className="absolute w-28 h-28 rounded-full border-2 border-[var(--accent)]/50 animate-radar-3" />

          {/* Caller Monogram Avatar */}
          <div
            data-testid="caller-avatar"
            className="w-24 h-24 rounded-3xl bg-[var(--surface-2)] border-2 border-[var(--accent)] shadow-[0_0_24px_rgba(15,108,189,0.35)] flex items-center justify-center font-mono font-bold text-3xl text-[var(--accent)] relative z-10"
          >
            {initials}
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--accent)] text-[var(--on-accent)] flex items-center justify-center shadow-md">
              <Phone className="w-3.5 h-3.5 fill-current animate-pulse" />
            </div>
          </div>

        </div>

        <h2 className="text-2xl font-bold text-[var(--fg-1)] text-center px-4 truncate max-w-full tracking-tight">
          {callInfo.remoteIdentity || 'Unknown Caller'}
        </h2>
        <p className="text-xs text-[var(--fg-3)] font-mono mt-1 truncate max-w-[280px]">
          {callInfo.remoteUri}
        </p>
      </div>

      {/* Answer & Decline Controls with Keyboard Shortcuts */}
      <div className="flex items-center justify-center space-x-12 pb-6">
        {/* Decline Button */}
        <div className="flex flex-col items-center space-y-2">
          <button
            onClick={onDecline}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-[var(--danger-bg)] hover:bg-[var(--danger-fg)] text-[var(--danger-fg)] hover:text-white border border-[var(--danger-fg)]/30 shadow-[0_4px_16px_rgba(239,68,68,0.25)] transition-all active:scale-95 cursor-pointer group"
            title="Decline Call"
          >
            <PhoneOff className="w-7 h-7 transition-transform group-hover:scale-110" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-xs font-semibold text-[var(--danger-fg)]">Decline</span>
            <span className="text-[10px] text-[var(--fg-3)] font-mono opacity-75">Esc</span>
          </div>
        </div>

        {/* Answer Button */}
        <div className="flex flex-col items-center space-y-2">
          <button
            onClick={onAnswer}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_20px_rgba(16,185,129,0.45)] transition-all active:scale-95 animate-pulse cursor-pointer group"
            title="Answer Call"
          >
            <Phone className="w-7 h-7 fill-current transition-transform group-hover:scale-110" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-xs font-semibold text-emerald-500">Answer</span>
            <span className="text-[10px] text-[var(--fg-3)] font-mono opacity-75">↵ Enter</span>
          </div>
        </div>
      </div>
    </div>
  );
};


import React from 'react';
import { Phone, PhoneOff, PhoneCall } from 'lucide-react';
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
  if (!callInfo) return null;

  return (
    <div className="absolute inset-0 z-40 bg-[var(--surface-1)]/95 backdrop-blur-md flex flex-col justify-between p-6 select-none">
      <div className="flex flex-col items-center justify-center pt-10">
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full bg-[var(--info-bg)] border-2 border-[var(--accent)] text-[var(--accent)] flex items-center justify-center relative z-10 animate-bounce">
            <PhoneCall className="w-10 h-10" />
          </div>
          <div className="absolute inset-0 rounded-full border border-[var(--accent)] animate-ping" />
        </div>

        <span className="text-xs uppercase font-semibold tracking-wider text-[var(--accent)] mb-1">
          Incoming Call
        </span>
        <h2 className="text-2xl font-bold text-[var(--fg-1)] text-center px-4 truncate max-w-full">
          {callInfo.remoteIdentity || 'Unknown Caller'}
        </h2>
        <p className="text-xs text-[var(--fg-3)] mt-1 truncate max-w-[280px]">
          {callInfo.remoteUri}
        </p>
      </div>

      <div className="flex items-center justify-center space-x-10 pb-8">
        {/* Decline Button */}
        <div className="flex flex-col items-center space-y-2">
          <button
            onClick={onDecline}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-[var(--danger-bg)] text-[var(--danger-fg)] shadow-[var(--shadow-8)] transition-all active:scale-95"
            title="Decline Call"
          >
            <PhoneOff className="w-7 h-7" />
          </button>
          <span className="text-xs font-medium text-[var(--danger-fg)]">Decline</span>
        </div>

        {/* Answer Button */}
        <div className="flex flex-col items-center space-y-2">
          <button
            onClick={onAnswer}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] shadow-[var(--shadow-8)] transition-all active:scale-95 animate-pulse"
            title="Answer Call"
          >
            <Phone className="w-7 h-7 fill-current" />
          </button>
          <span className="text-xs font-medium text-[var(--accent)]">Answer</span>
        </div>
      </div>
    </div>
  );
};

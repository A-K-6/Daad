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
    <div className="absolute inset-0 z-40 bg-[#0f1117]/95 backdrop-blur-md flex flex-col justify-between p-6 select-none animate-in fade-in zoom-in-95 duration-200">
      <div className="flex flex-col items-center justify-center pt-10">
        <div className="relative mb-6">
          <div className="w-24 h-24 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400 flex items-center justify-center relative z-10 animate-bounce">
            <PhoneCall className="w-10 h-10" />
          </div>
          <div className="absolute inset-0 rounded-full border border-emerald-500/40 animate-ping" />
        </div>

        <span className="text-xs uppercase font-semibold tracking-wider text-emerald-400 mb-1">
          Incoming Call
        </span>
        <h2 className="text-2xl font-bold text-zinc-100 text-center px-4 truncate max-w-full">
          {callInfo.remoteIdentity || 'Unknown Caller'}
        </h2>
        <p className="text-xs text-zinc-500 mt-1 truncate max-w-[280px]">
          {callInfo.remoteUri}
        </p>
      </div>

      <div className="flex items-center justify-center space-x-10 pb-8">
        {/* Decline Button */}
        <div className="flex flex-col items-center space-y-2">
          <button
            onClick={onDecline}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all active:scale-95"
            title="Decline Call"
          >
            <PhoneOff className="w-7 h-7" />
          </button>
          <span className="text-xs font-medium text-zinc-400">Decline</span>
        </div>

        {/* Answer Button */}
        <div className="flex flex-col items-center space-y-2">
          <button
            onClick={onAnswer}
            className="flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-lg shadow-emerald-500/30 transition-all active:scale-95 animate-pulse"
            title="Answer Call"
          >
            <Phone className="w-7 h-7 fill-current" />
          </button>
          <span className="text-xs font-medium text-emerald-400">Answer</span>
        </div>
      </div>
    </div>
  );
};

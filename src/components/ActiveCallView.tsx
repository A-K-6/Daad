import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  Pause,
  Play,
  Grid3x3,
  PhoneOff,
  User,
} from 'lucide-react';
import { CallState, CallInfo } from '../types/sip';
import { DtmfKeypadModal } from './DtmfKeypadModal';

interface ActiveCallViewProps {
  callState: CallState;
  callInfo: CallInfo | null;
  onHangup: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onSendDtmf: (tone: string) => void;
}

export const ActiveCallView: React.FC<ActiveCallViewProps> = ({
  callState,
  callInfo,
  onHangup,
  onToggleMute,
  onToggleHold,
  onSendDtmf,
}) => {
  const [showDtmfKeypad, setShowDtmfKeypad] = useState<boolean>(false);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusText = () => {
    switch (callState) {
      case 'Calling':
        return 'Calling...';
      case 'Ringing':
        return 'Ringing...';
      case 'Holding':
        return 'Call On Hold';
      case 'Active':
      default:
        return 'Connected';
    }
  };

  const isMuted = callInfo?.isMuted || false;
  const isHeld = callState === 'Holding' || (callInfo?.isHeld || false);

  return (
    <div className="flex flex-col h-full justify-between p-6 select-none relative bg-gradient-to-b from-[#131722] to-[#0f1117]">
      {/* Remote Party Identity */}
      <div className="flex flex-col items-center justify-center pt-8">
        <div className="relative mb-4">
          <div
            className={`w-24 h-24 rounded-full flex items-center justify-center border-2 transition-all ${
              callState === 'Active'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : isHeld
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
            }`}
          >
            <User className="w-12 h-12" />
          </div>
          {(callState === 'Calling' || callState === 'Ringing') && (
            <div className="absolute inset-0 rounded-full border border-emerald-500/40 animate-ping" />
          )}
        </div>

        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight text-center px-4 truncate max-w-full">
          {callInfo?.remoteIdentity || 'Remote Party'}
        </h2>

        <div className="mt-2 flex items-center space-x-2">
          <span
            className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
              isHeld
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : callState === 'Active'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
          >
            {getStatusText()}
          </span>
        </div>

        {callState === 'Active' || callState === 'Holding' ? (
          <div className="mt-3 font-mono text-lg text-zinc-300">
            {formatDuration(callInfo?.duration || 0)}
          </div>
        ) : null}
      </div>

      {/* In-Call Controls */}
      <div className="flex flex-col items-center space-y-6 pb-4">
        <div className="grid grid-cols-3 gap-5">
          {/* Mute Button */}
          <button
            onClick={onToggleMute}
            className={`flex flex-col items-center justify-center w-16 h-16 rounded-2xl border transition-all active:scale-95 ${
              isMuted
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 shadow-sm'
                : 'bg-[#181c28] border-[#252b3d] text-zinc-300 hover:text-zinc-100 hover:bg-[#202536]'
            }`}
            title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            <span className="text-[10px] mt-1 font-medium">{isMuted ? 'Muted' : 'Mute'}</span>
          </button>

          {/* Hold Button */}
          <button
            onClick={onToggleHold}
            disabled={callState !== 'Active' && callState !== 'Holding'}
            className={`flex flex-col items-center justify-center w-16 h-16 rounded-2xl border transition-all active:scale-95 ${
              isHeld
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-400 shadow-sm'
                : 'bg-[#181c28] border-[#252b3d] text-zinc-300 hover:text-zinc-100 hover:bg-[#202536]'
            }`}
            title={isHeld ? 'Resume Call' : 'Hold Call'}
          >
            {isHeld ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
            <span className="text-[10px] mt-1 font-medium">{isHeld ? 'Resume' : 'Hold'}</span>
          </button>

          {/* DTMF Keypad Button */}
          <button
            onClick={() => setShowDtmfKeypad(true)}
            className="flex flex-col items-center justify-center w-16 h-16 rounded-2xl bg-[#181c28] border border-[#252b3d] text-zinc-300 hover:text-zinc-100 hover:bg-[#202536] transition-all active:scale-95"
            title="In-Call Keypad"
          >
            <Grid3x3 className="w-6 h-6" />
            <span className="text-[10px] mt-1 font-medium">Keypad</span>
          </button>
        </div>

        {/* End Call Button */}
        <button
          onClick={onHangup}
          className="flex items-center justify-center w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 hover:shadow-rose-600/50 transition-all active:scale-95"
          title="End Call"
        >
          <PhoneOff className="w-7 h-7" />
        </button>
      </div>

      {/* In-Call DTMF Keypad Modal */}
      {showDtmfKeypad && (
        <DtmfKeypadModal
          onSendTone={(tone) => onSendDtmf(tone)}
          onClose={() => setShowDtmfKeypad(false)}
        />
      )}
    </div>
  );
};

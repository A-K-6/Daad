import React, { useState } from 'react';
import { Mic, MicOff, Pause, Play, PhoneOff, Grid, User } from 'lucide-react';
import { CallState, CallInfo } from '@/types';
import { DtmfKeypadModal } from '@/components/DtmfKeypadModal';

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
  const [showDtmf, setShowDtmf] = useState<boolean>(false);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = () => {
    switch (callState) {
      case 'Calling':
        return { text: 'Calling...', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
      case 'Ringing':
        return { text: 'Ringing...', color: 'text-sky-400 bg-sky-500/10 border-sky-500/20' };
      case 'Holding':
        return { text: 'On Hold', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
      case 'Active':
      default:
        return { text: 'Connected', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="flex flex-col h-full justify-between p-5 select-none relative bg-[#090a0f]">
      {/* Top Caller Info */}
      <div className="flex flex-col items-center justify-center pt-4">
        <div className="w-16 h-16 rounded-2xl bg-[#13151f] border border-white/[0.08] flex items-center justify-center text-zinc-400 shadow-lg mb-3">
          <User className="w-8 h-8 text-zinc-300" />
        </div>

        <h2 className="text-base font-semibold text-zinc-100 tracking-wide text-center">
          {callInfo?.remoteIdentity || 'Remote Party'}
        </h2>

        {callInfo?.remoteUri && (
          <p className="text-[10px] text-zinc-500 font-mono text-center truncate max-w-[240px] mt-0.5">
            {callInfo.remoteUri}
          </p>
        )}

        <div className="flex items-center space-x-2 mt-2.5">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${badge.color}`}>
            {badge.text}
          </span>
          {callState === 'Active' && (
            <span className="text-xs font-mono font-medium text-zinc-300">
              {formatDuration(callInfo?.duration || 0)}
            </span>
          )}
        </div>

        {/* Audio Equalizer Waveform */}
        {callState === 'Active' && !callInfo?.isHeld && (
          <div className="flex items-center justify-center space-x-1 mt-4 h-7">
            <span className="w-1 bg-emerald-400/80 rounded-full animate-wave-1" />
            <span className="w-1 bg-emerald-400/80 rounded-full animate-wave-2" />
            <span className="w-1 bg-emerald-400/80 rounded-full animate-wave-3" />
            <span className="w-1 bg-emerald-400/80 rounded-full animate-wave-4" />
            <span className="w-1 bg-emerald-400/80 rounded-full animate-wave-5" />
          </div>
        )}
      </div>

      {/* In-Call Action Grid */}
      <div className="space-y-4 pb-2">
        <div className="grid grid-cols-3 gap-2.5 max-w-[250px] mx-auto">
          {/* Mute Button */}
          <button
            onClick={onToggleMute}
            title={callInfo?.isMuted ? 'Unmute Mic' : 'Mute Mic'}
            className={`flex flex-col items-center justify-center h-16 rounded-xl border transition-all active:scale-95 ${
              callInfo?.isMuted
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                : 'bg-[#13151f] hover:bg-[#1a1c2a] border-white/[0.06] text-zinc-300'
            }`}
          >
            {callInfo?.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="text-[9px] font-medium mt-1">
              {callInfo?.isMuted ? 'Muted' : 'Mute'}
            </span>
          </button>

          {/* Hold Button */}
          <button
            onClick={onToggleHold}
            disabled={callState !== 'Active' && callState !== 'Holding'}
            title={callInfo?.isHeld ? 'Resume Call' : 'Hold Call'}
            className={`flex flex-col items-center justify-center h-16 rounded-xl border transition-all active:scale-95 disabled:opacity-40 ${
              callInfo?.isHeld
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                : 'bg-[#13151f] hover:bg-[#1a1c2a] border-white/[0.06] text-zinc-300'
            }`}
          >
            {callInfo?.isHeld ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            <span className="text-[9px] font-medium mt-1">
              {callInfo?.isHeld ? 'Unhold' : 'Hold'}
            </span>
          </button>

          {/* DTMF Keypad Button */}
          <button
            onClick={() => setShowDtmf(true)}
            title="In-Call Keypad"
            className="flex flex-col items-center justify-center h-16 rounded-xl bg-[#13151f] hover:bg-[#1a1c2a] border border-white/[0.06] text-zinc-300 transition-all active:scale-95"
          >
            <Grid className="w-5 h-5" />
            <span className="text-[9px] font-medium mt-1">Keypad</span>
          </button>
        </div>

        {/* Hangup Trigger */}
        <div className="flex justify-center items-center">
          <button
            onClick={onHangup}
            title="End Call"
            className="flex items-center justify-center w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/25 transition-all active:scale-95 cursor-pointer"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* In-Call DTMF Drawer */}
      {showDtmf && (
        <DtmfKeypadModal
          onSendTone={onSendDtmf}
          onClose={() => setShowDtmf(false)}
        />
      )}
    </div>
  );
};

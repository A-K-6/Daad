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
        return { text: 'Calling...', color: 'text-[var(--warning-fg)] bg-[var(--warning-bg)]' };
      case 'Ringing':
        return { text: 'Ringing...', color: 'text-[var(--info-fg)] bg-[var(--info-bg)]' };
      case 'Holding':
        return { text: 'On Hold', color: 'text-[var(--warning-fg)] bg-[var(--warning-bg)]' };
      case 'Active':
      default:
        return { text: 'Connected', color: 'text-[var(--success-fg)] bg-[var(--success-bg)]' };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="flex flex-col h-full justify-between p-5 select-none relative bg-[var(--surface-1)]">
      {/* Top Caller Info */}
      <div className="flex flex-col items-center justify-center pt-4">
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface-2)] border border-[var(--stroke-2)] flex items-center justify-center text-[var(--fg-3)] shadow-[var(--shadow-2)] mb-3">
          <User className="w-8 h-8 text-[var(--fg-2)]" />
        </div>

        <h2 className="text-lg font-semibold text-[var(--fg-1)] tracking-wide text-center">
          {callInfo?.remoteIdentity || 'Remote Party'}
        </h2>

        {callInfo?.remoteUri && (
          <p className="text-[11px] text-[var(--fg-3)] font-mono text-center truncate max-w-[240px] mt-0.5">
            {callInfo.remoteUri}
          </p>
        )}

        <div className="flex items-center space-x-2 mt-2.5">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${badge.color}`}>
            {badge.text}
          </span>
          {callState === 'Active' && (
            <span className="text-sm font-mono font-medium text-[var(--fg-2)]">
              {formatDuration(callInfo?.duration || 0)}
            </span>
          )}
        </div>

        {/* Audio Equalizer Waveform */}
        {callState === 'Active' && !callInfo?.isHeld && (
          <div className="flex items-center justify-center space-x-1 mt-4 h-7">
            <span className="w-1 rounded-full animate-wave-1" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-2" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-3" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-4" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-5" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
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
            className={`flex flex-col items-center justify-center h-16 rounded-md border transition-all active:scale-95 ${
              callInfo?.isMuted
                ? 'bg-[var(--danger-bg)] border-[var(--stroke-2)] text-[var(--danger-fg)]'
                : 'bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border-[var(--stroke-2)] text-[var(--fg-2)]'
            }`}
          >
            {callInfo?.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="text-[10px] font-medium mt-1">
              {callInfo?.isMuted ? 'Muted' : 'Mute'}
            </span>
          </button>

          {/* Hold Button */}
          <button
            onClick={onToggleHold}
            disabled={callState !== 'Active' && callState !== 'Holding'}
            title={callInfo?.isHeld ? 'Resume Call' : 'Hold Call'}
            className={`flex flex-col items-center justify-center h-16 rounded-md border transition-all active:scale-95 disabled:opacity-40 ${
              callInfo?.isHeld
                ? 'bg-[var(--warning-bg)] border-[var(--stroke-2)] text-[var(--warning-fg)]'
                : 'bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border-[var(--stroke-2)] text-[var(--fg-2)]'
            }`}
          >
            {callInfo?.isHeld ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            <span className="text-[10px] font-medium mt-1">
              {callInfo?.isHeld ? 'Unhold' : 'Hold'}
            </span>
          </button>

          {/* DTMF Keypad Button */}
          <button
            onClick={() => setShowDtmf(true)}
            title="In-Call Keypad"
            className="flex flex-col items-center justify-center h-16 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] text-[var(--fg-2)] transition-all active:scale-95"
          >
            <Grid className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">Keypad</span>
          </button>
        </div>

        {/* Hangup Trigger */}
        <div className="flex justify-center items-center">
          <button
            onClick={onHangup}
            title="End Call"
            className="flex items-center justify-center w-14 h-14 rounded-full bg-[var(--danger-fg)] hover:opacity-90 text-[var(--on-accent)] shadow-[var(--shadow-8)] transition-all active:scale-95 cursor-pointer"
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

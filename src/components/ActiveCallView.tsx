import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Pause,
  Play,
  PhoneOff,
  Grid,
  Volume2,
  ShieldCheck,
  Check,
  X,
} from 'lucide-react';
import { CallState, CallInfo } from '@/types';
import { DtmfKeypadModal } from '@/components/DtmfKeypadModal';
import { audioDeviceService, AudioDevice } from '@/services/audioDeviceService';

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
  const [showAudioMenu, setShowAudioMenu] = useState<boolean>(false);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>('');

  useEffect(() => {
    const updateDevices = () => {
      setOutputDevices(audioDeviceService.getOutputDevices());
      setSelectedOutput(audioDeviceService.getSelectedOutputId());
    };

    updateDevices();
    const unsub = audioDeviceService.onChange(updateDevices);
    return unsub;
  }, []);


  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = () => {
    switch (callState) {
      case 'Calling':
        return { text: 'Calling...', color: 'text-[var(--warning-fg)] bg-[var(--warning-bg)] border-[var(--warning-fg)]/20' };
      case 'Ringing':
        return { text: 'Ringing...', color: 'text-[var(--info-fg)] bg-[var(--info-bg)] border-[var(--info-fg)]/20' };
      case 'Holding':
        return { text: 'On Hold', color: 'text-[var(--warning-fg)] bg-[var(--warning-bg)] border-[var(--warning-fg)]/20' };
      case 'Active':
      default:
        return { text: 'Connected', color: 'text-[var(--success-fg)] bg-[var(--success-bg)] border-[var(--success-fg)]/20' };
    }
  };

  const getInitials = (name?: string): string => {
    if (!name) return 'RP';
    const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].substring(0, 2).toUpperCase();
    }
    return (name[0] || 'RP').toUpperCase();
  };

  const badge = getStatusBadge();
  const isOutgoingRinging = callState === 'Calling' || callState === 'Ringing';
  const isHeld = callState === 'Holding' || Boolean(callInfo?.isHeld);
  const initials = getInitials(callInfo?.remoteIdentity);

  return (
    <div className="flex flex-col h-full justify-between p-5 select-none relative bg-[var(--surface-1)]">
      {/* Top Protocol / Quality Bar */}
      <div className="flex items-center justify-between text-[11px] text-[var(--fg-3)] font-mono border-b border-[var(--stroke-2)]/60 pb-2">
        <div className="flex items-center space-x-1">
          <ShieldCheck className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span>HD Audio • WebRTC</span>
        </div>
        <div className="flex items-center space-x-1.5">
          {callState === 'Active' && !isHeld && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-live-dot" />
          )}
          <span className={`px-2 py-0.5 rounded-full font-medium border text-[10px] ${badge.color}`}>
            {badge.text}
          </span>
        </div>
      </div>

      {/* Caller Identity Centerpiece */}
      <div className="flex flex-col items-center justify-center pt-2 pb-1 relative my-auto">
        {/* Animated Avatar Container */}
        <div className="relative mb-3 flex items-center justify-center">
          {/* Concentric radar rings for Calling / Ringing */}
          {isOutgoingRinging && (
            <>
              <div className="absolute w-20 h-20 rounded-full border border-[var(--accent)] animate-radar-1" />
              <div className="absolute w-20 h-20 rounded-full border border-[var(--accent)] animate-radar-2" />
              <div className="absolute w-20 h-20 rounded-full border border-[var(--accent)] animate-radar-3" />
            </>
          )}

          {/* Active Call Ambient Glow */}
          {callState === 'Active' && !isHeld && (
            <div className="absolute -inset-1 rounded-2xl bg-emerald-500/10 blur-sm animate-pulse" />
          )}

          {/* Held Call Ambient Glow */}
          {isHeld && (
            <div className="absolute -inset-1 rounded-2xl bg-amber-500/15 blur-sm" />
          )}

          {/* Core Avatar Box */}
          <div
            className={`w-20 h-20 rounded-2xl flex items-center justify-center font-mono font-bold text-xl tracking-wider shadow-[var(--shadow-2)] transition-all z-10 ${
              isHeld
                ? 'bg-[var(--warning-bg)] border-2 border-[var(--warning-fg)] text-[var(--warning-fg)]'
                : isOutgoingRinging
                ? 'bg-[var(--info-bg)] border-2 border-[var(--accent)] text-[var(--accent)]'
                : 'bg-[var(--surface-2)] border border-[var(--stroke-2)] text-[var(--fg-1)]'
            }`}
          >
            {initials}
          </div>
        </div>

        {/* Remote Identity */}
        <h2 className="text-lg font-bold text-[var(--fg-1)] tracking-tight text-center px-2 truncate max-w-full">
          {callInfo?.remoteIdentity || 'Remote Party'}
        </h2>

        {callInfo?.remoteUri && (
          <p className="text-[11px] text-[var(--fg-3)] font-mono text-center truncate max-w-[260px] mt-0.5">
            {callInfo.remoteUri}
          </p>
        )}

        {/* Live Call Timer */}
        {callState === 'Active' && (
          <div className="mt-2.5 flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--stroke-2)] shadow-[var(--shadow-2)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-live-dot" />
            <span className="text-sm font-mono font-semibold text-[var(--fg-1)] tracking-widest">
              {formatDuration(callInfo?.duration || 0)}
            </span>
          </div>
        )}

        {/* Status Callout Banner: Muted or Held */}
        {callInfo?.isMuted && (
          <div className="mt-2 px-2.5 py-0.5 rounded-md bg-[var(--danger-bg)] border border-[var(--danger-fg)]/30 text-[10px] font-medium text-[var(--danger-fg)] flex items-center space-x-1">
            <MicOff className="w-3 h-3" />
            <span>Microphone is muted</span>
          </div>
        )}

        {isHeld && (
          <div className="mt-2 px-2.5 py-0.5 rounded-md bg-[var(--warning-bg)] border border-[var(--warning-fg)]/30 text-[10px] font-medium text-[var(--warning-fg)] flex items-center space-x-1">
            <Pause className="w-3 h-3" />
            <span>Call on hold • Audio paused</span>
          </div>
        )}

        {/* Multi-frequency Audio Equalizer Waveform */}
        {callState === 'Active' && !isHeld && (
          <div className="flex items-center justify-center space-x-1 mt-3 h-7">
            <span className="w-1 rounded-full animate-wave-1" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-2" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-3" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-4" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-5" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-6" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
            <span className="w-1 rounded-full animate-wave-7" style={{ backgroundColor: 'var(--accent)', opacity: 0.8 }} />
          </div>
        )}
      </div>

      {/* In-Call Action Grid & Hangup */}
      <div className="space-y-4 pt-2 pb-1 border-t border-[var(--stroke-2)]/60">
        <div className="grid grid-cols-4 gap-2 max-w-[290px] mx-auto">
          {/* Mute Button */}
          <button
            onClick={onToggleMute}
            title={callInfo?.isMuted ? 'Unmute Mic' : 'Mute Mic'}
            className={`flex flex-col items-center justify-center h-16 rounded-xl border transition-all active:scale-95 cursor-pointer shadow-[var(--shadow-2)] ${
              callInfo?.isMuted
                ? 'bg-[var(--danger-bg)] border-[var(--danger-fg)]/40 text-[var(--danger-fg)] shadow-[0_0_12px_rgba(239,68,68,0.2)]'
                : 'bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--fg-1)]'
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
            className={`flex flex-col items-center justify-center h-16 rounded-xl border transition-all active:scale-95 disabled:opacity-40 shadow-[var(--shadow-2)] cursor-pointer ${
              callInfo?.isHeld
                ? 'bg-[var(--warning-bg)] border-[var(--warning-fg)]/40 text-[var(--warning-fg)] shadow-[0_0_12px_rgba(245,158,11,0.2)]'
                : 'bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--fg-1)]'
            }`}
          >
            {callInfo?.isHeld ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            <span className="text-[10px] font-medium mt-1">
              {callInfo?.isHeld ? 'Resume' : 'Hold'}
            </span>
          </button>

          {/* DTMF Keypad Button */}
          <button
            onClick={() => setShowDtmf(true)}
            title="In-Call Keypad"
            className="flex flex-col items-center justify-center h-16 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--accent)] transition-all active:scale-95 shadow-[var(--shadow-2)] cursor-pointer"
          >
            <Grid className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">Keypad</span>
          </button>

          {/* Audio Output Selector Button */}
          <button
            onClick={() => setShowAudioMenu((prev) => !prev)}
            title="Audio Devices"
            className={`flex flex-col items-center justify-center h-16 rounded-xl border transition-all active:scale-95 shadow-[var(--shadow-2)] cursor-pointer ${
              showAudioMenu
                ? 'bg-[var(--accent-subtle)] border-[var(--accent)] text-[var(--accent)]'
                : 'bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-2)] hover:text-[var(--fg-1)]'
            }`}
          >
            <Volume2 className="w-5 h-5" />
            <span className="text-[10px] font-medium mt-1">Audio</span>
          </button>
        </div>

        {/* Hangup Trigger */}
        <div className="flex justify-center items-center">
          <button
            onClick={onHangup}
            title="End Call"
            className="flex items-center justify-center w-14 h-14 rounded-full bg-[var(--danger-fg)] hover:opacity-95 text-[var(--on-accent)] shadow-[0_4px_14px_rgba(239,68,68,0.4)] transition-all active:scale-95 cursor-pointer group"
          >
            <PhoneOff className="w-6 h-6 transition-transform group-hover:scale-110" />
          </button>
        </div>
      </div>

      {/* Audio Device Selector Dropdown / Overlay */}
      {showAudioMenu && (
        <div className="absolute inset-x-4 bottom-24 bg-[var(--surface-2)] border border-[var(--stroke-1)] rounded-xl p-3.5 shadow-[var(--shadow-8)] z-20 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--stroke-2)]">
            <span className="text-xs font-semibold text-[var(--fg-1)]">Audio Output</span>
            <button
              onClick={() => setShowAudioMenu(false)}
              className="p-1 text-[var(--fg-3)] hover:text-[var(--fg-1)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {outputDevices.length > 0 ? (
              outputDevices.map((device) => (
                <button
                  key={device.deviceId}
                  onClick={() => {
                    audioDeviceService.setOutputDevice(device.deviceId);
                    setSelectedOutput(device.deviceId);
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs text-left transition-colors ${

                    selectedOutput === device.deviceId
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)] font-medium'
                      : 'hover:bg-[var(--surface-4)] text-[var(--fg-2)]'
                  }`}
                >
                  <span className="truncate pr-2">{device.label}</span>
                  {selectedOutput === device.deviceId && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              ))
            ) : (
              <p className="text-[11px] text-[var(--fg-3)] py-1">Default System Output</p>
            )}
          </div>
        </div>
      )}

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


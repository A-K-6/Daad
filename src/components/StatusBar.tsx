import React, { useState, useEffect } from 'react';
import { Settings, AlertCircle, LogOut, Sparkles } from 'lucide-react';
import { ConnectionState, SipConfig } from '@/types';
import { updateService } from '@/services';
import { DaadLogo } from '@/components/DaadLogo';

interface StatusBarProps {
  connectionState: ConnectionState;
  connectionError: string | null;
  config: SipConfig;
  onOpenSettings: () => void;
  onOpenUpdates?: () => void;
  onLogout?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  connectionState,
  connectionError,
  config,
  onOpenSettings,
  onOpenUpdates,
  onLogout,
}) => {
  const [hasUpdate, setHasUpdate] = useState<boolean>(false);

  useEffect(() => {
    const unsub = updateService.onChange(() => {
      const info = updateService.getUpdateInfo();
      setHasUpdate(Boolean(info?.hasUpdate));
    });
    return unsub;
  }, []);

  const getStatusDot = () => {
    switch (connectionState) {
      case 'Registered':
        return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]';
      case 'Connecting':
        return 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.7)]';
      case 'RegistrationFailed':
        return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]';
      case 'Disconnected':
      default:
        return 'bg-zinc-600';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'Registered':
        return config.displayName || config.username || 'Registered';
      case 'Connecting':
        return 'Connecting...';
      case 'RegistrationFailed':
        return 'Failed to Register';
      case 'Disconnected':
      default:
        return 'Offline';
    }
  };

  return (
    <header className="flex items-center justify-between px-3.5 py-2.5 bg-[#0e1017] border-b border-white/[0.06] select-none">
      <div className="flex items-center space-x-2.5 min-w-0">
        <DaadLogo size={24} withGlow={false} />
        <div className="min-w-0">
          <div className="flex items-center space-x-1.5">
            <span data-testid="status-dot" className={`w-1.5 h-1.5 rounded-full ${getStatusDot()}`} />
            <h1 className="text-[11px] font-medium tracking-wide text-zinc-200 truncate">
              {getStatusText()}
            </h1>
          </div>
          <p className="text-[10px] text-zinc-500 font-mono truncate">
            {connectionState === 'Registered'
              ? config.sipUri
              : connectionError || 'Configure SIP in Settings'}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-1">
        {onOpenUpdates && (
          <button
            onClick={onOpenUpdates}
            className={`p-1.5 rounded-md transition-all relative ${
              hasUpdate
                ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]'
            }`}
            title={hasUpdate ? 'Software Update Available!' : 'Check for Updates'}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {hasUpdate && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
            )}
          </button>
        )}

        {connectionState === 'RegistrationFailed' && (
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-rose-400 hover:text-rose-300 transition-colors"
            title={connectionError || 'Registration Error'}
          >
            <AlertCircle className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05] rounded-md transition-all"
          title="SIP Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {onLogout && (connectionState === 'Registered' || connectionState === 'Connecting') && (
          <button
            onClick={onLogout}
            className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-all"
            title="Log Out / Disconnect"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  );
};

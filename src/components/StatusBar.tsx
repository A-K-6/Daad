import React, { useState, useEffect } from 'react';
import { Settings, AlertCircle, LogOut, Sparkles } from 'lucide-react';
import { ConnectionState, SipConfig, CertTrustStatus } from '@/types';
import { updateService } from '@/services';
import { DaadLogo } from '@/components/DaadLogo';
import { CertTrustBadge } from '@/components/CertTrustBadge';
import { texts } from '@/styles/fluent';

interface StatusBarProps {
  connectionState: ConnectionState;
  connectionError: string | null;
  config: SipConfig;
  certStatus?: CertTrustStatus;
  onOpenSettings: () => void;
  onOpenUpdates?: () => void;
  onLogout?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  connectionState,
  connectionError,
  config,
  certStatus = 'unknown',
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
      case 'NetworkConnected':
      case 'TlsVerified':
      case 'Registering':
      case 'Reconnecting':
        return 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.7)]';
      case 'RegistrationFailed':
      case 'AuthFailed':
      case 'CertFailed':
      case 'MicFailed':
      case 'NoReachableContact':
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
      case 'NetworkConnected':
        return 'Network connected';
      case 'TlsVerified':
        return 'TLS verified';
      case 'Registering':
        return 'Registering...';
      case 'Reconnecting':
        return 'Reconnecting...';
      case 'AuthFailed':
        return 'Auth failed';
      case 'CertFailed':
        return 'Cert failed';
      case 'MicFailed':
        return 'Mic failed';
      case 'NoReachableContact':
        return 'No reachable contact';
      case 'RegistrationFailed':
        return 'Failed to Register';
      case 'Disconnected':
      default:
        return 'Offline';
    }
  };

  return (
    <header className="flex items-center justify-between px-3.5 py-2.5 bg-[var(--surface-2)] border-b border-[var(--stroke-2)] select-none">
      <div className="flex items-center space-x-2.5 min-w-0">
        <DaadLogo size={24} withGlow={false} />
        <div className="min-w-0">
          <div className="flex items-center space-x-1.5">
            <span data-testid="status-dot" className={`w-1.5 h-1.5 rounded-full ${getStatusDot()}`} />
            <h1 className="text-[13px] font-semibold tracking-wide text-[var(--fg-1)] truncate">
              {getStatusText()}
            </h1>
          </div>
          <p
            data-testid="status-message"
            title={connectionError || undefined}
            className="text-[11px] text-[var(--fg-3)] font-mono truncate"
          >
            {connectionState === 'Registered'
              ? config.sipUri
              : connectionError || 'Configure SIP in Settings'}
          </p>
          {(connectionState === 'Registered' ||
            connectionState === 'TlsVerified' ||
            connectionState === 'CertFailed') && (
            <div className="mt-1">
              <CertTrustBadge status={certStatus} />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-1">
        {onOpenUpdates && (
          <button
            onClick={onOpenUpdates}
            className={`p-1.5 rounded-md transition-all relative ${
              hasUpdate
                ? 'text-[var(--accent)] bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle)]'
                : `${texts['text-fg-3']} hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)]`
            }`}
            title={hasUpdate ? 'Software Update Available!' : 'Check for Updates'}
          >
            <Sparkles className="w-4 h-4" />
            {hasUpdate && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
            )}
          </button>
        )}

        {connectionState === 'RegistrationFailed' && (
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-[var(--danger-fg)] hover:opacity-80 transition-colors"
            title={connectionError || 'Registration Error'}
          >
            <AlertCircle className="w-4 h-4" />
          </button>
        )}

        {(connectionState === 'AuthFailed' ||
          connectionState === 'CertFailed' ||
          connectionState === 'MicFailed' ||
          connectionState === 'NoReachableContact') && (
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-rose-400 hover:opacity-80 transition-colors active:scale-95"
            title={connectionError || 'Connection failure'}
          >
            <AlertCircle className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className={`p-1.5 ${texts['text-fg-3']} hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded-md transition-all`}
          title="SIP Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        {onLogout && (connectionState === 'Registered' || connectionState === 'Connecting' || connectionState === 'Registering' || connectionState === 'Reconnecting') && (
          <button
            onClick={onLogout}
            className="p-1.5 text-[var(--fg-3)] hover:text-[var(--danger-fg)] hover:bg-[var(--danger-bg)] rounded-md transition-all"
            title="Log Out / Disconnect"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};

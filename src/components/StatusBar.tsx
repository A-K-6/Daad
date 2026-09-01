import React from 'react';
import { Settings, Phone, AlertCircle, LogOut } from 'lucide-react';
import { ConnectionState, SipConfig } from '../types/sip';

interface StatusBarProps {
  connectionState: ConnectionState;
  connectionError: string | null;
  config: SipConfig;
  onOpenSettings: () => void;
  onLogout?: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  connectionState,
  connectionError,
  config,
  onOpenSettings,
  onLogout,
}) => {
  const getStatusColor = () => {
    switch (connectionState) {
      case 'Registered':
        return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]';
      case 'Connecting':
        return 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]';
      case 'RegistrationFailed':
        return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]';
      case 'Disconnected':
      default:
        return 'bg-zinc-500';
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
    <header className="flex items-center justify-between px-4 py-3 bg-[#131722] border-b border-[#242938] select-none">
      <div className="flex items-center space-x-2.5 min-w-0">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
          <Phone className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center space-x-1.5">
            <span data-testid="status-dot" className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
            <h1 className="text-xs font-semibold tracking-wider text-zinc-100 uppercase truncate">
              {getStatusText()}
            </h1>
          </div>
          <p className="text-[10px] text-zinc-400 truncate">
            {connectionState === 'Registered'
              ? config.sipUri
              : connectionError || 'Configure SIP in Settings'}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-1">
        {connectionState === 'RegistrationFailed' && (
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-rose-400 hover:text-rose-300 transition-colors"
            title={connectionError || 'Registration Error'}
          >
            <AlertCircle className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-[#1f2433] rounded-lg transition-all"
          title="SIP Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
        {onLogout && (connectionState === 'Registered' || connectionState === 'Connecting') && (
          <button
            onClick={onLogout}
            className="p-2 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
            title="Log Out / Disconnect"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};

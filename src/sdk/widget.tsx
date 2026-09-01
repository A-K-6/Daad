import React, { useState, useEffect } from 'react';
import { SipProvider, useSip } from '@/context';
import {
  StatusBar,
  LoginView,
  DialerPad,
  RecentCallsView,
  ActiveCallView,
  IncomingCallModal,
  SettingsModal,
  UpdateModal,
} from '@/components';
import { SipConfig } from '@/types';
import { Phone, Clock } from 'lucide-react';

export interface DaadPhoneWidgetProps {
  initialConfig?: SipConfig;
  autoConnect?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const WidgetInner: React.FC<{ initialConfig?: SipConfig; autoConnect?: boolean; className?: string; style?: React.CSSProperties }> = ({
  initialConfig,
  autoConnect = false,
  className = '',
  style = {},
}) => {
  const {
    config,
    connectionState,
    connectionError,
    callState,
    callInfo,
    callHistory,
    hasLoggedIn,
    connect,
    login,
    logout,
    makeCall,
    answerCall,
    rejectCall,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
    clearCallHistory,
  } = useSip();

  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showUpdates, setShowUpdates] = useState<boolean>(false);
  const [activeDialerTab, setActiveDialerTab] = useState<'keypad' | 'history'>('keypad');

  useEffect(() => {
    if (autoConnect && initialConfig && initialConfig.serverUrl && initialConfig.username) {
      connect(initialConfig).catch((e) => {
        console.warn('DaadPhoneWidget auto-connect failed:', e);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveAndConnect = async (newConfig: SipConfig) => {
    setShowSettings(false);
    await connect(newConfig);
  };

  const isIncomingCallRinging = callState === 'Ringing' && callInfo?.direction === 'incoming';
  const isCallActiveOrOutgoing =
    callState === 'Calling' ||
    (callState === 'Ringing' && callInfo?.direction === 'outgoing') ||
    callState === 'Active' ||
    callState === 'Holding';

  return (
    <div
      style={style}
      className={`flex flex-col h-[600px] w-full max-w-[360px] bg-[#0c0e15] text-zinc-100 relative overflow-hidden font-sans select-none shadow-2xl rounded-2xl border border-white/[0.08] ${className}`}
    >
      {!hasLoggedIn ? (
        <LoginView
          initialConfig={initialConfig || config}
          connectionState={connectionState}
          connectionError={connectionError}
          onLogin={login}
        />
      ) : (
        <>
          {/* Top Status Bar */}
          <StatusBar
            connectionState={connectionState}
            connectionError={connectionError}
            config={config}
            onOpenSettings={() => setShowSettings(true)}
            onOpenUpdates={() => setShowUpdates(true)}
            onLogout={logout}
          />

          {/* Main Dialer or In-Call Interface */}
          <main className="flex-1 relative overflow-hidden flex flex-col bg-[#090a0f]">
            {isCallActiveOrOutgoing ? (
              <ActiveCallView
                callState={callState}
                callInfo={callInfo}
                onHangup={hangup}
                onToggleMute={toggleMute}
                onToggleHold={toggleHold}
                onSendDtmf={sendDTMF}
              />
            ) : (
              <div className="flex flex-col h-full justify-between">
                {/* Tab Selector */}
                <div className="flex px-4 pt-2.5 pb-1 space-x-1">
                  <button
                    onClick={() => setActiveDialerTab('keypad')}
                    className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeDialerTab === 'keypad'
                        ? 'bg-[#13151f] text-emerald-400 border border-white/[0.08] shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>Keypad</span>
                  </button>
                  <button
                    onClick={() => setActiveDialerTab('history')}
                    className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      activeDialerTab === 'history'
                        ? 'bg-[#13151f] text-emerald-400 border border-white/[0.08] shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Recents</span>
                    {callHistory.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.2 text-[9px] rounded-full bg-zinc-800 text-zinc-400 font-mono">
                        {callHistory.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-hidden">
                  {activeDialerTab === 'keypad' ? (
                    <DialerPad
                      connectionState={connectionState}
                      onCall={makeCall}
                      onOpenSettings={() => setShowSettings(true)}
                    />
                  ) : (
                    <RecentCallsView
                      records={callHistory}
                      onCall={(target) => {
                        setActiveDialerTab('keypad');
                        makeCall(target);
                      }}
                      onClear={clearCallHistory}
                    />
                  )}
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {/* Incoming Call Overlay */}
      {isIncomingCallRinging && (
        <IncomingCallModal
          callInfo={callInfo}
          onAnswer={answerCall}
          onDecline={rejectCall}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          currentConfig={config}
          connectionState={connectionState}
          connectionError={connectionError}
          onSaveAndConnect={handleSaveAndConnect}
          onDisconnect={logout}
          onClose={() => setShowSettings(false)}
          onOpenUpdates={() => setShowUpdates(true)}
        />
      )}

      {/* Update Modal */}
      {showUpdates && (
        <UpdateModal
          onClose={() => setShowUpdates(false)}
        />
      )}
    </div>
  );
};

export const DaadPhoneWidget: React.FC<DaadPhoneWidgetProps> = (props) => {
  return (
    <SipProvider>
      <WidgetInner {...props} />
    </SipProvider>
  );
};

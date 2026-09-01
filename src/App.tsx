import React, { useState, useEffect } from 'react';
import { SipProvider, useSip } from './context/SipContext';
import { StatusBar } from './components/StatusBar';
import { LoginView } from './components/LoginView';
import { DialerPad } from './components/DialerPad';
import { RecentCallsView } from './components/RecentCallsView';
import { ActiveCallView } from './components/ActiveCallView';
import { IncomingCallModal } from './components/IncomingCallModal';
import { SettingsModal } from './components/SettingsModal';
import { Phone, Clock } from 'lucide-react';
import { SipConfig } from './types/sip';

const MainSoftphone: React.FC = () => {
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
  const [activeDialerTab, setActiveDialerTab] = useState<'keypad' | 'history'>('keypad');

  // Auto connect on startup if credentials exist
  useEffect(() => {
    if (config.serverUrl && config.username && config.password) {
      connect(config).catch((e) => {
        console.warn('Initial SIP auto-connect failed:', e);
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
    <div className="flex justify-center items-center min-h-screen bg-[#090a0f]">
      <div className="flex flex-col h-screen max-h-[100dvh] w-full max-w-md bg-[#0f1117] text-zinc-100 relative overflow-hidden font-sans select-none shadow-2xl sm:border-x sm:border-[#232838]">
        {!hasLoggedIn ? (
          <LoginView
            initialConfig={config}
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
              onLogout={logout}
            />

            {/* Main Dialer or In-Call Interface */}
            <main className="flex-1 relative overflow-hidden flex flex-col">
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
                  <div className="flex px-4 pt-2 pb-1 space-x-1">
                    <button
                      onClick={() => setActiveDialerTab('keypad')}
                      className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        activeDialerTab === 'keypad'
                          ? 'bg-[#181c28] text-emerald-400 border border-[#252b3d] shadow-sm'
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
                          ? 'bg-[#181c28] text-emerald-400 border border-[#252b3d] shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Recents</span>
                      {callHistory.length > 0 && (
                        <span className="ml-1 px-1.5 py-0.2 text-[9px] rounded-full bg-zinc-800 text-zinc-400">
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
          />
        )}
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <SipProvider>
      <MainSoftphone />
    </SipProvider>
  );
};

export default App;

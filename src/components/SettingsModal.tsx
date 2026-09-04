import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, CheckCircle2, AlertTriangle, HelpCircle, Mic, Volume2, Play, Sparkles } from 'lucide-react';
import { SipConfig, ConnectionState } from '@/types';
import { audioDeviceService, AudioDevice } from '@/services/audioDeviceService';
import { soundService } from '@/services';
import { updateService } from '@/services';
import { Button, Input } from '@fluentui/react-components';

interface SettingsModalProps {
  currentConfig: SipConfig;
  connectionState: ConnectionState;
  connectionError: string | null;
  onSaveAndConnect: (config: SipConfig) => void;
  onDisconnect: () => void;
  onClose: () => void;
  onOpenUpdates?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  currentConfig,
  connectionState,
  connectionError,
  onSaveAndConnect,
  onDisconnect,
  onClose,
  onOpenUpdates,
}) => {
  const [formData, setFormData] = useState<SipConfig>({ ...currentConfig });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'credentials' | 'audio' | 'help' | 'about'>('credentials');

  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');

  useEffect(() => {
    audioDeviceService.refreshDevices();
    const updateDevices = () => {
      setInputDevices(audioDeviceService.getInputDevices());
      setOutputDevices(audioDeviceService.getOutputDevices());
      setSelectedInput(audioDeviceService.getSelectedInputId());
      setSelectedOutput(audioDeviceService.getSelectedOutputId());
    };

    updateDevices();
    const unsub = audioDeviceService.onChange(updateDevices);
    return unsub;
  }, []);

  const handleChange = (field: keyof SipConfig, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveAndConnect(formData);
  };

  const handleApplyPreset = (preset: 'asterisk' | 'freeswitch') => {
    if (preset === 'asterisk') {
      setFormData((prev) => ({
        ...prev,
        serverUrl: 'wss://127.0.0.1:8089/ws',
        sipUri: 'sip:1001@127.0.0.1',
        username: '1001',
        displayName: 'User 1001',
        stunServer: 'stun:stun.l.google.com:19302',
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        serverUrl: 'wss://127.0.0.1:7443',
        sipUri: 'sip:1000@127.0.0.1',
        username: '1000',
        displayName: 'User 1000',
        stunServer: 'stun:stun.l.google.com:19302',
      }));
    }
  };

  const handleTestAudio = () => {
    soundService.playDtmf('5', 300);
  };

  return (
    <div className="absolute inset-0 z-50 bg-[var(--surface-1)]/95 backdrop-blur-md flex flex-col justify-between p-4 select-none overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[var(--stroke-2)]">
        <div>
          <h2 className="text-base font-semibold text-[var(--fg-1)]">Settings</h2>
          <p className="text-[11px] text-[var(--fg-3)]">Configure SIP connection and audio devices</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 my-2 p-0.5 bg-[var(--surface-2)] rounded-md border border-[var(--stroke-2)]">
        <button
          type="button"
          onClick={() => setActiveTab('credentials')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'credentials'
              ? 'bg-[var(--surface-1)] text-[var(--accent)] shadow-[var(--shadow-2)]'
              : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
          }`}
        >
          Credentials
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audio')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'audio'
              ? 'bg-[var(--surface-1)] text-[var(--accent)] shadow-[var(--shadow-2)]'
              : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
          }`}
        >
          Audio
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('help')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'help'
              ? 'bg-[var(--surface-1)] text-[var(--accent)] shadow-[var(--shadow-2)]'
              : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
          }`}
        >
          PBX Guide
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('about')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'about'
              ? 'bg-[var(--surface-1)] text-[var(--accent)] shadow-[var(--shadow-2)]'
              : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
          }`}
        >
          About
        </button>
      </div>

      {activeTab === 'credentials' && (
        <form onSubmit={handleSubmit} className="space-y-3 py-1 text-xs">
          {/* Status Banner */}
          {(connectionState === 'RegistrationFailed' ||
            connectionState === 'AuthFailed' ||
            connectionState === 'CertFailed' ||
            connectionState === 'MicFailed' ||
            connectionState === 'NoReachableContact') &&
            connectionError && (
              <div className="p-2.5 rounded-md bg-[var(--danger-bg)] border border-[var(--stroke-2)] text-[var(--danger-fg)] text-[12px] flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {connectionState}: {connectionError}
                </span>
              </div>
            )}

          {(connectionState === 'Registering' ||
            connectionState === 'Reconnecting' ||
            connectionState === 'NetworkConnected' ||
            connectionState === 'TlsVerified') && (
            <div className="p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] text-[12px] font-mono">
              {connectionState}…
            </div>
          )}

          {connectionState === 'Registered' && (
            <div className="p-2.5 rounded-md bg-[var(--success-bg)] border border-[var(--stroke-2)] text-[var(--success-fg)] text-[12px] flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Registered to {formData.sipUri}</span>
            </div>
          )}

          {/* Quick Presets */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[11px] text-[var(--fg-3)] uppercase font-semibold tracking-wider">Presets</span>
            <div className="flex space-x-1.5">
              <button
                type="button"
                onClick={() => handleApplyPreset('asterisk')}
                className="px-2 py-0.5 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-4)] text-[var(--fg-2)] hover:text-[var(--accent)] border border-[var(--stroke-2)] text-[11px] transition-colors"
              >
                Asterisk
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('freeswitch')}
                className="px-2 py-0.5 rounded bg-[var(--surface-2)] hover:bg-[var(--surface-4)] text-[var(--fg-2)] hover:text-[var(--accent)] border border-[var(--stroke-2)] text-[11px] transition-colors"
              >
                FreeSWITCH
              </button>
            </div>
          </div>

          {/* Server URL */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
              WebSocket Server URL (WSS)
            </label>
            <Input
              type="text"
              required
              value={formData.serverUrl}
              onChange={(e) => handleChange('serverUrl', e.target.value)}
              placeholder="wss://pbx.example.com:8089/ws"
              appearance="outline"
              style={{ fontSize: 12, fontFamily: 'var(--font-base)' }}
            />
          </div>

          {/* SIP URI */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
              SIP Address / URI
            </label>
            <Input
              type="text"
              required
              value={formData.sipUri}
              onChange={(e) => handleChange('sipUri', e.target.value)}
              placeholder="sip:1001@pbx.example.com"
              appearance="outline"
              style={{ fontSize: 12, fontFamily: 'var(--font-base)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
                Username / Ext
              </label>
              <Input
                type="text"
                required
                value={formData.username}
                onChange={(e) => handleChange('username', e.target.value)}
                placeholder="1001"
                appearance="outline"
                style={{ fontSize: 12 }}
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
                Password / Secret
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  placeholder="••••••••"
                  appearance="outline"
                  style={{ fontSize: 12 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
              Caller ID Display Name
            </label>
            <Input
              type="text"
              value={formData.displayName || ''}
              onChange={(e) => handleChange('displayName', e.target.value)}
              placeholder="e.g. Front Desk"
              appearance="outline"
              style={{ fontSize: 12 }}
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1">
              STUN Server (WebRTC ICE)
            </label>
            <Input
              type="text"
              value={formData.stunServer || ''}
              onChange={(e) => handleChange('stunServer', e.target.value)}
              placeholder="stun:stun.l.google.com:19302"
              appearance="outline"
              style={{ fontSize: 12, fontFamily: 'var(--font-base)' }}
            />
          </div>

          <div className="pt-2 flex items-center space-x-2">
            {connectionState === 'Registered' ||
            connectionState === 'Connecting' ||
            connectionState === 'Registering' ||
            connectionState === 'Reconnecting' ? (
              <Button
                type="button"
                appearance="secondary"
                onClick={onDisconnect}
                style={{ flex: 1, color: 'var(--danger-fg)', fontWeight: 500 }}
              >
                Disconnect
              </Button>
            ) : null}
            <Button
              type="submit"
              appearance="primary"
              style={{ flex: 1, fontWeight: 600 }}
            >
              {connectionState === 'Connecting' || connectionState === 'Registering' ? 'Connecting...' : 'Save & Connect'}
            </Button>
          </div>
        </form>
      )}

      {activeTab === 'audio' && (
        <div className="py-2 text-xs space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1.5 flex items-center space-x-1.5">
              <Mic className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>Microphone (Input Device)</span>
            </label>
            <select
              value={selectedInput}
              onChange={(e) => {
                setSelectedInput(e.target.value);
                audioDeviceService.setInputDevice(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] text-[var(--fg-1)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">Default System Microphone</option>
              {inputDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[var(--fg-2)] mb-1.5 flex items-center space-x-1.5">
              <Volume2 className="w-3.5 h-3.5 text-[var(--info-fg)]" />
              <span>Speaker (Output Device)</span>
            </label>
            <select
              value={selectedOutput}
              onChange={(e) => {
                setSelectedOutput(e.target.value);
                audioDeviceService.setOutputDevice(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] text-[var(--fg-1)] text-xs focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">Default System Output</option>
              {outputDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label}
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-[var(--fg-1)]">Speaker Test</h4>
              <p className="text-[11px] text-[var(--fg-3)]">Play a test tone to verify output</p>
            </div>
            <Button
              type="button"
              appearance="secondary"
              onClick={handleTestAudio}
              icon={{ children: <Play className="w-3.5 h-3.5" /> }}
              style={{ color: 'var(--accent)' }}
            >
              Test
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'help' && (
        <div className="py-2 text-[var(--fg-2)] text-xs space-y-3">
          <div className="p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] space-y-1.5">
            <h4 className="font-semibold text-[var(--accent)] flex items-center space-x-1">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Asterisk WebRTC (PJSIP)</span>
            </h4>
            <p className="text-[11px] text-[var(--fg-3)]">
              Ensure <code className="text-[var(--fg-1)]">http.conf</code> enables <code className="text-[var(--fg-1)]">tlsenable=yes</code> and <code className="text-[var(--fg-1)]">pjsip.conf</code> sets <code className="text-[var(--fg-1)]">webrtc=yes</code>, <code className="text-[var(--fg-1)]">use_avpf=yes</code>, <code className="text-[var(--fg-1)]">media_encryption=dtls</code>.
            </p>
          </div>

          <div className="p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] space-y-1.5">
            <h4 className="font-semibold text-[var(--accent)] flex items-center space-x-1">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>FreeSWITCH WebRTC (Verto / WSS)</span>
            </h4>
            <p className="text-[11px] text-[var(--fg-3)]">
              Ensure <code className="text-[var(--fg-1)]">sip_profiles/internal.xml</code> has <code className="text-[var(--fg-1)]">ws-binding</code> or <code className="text-[var(--fg-1)]">wss-binding=":7443"</code> with valid TLS certificates configured.
            </p>
          </div>

          <div className="p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] space-y-1.5">
            <h4 className="font-semibold text-[var(--fg-1)]">Self-Signed Certificates</h4>
            <p className="text-[11px] text-[var(--fg-3)]">
              If using self-signed TLS certificates on your local PBX, open the WSS URL in your browser once (e.g. <code className="text-[var(--fg-1)]">https://your-pbx:8089/ws</code>) and accept the certificate warning.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'about' && (
        <div className="py-2 text-[var(--fg-2)] text-xs space-y-3">
          <div className="p-3 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[var(--fg-1)]">Daad Softphone</span>
              <span className="px-2 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent)] text-[11px] font-mono">
                v{updateService.getCurrentVersion()}
              </span>
            </div>
            <p className="text-[11px] text-[var(--fg-3)]">
              Cross-platform desktop SIP client built with Tauri v2, SIP.js, and React.
            </p>
          </div>

          <div className="p-3 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-[var(--fg-1)]">Auto-Update</h4>
              <p className="text-[10px] text-[var(--fg-3)]">Check GitHub for the newest releases</p>
            </div>
            <Button
              type="button"
              appearance="secondary"
              onClick={() => {
                onClose();
                if (onOpenUpdates) onOpenUpdates();
              }}
              icon={{ children: <Sparkles className="w-3.5 h-3.5" /> }}
              style={{ color: 'var(--accent)' }}
            >
              Check Updates
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

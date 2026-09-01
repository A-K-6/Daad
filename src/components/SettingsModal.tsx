import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, CheckCircle2, AlertTriangle, HelpCircle, Mic, Volume2, Play, Sparkles } from 'lucide-react';
import { SipConfig, ConnectionState } from '../types/sip';
import { audioDeviceService, AudioDevice } from '../services/audioDeviceService';
import { soundService } from '../services/soundService';
import { updateService } from '../services/updateService';

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
    <div className="absolute inset-0 z-50 bg-[#0f1117]/95 backdrop-blur-md flex flex-col justify-between p-4 select-none animate-in fade-in zoom-in-95 duration-150 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#232838]">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          <p className="text-[10px] text-zinc-400">Configure SIP connection and audio devices</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-[#1e2334] rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 my-2 p-0.5 bg-[#141824] rounded-lg border border-[#232838]">
        <button
          type="button"
          onClick={() => setActiveTab('credentials')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'credentials'
              ? 'bg-[#1f2538] text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Credentials
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audio')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'audio'
              ? 'bg-[#1f2538] text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Audio
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('help')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'help'
              ? 'bg-[#1f2538] text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          PBX Guide
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('about')}
          className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${
            activeTab === 'about'
              ? 'bg-[#1f2538] text-zinc-100 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          About
        </button>
      </div>

      {activeTab === 'credentials' && (
        <form onSubmit={handleSubmit} className="space-y-3 py-1 text-xs">
          {/* Status Banner */}
          {connectionState === 'RegistrationFailed' && connectionError && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{connectionError}</span>
            </div>
          )}

          {connectionState === 'Registered' && (
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>Registered to {formData.sipUri}</span>
            </div>
          )}

          {/* Quick Presets */}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold tracking-wider">Presets</span>
            <div className="flex space-x-1.5">
              <button
                type="button"
                onClick={() => handleApplyPreset('asterisk')}
                className="px-2 py-0.5 rounded bg-[#181c28] hover:bg-[#22283a] text-zinc-300 hover:text-emerald-400 border border-[#252b3d] text-[10px] transition-colors"
              >
                Asterisk
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('freeswitch')}
                className="px-2 py-0.5 rounded bg-[#181c28] hover:bg-[#22283a] text-zinc-300 hover:text-emerald-400 border border-[#252b3d] text-[10px] transition-colors"
              >
                FreeSWITCH
              </button>
            </div>
          </div>

          {/* Server URL */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1">
              WebSocket Server URL (WSS)
            </label>
            <input
              type="text"
              required
              value={formData.serverUrl}
              onChange={(e) => handleChange('serverUrl', e.target.value)}
              placeholder="wss://pbx.example.com:8089/ws"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#141824] border border-[#252b3d] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs"
            />
          </div>

          {/* SIP URI */}
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1">
              SIP Address / URI
            </label>
            <input
              type="text"
              required
              value={formData.sipUri}
              onChange={(e) => handleChange('sipUri', e.target.value)}
              placeholder="sip:1001@pbx.example.com"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#141824] border border-[#252b3d] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Username / Ext
              </label>
              <input
                type="text"
                required
                value={formData.username}
                onChange={(e) => handleChange('username', e.target.value)}
                placeholder="1001"
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#141824] border border-[#252b3d] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-300 mb-1">
                Password / Secret
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-2.5 py-1.5 pr-8 rounded-lg bg-[#141824] border border-[#252b3d] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1">
              Caller ID Display Name
            </label>
            <input
              type="text"
              value={formData.displayName || ''}
              onChange={(e) => handleChange('displayName', e.target.value)}
              placeholder="e.g. Front Desk"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#141824] border border-[#252b3d] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1">
              STUN Server (WebRTC ICE)
            </label>
            <input
              type="text"
              value={formData.stunServer || ''}
              onChange={(e) => handleChange('stunServer', e.target.value)}
              placeholder="stun:stun.l.google.com:19302"
              className="w-full px-2.5 py-1.5 rounded-lg bg-[#141824] border border-[#252b3d] text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 font-mono text-xs"
            />
          </div>

          <div className="pt-2 flex items-center space-x-2">
            {connectionState === 'Registered' || connectionState === 'Connecting' ? (
              <button
                type="button"
                onClick={onDisconnect}
                className="flex-1 py-2 px-3 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 font-medium text-xs transition-colors"
              >
                Disconnect
              </button>
            ) : null}
            <button
              type="submit"
              className="flex-1 py-2 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-xs shadow-md shadow-emerald-500/20 transition-all active:scale-[0.98]"
            >
              {connectionState === 'Connecting' ? 'Connecting...' : 'Save & Connect'}
            </button>
          </div>
        </form>
      )}

      {activeTab === 'audio' && (
        <div className="py-2 text-xs space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center space-x-1.5">
              <Mic className="w-3.5 h-3.5 text-emerald-400" />
              <span>Microphone (Input Device)</span>
            </label>
            <select
              value={selectedInput}
              onChange={(e) => {
                setSelectedInput(e.target.value);
                audioDeviceService.setInputDevice(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#141824] border border-[#252b3d] text-zinc-100 text-xs focus:outline-none focus:border-emerald-500"
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
            <label className="block text-[11px] font-medium text-zinc-300 mb-1.5 flex items-center space-x-1.5">
              <Volume2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Speaker (Output Device)</span>
            </label>
            <select
              value={selectedOutput}
              onChange={(e) => {
                setSelectedOutput(e.target.value);
                audioDeviceService.setOutputDevice(e.target.value);
              }}
              className="w-full px-3 py-2 rounded-xl bg-[#141824] border border-[#252b3d] text-zinc-100 text-xs focus:outline-none focus:border-emerald-500"
            >
              <option value="">Default System Output</option>
              {outputDevices.map((dev) => (
                <option key={dev.deviceId} value={dev.deviceId}>
                  {dev.label}
                </option>
              ))}
            </select>
          </div>

          <div className="p-3 rounded-xl bg-[#141824] border border-[#232838] flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-zinc-200">Speaker Test</h4>
              <p className="text-[10px] text-zinc-400">Play a test tone to verify output</p>
            </div>
            <button
              type="button"
              onClick={handleTestAudio}
              className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Test</span>
            </button>
          </div>
        </div>
      )}

      {activeTab === 'help' && (
        <div className="py-2 text-zinc-300 text-xs space-y-3">
          <div className="p-2.5 rounded-lg bg-[#141824] border border-[#232838] space-y-1.5">
            <h4 className="font-semibold text-emerald-400 flex items-center space-x-1">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Asterisk WebRTC (PJSIP)</span>
            </h4>
            <p className="text-[11px] text-zinc-400">
              Ensure <code className="text-zinc-200">http.conf</code> enables <code className="text-zinc-200">tlsenable=yes</code> and <code className="text-zinc-200">pjsip.conf</code> sets <code className="text-zinc-200">webrtc=yes</code>, <code className="text-zinc-200">use_avpf=yes</code>, <code className="text-zinc-200">media_encryption=dtls</code>.
            </p>
          </div>

          <div className="p-2.5 rounded-lg bg-[#141824] border border-[#232838] space-y-1.5">
            <h4 className="font-semibold text-emerald-400 flex items-center space-x-1">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>FreeSWITCH WebRTC (Verto / WSS)</span>
            </h4>
            <p className="text-[11px] text-zinc-400">
              Ensure <code className="text-zinc-200">sip_profiles/internal.xml</code> has <code className="text-zinc-200">ws-binding</code> or <code className="text-zinc-200">wss-binding=":7443"</code> with valid TLS certificates configured.
            </p>
          </div>

          <div className="p-2.5 rounded-lg bg-[#141824] border border-[#232838] space-y-1.5">
            <h4 className="font-semibold text-zinc-200">Self-Signed Certificates</h4>
            <p className="text-[11px] text-zinc-400">
              If using self-signed TLS certificates on your local PBX, open the WSS URL in your browser once (e.g. <code className="text-zinc-200">https://your-pbx:8089/ws</code>) and accept the certificate warning.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'about' && (
        <div className="py-2 text-zinc-300 text-xs space-y-3">
          <div className="p-3 rounded-xl bg-[#141824] border border-[#232838] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200">Daad Softphone</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-mono border border-emerald-500/20">
                v{updateService.getCurrentVersion()}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Cross-platform desktop SIP client built with Tauri v2, SIP.js, and React.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[#141824] border border-[#232838] flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-zinc-200">Auto-Update</h4>
              <p className="text-[10px] text-zinc-400">Check GitHub for the newest releases</p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onOpenUpdates) onOpenUpdates();
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Check Updates</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

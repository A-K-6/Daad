import React, { useState } from 'react';
import { Download, Terminal, Shield, Cpu, Sparkles, Check, Copy, ExternalLink } from 'lucide-react';
import { updateService } from '@/services';
import { DaadLogo } from '@/components/DaadLogo';

export const LandingHero: React.FC = () => {
  const [copiedAsterisk, setCopiedAsterisk] = useState(false);
  const [copiedFreeSwitch, setCopiedFreeSwitch] = useState(false);
  const [activeConfigTab, setActiveConfigTab] = useState<'asterisk' | 'freeswitch'>('asterisk');
  const version = updateService.getCurrentVersion();

  const asteriskConfig = `[webrtc_client]
type=endpoint
transport=transport-wss
aors=1001
auth=1001
dtls_auto_generate_cert=yes
webrtc=yes
use_avpf=yes
media_encryption=dtls
dtls_verify=fingerprint
dtls_setup=actpass
ice_support=yes
media_use_received_transport=yes
rtp_symmetric=yes
rewrite_contact=yes
force_rport=yes
allow=!all,opus,ulaw,alaw`;

  const freeswitchConfig = `<param name="ws-binding" value=":5066"/>
<param name="wss-binding" value=":7443"/>
<param name="tls-cert-dir" value="/etc/freeswitch/tls"/>
<param name="apply-candidate-acl" value="localnet.auto"/>
<param name="local-network-acl" value="localnet.auto"/>`;

  const copyToClipboard = (text: string, type: 'asterisk' | 'freeswitch') => {
    navigator.clipboard.writeText(text);
    if (type === 'asterisk') {
      setCopiedAsterisk(true);
      setTimeout(() => setCopiedAsterisk(false), 2000);
    } else {
      setCopiedFreeSwitch(true);
      setTimeout(() => setCopiedFreeSwitch(false), 2000);
    }
  };

  return (
    <div className="flex-1 max-w-2xl px-6 py-8 lg:py-12 text-zinc-100 flex flex-col justify-between overflow-y-auto">
      <div className="space-y-6">
        {/* Header Badge */}
        <div className="space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs font-mono text-emerald-400">
            <Sparkles className="w-3.5 h-3.5" />
            <span>v{version} • Tauri v2 + WebRTC</span>
          </div>

          <div className="flex items-center space-x-3.5 pt-1">
            <DaadLogo size={52} withGlow={true} />
            <div>
              <h1 className="text-3xl lg:text-5xl font-bold tracking-tight text-white">
                Daad <span className="text-zinc-500 font-normal text-xl lg:text-3xl">/ داد</span>
              </h1>
              <p className="text-[11px] lg:text-xs text-emerald-400 font-mono uppercase tracking-wider">
                Ultra-Fast Telephony & Softphone
              </p>
            </div>
          </div>
          <p className="text-sm lg:text-base text-zinc-400 max-w-lg leading-relaxed pt-1">
            Ultra-fast, minimal, modern cross-platform softphone. Zero bloat, instant launch, system tray integration, and crystal-clear WebRTC audio.
          </p>
        </div>

        {/* Download Matrix */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Download Desktop Binaries
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <a
              href={`https://github.com/A-K-6/Daad/releases/download/v${version}/Daad_${version}_aarch64.dmg`}
              className="flex items-center justify-between p-3 rounded-xl bg-[#13151f] hover:bg-[#1a1c2a] border border-white/[0.08] hover:border-emerald-500/30 transition-all group"
            >
              <div>
                <div className="text-xs font-medium text-zinc-200 group-hover:text-emerald-400">macOS</div>
                <div className="text-[10px] text-zinc-500 font-mono">Apple Silicon (.dmg)</div>
              </div>
              <Download className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
            </a>

            <a
              href={`https://github.com/A-K-6/Daad/releases/download/v${version}/Daad_${version}_x64-setup.exe`}
              className="flex items-center justify-between p-3 rounded-xl bg-[#13151f] hover:bg-[#1a1c2a] border border-white/[0.08] hover:border-emerald-500/30 transition-all group"
            >
              <div>
                <div className="text-xs font-medium text-zinc-200 group-hover:text-emerald-400">Windows</div>
                <div className="text-[10px] text-zinc-500 font-mono">64-bit (.exe / .msi)</div>
              </div>
              <Download className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
            </a>

            <a
              href={`https://github.com/A-K-6/Daad/releases/download/v${version}/Daad_${version}_amd64.AppImage`}
              className="flex items-center justify-between p-3 rounded-xl bg-[#13151f] hover:bg-[#1a1c2a] border border-white/[0.08] hover:border-emerald-500/30 transition-all group"
            >
              <div>
                <div className="text-xs font-medium text-zinc-200 group-hover:text-emerald-400">Linux</div>
                <div className="text-[10px] text-zinc-500 font-mono">AppImage / .deb</div>
              </div>
              <Download className="w-4 h-4 text-zinc-500 group-hover:text-emerald-400" />
            </a>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div className="p-3 rounded-xl bg-[#13151f] border border-white/[0.06] space-y-1">
            <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-200">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>Rust Native & Tauri v2</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              ~30MB memory footprint, 60fps animations, close-to-tray background state, and zero bloat.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-[#13151f] border border-white/[0.06] space-y-1">
            <div className="flex items-center space-x-2 text-xs font-semibold text-zinc-200">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>Pure WebRTC & WSS</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              SIP.js v0.21+ session state machine, DTLS/SRTP encryption, STUN ICE resolution, and DTMF synthesis.
            </p>
          </div>
        </div>

        {/* Quick CLI snippet */}
        <div className="space-y-1.5 pt-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Run with Bun
          </h3>
          <div className="p-2.5 rounded-xl bg-[#0e1017] border border-white/[0.08] font-mono text-xs text-zinc-300 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>bun run tauri dev</span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText('bun run tauri dev');
              }}
              className="text-zinc-500 hover:text-zinc-300 text-[10px]"
            >
              Copy
            </button>
          </div>
        </div>

        {/* PBX Config Tabs */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              PBX Quickstart Configurations
            </h3>
            <div className="flex space-x-1">
              <button
                onClick={() => setActiveConfigTab('asterisk')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                  activeConfigTab === 'asterisk' ? 'bg-[#1f2538] text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                Asterisk
              </button>
              <button
                onClick={() => setActiveConfigTab('freeswitch')}
                className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                  activeConfigTab === 'freeswitch' ? 'bg-[#1f2538] text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                FreeSWITCH
              </button>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#0e1017] border border-white/[0.08] text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
              <span className="font-mono text-[11px] text-emerald-400">
                {activeConfigTab === 'asterisk' ? 'pjsip.conf' : 'autoload_configs/sip_profiles/internal.xml'}
              </span>
              <button
                onClick={() =>
                  copyToClipboard(
                    activeConfigTab === 'asterisk' ? asteriskConfig : freeswitchConfig,
                    activeConfigTab
                  )
                }
                className="flex items-center space-x-1 text-[10px] text-zinc-400 hover:text-zinc-200"
              >
                {(activeConfigTab === 'asterisk' ? copiedAsterisk : copiedFreeSwitch) ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>
                  {(activeConfigTab === 'asterisk' ? copiedAsterisk : copiedFreeSwitch) ? 'Copied' : 'Copy'}
                </span>
              </button>
            </div>
            <pre className="mt-2 text-[10px] font-mono text-zinc-400 overflow-x-auto max-h-24">
              {activeConfigTab === 'asterisk' ? asteriskConfig : freeswitchConfig}
            </pre>
          </div>
        </div>
      </div>

      {/* Footer links */}
      <div className="pt-6 flex items-center justify-between text-xs text-zinc-500 border-t border-white/[0.06] mt-6">
        <span>MIT License • A-K-6 / Daad</span>
        <a
          href="https://github.com/A-K-6/Daad"
          target="_blank"
          rel="noreferrer"
          className="flex items-center space-x-1 text-zinc-400 hover:text-emerald-400 transition-colors"
        >
          <span>GitHub Repository</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};

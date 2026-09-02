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
    <div className="flex-1 max-w-2xl px-6 py-8 lg:py-12 text-[var(--fg-1)] flex flex-col justify-between overflow-y-auto">
      <div className="space-y-6">
        {/* Header Badge */}
        <div className="space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[var(--accent-subtle)] border border-[var(--stroke-2)] text-xs font-mono text-[var(--accent)]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>v{version} • Tauri v2 + WebRTC</span>
          </div>

          <div className="flex items-center space-x-3.5 pt-1">
            <DaadLogo size={52} withGlow={true} />
            <div>
              <h1 className="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg-1)]">
                Daad <span className="text-[var(--fg-3)] font-normal text-xl lg:text-3xl">/ داد</span>
              </h1>
              <p className="text-[11px] lg:text-xs text-[var(--accent)] font-mono uppercase tracking-wider">
                Ultra-Fast Telephony & Softphone
              </p>
            </div>
          </div>
          <p className="text-sm lg:text-base text-[var(--fg-2)] max-w-lg leading-relaxed pt-1">
            Ultra-fast, minimal, modern cross-platform softphone. Zero bloat, instant launch, system tray integration, and crystal-clear WebRTC audio.
          </p>
        </div>

        {/* Download Matrix */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-3)]">
            Download Desktop Binaries
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <a
              href={`https://github.com/A-K-6/Daad/releases/download/v${version}/Daad_${version}_aarch64.dmg`}
              className="flex items-center justify-between p-3 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] shadow-[var(--shadow-2)] transition-all group"
            >
              <div>
                <div className="text-sm font-medium text-[var(--fg-1)] group-hover:text-[var(--accent)]">macOS</div>
                <div className="text-[11px] text-[var(--fg-3)] font-mono">Apple Silicon (.dmg)</div>
              </div>
              <Download className="w-4 h-4 text-[var(--fg-3)] group-hover:text-[var(--accent)]" />
            </a>

            <a
              href={`https://github.com/A-K-6/Daad/releases/download/v${version}/Daad_${version}_x64-setup.exe`}
              className="flex items-center justify-between p-3 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] shadow-[var(--shadow-2)] transition-all group"
            >
              <div>
                <div className="text-sm font-medium text-[var(--fg-1)] group-hover:text-[var(--accent)]">Windows</div>
                <div className="text-[11px] text-[var(--fg-3)] font-mono">64-bit (.exe / .msi)</div>
              </div>
              <Download className="w-4 h-4 text-[var(--fg-3)] group-hover:text-[var(--accent)]" />
            </a>

            <a
              href={`https://github.com/A-K-6/Daad/releases/download/v${version}/Daad_${version}_amd64.AppImage`}
              className="flex items-center justify-between p-3 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] shadow-[var(--shadow-2)] transition-all group"
            >
              <div>
                <div className="text-sm font-medium text-[var(--fg-1)] group-hover:text-[var(--accent)]">Linux</div>
                <div className="text-[11px] text-[var(--fg-3)] font-mono">AppImage / .deb</div>
              </div>
              <Download className="w-4 h-4 text-[var(--fg-3)] group-hover:text-[var(--accent)]" />
            </a>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          <div className="p-3 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] shadow-[var(--shadow-2)] space-y-1">
            <div className="flex items-center space-x-2 text-sm font-semibold text-[var(--fg-1)]">
              <Cpu className="w-4 h-4 text-[var(--accent)]" />
              <span>Rust Native & Tauri v2</span>
            </div>
            <p className="text-[12px] text-[var(--fg-3)] leading-relaxed">
              ~30MB memory footprint, 60fps animations, close-to-tray background state, and zero bloat.
            </p>
          </div>

          <div className="p-3 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] shadow-[var(--shadow-2)] space-y-1">
            <div className="flex items-center space-x-2 text-sm font-semibold text-[var(--fg-1)]">
              <Shield className="w-4 h-4 text-[var(--accent)]" />
              <span>Pure WebRTC & WSS</span>
            </div>
            <p className="text-[12px] text-[var(--fg-3)] leading-relaxed">
              SIP.js v0.21+ session state machine, DTLS/SRTP encryption, STUN ICE resolution, and DTMF synthesis.
            </p>
          </div>
        </div>

        {/* Quick CLI snippet */}
        <div className="space-y-1.5 pt-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-3)]">
            Run with Bun
          </h3>
          <div className="p-2.5 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] font-mono text-xs text-[var(--fg-2)] flex items-center justify-between shadow-[var(--shadow-2)]">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-[var(--accent)]" />
              <span>bun run tauri dev</span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText('bun run tauri dev');
              }}
              className="text-[var(--fg-3)] hover:text-[var(--fg-1)] text-[11px]"
            >
              Copy
            </button>
          </div>
        </div>

        {/* PBX Config Tabs */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-3)]">
              PBX Quickstart Configurations
            </h3>
            <div className="flex space-x-1">
              <button
                onClick={() => setActiveConfigTab('asterisk')}
                className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                  activeConfigTab === 'asterisk'
                    ? 'bg-[var(--surface-4)] text-[var(--accent)] border border-[var(--stroke-2)]'
                    : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                }`}
              >
                Asterisk
              </button>
              <button
                onClick={() => setActiveConfigTab('freeswitch')}
                className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                  activeConfigTab === 'freeswitch'
                    ? 'bg-[var(--surface-4)] text-[var(--accent)] border border-[var(--stroke-2)]'
                    : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
                }`}
              >
                FreeSWITCH
              </button>
            </div>
          </div>

          <div className="p-3 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] shadow-[var(--shadow-2)] text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--stroke-3)]">
              <span className="font-mono text-[11px] text-[var(--accent)]">
                {activeConfigTab === 'asterisk' ? 'pjsip.conf' : 'autoload_configs/sip_profiles/internal.xml'}
              </span>
              <button
                onClick={() =>
                  copyToClipboard(
                    activeConfigTab === 'asterisk' ? asteriskConfig : freeswitchConfig,
                    activeConfigTab
                  )
                }
                className="flex items-center space-x-1 text-[11px] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              >
                {(activeConfigTab === 'asterisk' ? copiedAsterisk : copiedFreeSwitch) ? (
                  <Check className="w-3 h-3 text-[var(--success-fg)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>
                  {(activeConfigTab === 'asterisk' ? copiedAsterisk : copiedFreeSwitch) ? 'Copied' : 'Copy'}
                </span>
              </button>
            </div>
            <pre className="mt-2 text-[11px] font-mono text-[var(--fg-3)] overflow-x-auto max-h-24">
              {activeConfigTab === 'asterisk' ? asteriskConfig : freeswitchConfig}
            </pre>
          </div>
        </div>
      </div>

      {/* Footer links */}
      <div className="pt-6 flex items-center justify-between text-xs text-[var(--fg-3)] border-t border-[var(--stroke-3)] mt-6">
        <span>MIT License • A-K-6 / Daad</span>
        <a
          href="https://github.com/A-K-6/Daad"
          target="_blank"
          rel="noreferrer"
          className="flex items-center space-x-1 text-[var(--fg-3)] hover:text-[var(--accent)] transition-colors"
        >
          <span>GitHub Repository</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
};

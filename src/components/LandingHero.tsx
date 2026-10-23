import React from 'react';
import { Download, Terminal, Shield, Cpu, Sparkles, ExternalLink } from 'lucide-react';
import { updateService } from '@/services';
import { DaadLogo } from '@/components/DaadLogo';

export const LandingHero: React.FC = () => {
  const version = updateService.getCurrentVersion();
  const downloads = [
    { platform: 'macOS', detail: 'Apple Silicon (.dmg)', asset: `Daad_${version}_aarch64.dmg` },
    { platform: 'Windows', detail: 'x64 installer (.exe)', asset: `Daad_${version}_x64-setup.exe` },
    { platform: 'Linux', detail: 'x64 (.AppImage)', asset: `Daad_${version}_amd64.AppImage` },
    { platform: 'Android', detail: 'arm64 signed app (.apk)', asset: `Daad_${version}_android_arm64.apk` },
  ];

  return (
    <div className="flex-1 max-w-2xl px-6 py-8 lg:py-12 text-[var(--fg-1)] flex flex-col justify-between overflow-y-auto">
      <div className="space-y-6">
        {/* Header Badge */}
        <div className="space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[var(--accent-subtle)] border border-[var(--stroke-2)] text-xs font-mono text-[var(--accent)]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>v{version} • Tauri v2 + PJSIP</span>
          </div>

          <div className="flex items-center space-x-3.5 pt-1">
            <DaadLogo size={52} withGlow={true} />
            <div>
              <h1 className="text-3xl lg:text-5xl font-bold tracking-tight text-[var(--fg-1)]">
                Daad <span className="text-[var(--fg-3)] font-normal text-xl lg:text-3xl">/ داد</span>
              </h1>
              <p className="text-[11px] lg:text-xs text-[var(--accent)] font-mono uppercase tracking-wider">
                Native Softphone
              </p>
            </div>
          </div>
          <p className="text-sm lg:text-base text-[var(--fg-2)] max-w-lg leading-relaxed pt-1">
            A small native softphone for macOS, Windows, Linux, and Android. One account, one call, encrypted audio, and a simple keypad. Version 0.7 is for validation and early testing.
          </p>
        </div>

        {/* Download Matrix */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-3)]">
            Download v{version}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {downloads.map(({ platform, detail, asset }) => (
            <a
              key={platform}
              href={`https://github.com/A-K-6/Daad/releases/download/v${version}/${asset}`}
              className="flex items-center justify-between p-3 rounded-md bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] shadow-[var(--shadow-2)] transition-all group"
            >
              <div>
                <div className="text-sm font-medium text-[var(--fg-1)] group-hover:text-[var(--accent)]">{platform}</div>
                <div className="text-[11px] text-[var(--fg-3)] font-mono">{detail}</div>
              </div>
              <Download className="w-4 h-4 text-[var(--fg-3)] group-hover:text-[var(--accent)]" />
            </a>
            ))}
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
              Native audio devices, secure account storage, and light or dark themes.
            </p>
          </div>

          <div className="p-3 rounded-md bg-[var(--surface-2)] border border-[var(--stroke-2)] shadow-[var(--shadow-2)] space-y-1">
            <div className="flex items-center space-x-2 text-sm font-semibold text-[var(--fg-1)]">
              <Shield className="w-4 h-4 text-[var(--accent)]" />
              <span>SIP/TLS & SRTP</span>
            </div>
            <p className="text-[12px] text-[var(--fg-3)] leading-relaxed">
              PJSIP 2.17, verified TLS, mandatory SDES-SRTP, G.711 audio, and RFC 4733 keypad tones.
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

        <p className="text-xs text-[var(--fg-3)]">
          Requires a SIP account on a PBX supporting TLS and SDES-SRTP.
          iOS and Intel Mac packages are outside this release. Android requires reopening after force-stop.
        </p>
      </div>

      {/* Footer links */}
      <div className="pt-6 flex items-center justify-between text-xs text-[var(--fg-3)] border-t border-[var(--stroke-3)] mt-6">
        <span>GPL-3.0-or-later • A-K-6 / Daad</span>
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

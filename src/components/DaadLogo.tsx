import React from 'react';

interface DaadLogoProps {
  size?: number | string;
  className?: string;
  showText?: boolean;
  withGlow?: boolean;
}

export const DaadLogo: React.FC<DaadLogoProps> = ({
  size = 32,
  className = '',
  showText = false,
  withGlow = true,
}) => {
  return (
    <div className={`inline-flex items-center space-x-2.5 select-none ${className}`}>
      <div
        style={{ width: size, height: size }}
        className="relative shrink-0 flex items-center justify-center"
      >
        {withGlow && (
          <div
            className="absolute inset-0 rounded-xl bg-[var(--accent-subtle)] blur-md -z-10"
            style={{ filter: 'blur(8px)' }}
          />
        )}
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-sm"
        >
          {/* Fluent Backplate */}
          <rect
            x="2"
            y="2"
            width="44"
            height="44"
            rx="11"
            fill="var(--surface-2)"
            stroke="var(--stroke-2)"
            strokeWidth="1.5"
          />

          {/* Geometric Inner Highlight */}
          <rect
            x="3"
            y="3"
            width="42"
            height="42"
            rx="10"
            fill="url(#daad_bg_grad)"
            opacity="0.5"
          />

          {/* Precise Letter 'D' Outer Path */}
          <path
            d="M14 12H24C30.6274 12 36 17.3726 36 24C36 30.6274 30.6274 36 24 36H14V12Z"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Audio Waveform Pulse Passing Through */}
          <path
            d="M10 24H15L17 19L20 29L23 16L26 31L29 20L31 26L33 24H38"
            stroke="var(--accent)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Left Signal Beacon Dot */}
          <circle cx="10" cy="24" r="1.5" fill="var(--accent)" />

          {/* Gradients */}
          <defs>
            <linearGradient id="daad_bg_grad" x1="2" y1="2" x2="46" y2="46" gradientUnits="userSpaceOnUse">
              <stop stopColor="var(--accent)" stopOpacity="0.18" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0.03" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center space-x-1.5">
            <span className="font-bold tracking-tight text-[var(--fg-1)] text-sm font-sans">
              DAAD
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
          </div>
          <span className="text-[10px] text-[var(--fg-3)] font-mono tracking-wider uppercase -mt-0.5">
            Softphone
          </span>
        </div>
      )}
    </div>
  );
};

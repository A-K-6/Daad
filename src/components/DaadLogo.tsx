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
            className="absolute inset-0 rounded-xl bg-emerald-500/20 blur-md -z-10 animate-pulse"
            style={{ filter: 'blur(8px)' }}
          />
        )}
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-md"
        >
          {/* Obsidian Beveled Backplate */}
          <rect
            x="2"
            y="2"
            width="44"
            height="44"
            rx="12"
            fill="#0c0e15"
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth="1.5"
          />

          {/* Geometric Inner Glow */}
          <rect
            x="3"
            y="3"
            width="42"
            height="42"
            rx="11"
            fill="url(#daad_bg_grad)"
            opacity="0.4"
          />

          {/* Precision Neon Letter 'D' Outer Path */}
          <path
            d="M14 12H24C30.6274 12 36 17.3726 36 24C36 30.6274 30.6274 36 24 36H14V12Z"
            stroke="#10b981"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-400"
          />

          {/* Audio Waveform Pulse Passing Through */}
          <path
            d="M10 24H15L17 19L20 29L23 16L26 31L29 20L31 26L33 24H38"
            stroke="#34d399"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Left Signal Beacon Dot */}
          <circle cx="10" cy="24" r="1.5" fill="#34d399" />

          {/* Gradients */}
          <defs>
            <linearGradient id="daad_bg_grad" x1="2" y1="2" x2="46" y2="46" gradientUnits="userSpaceOnUse">
              <stop stopColor="#10b981" stopOpacity="0.3" />
              <stop offset="1" stopColor="#06b6d4" stopOpacity="0.05" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center space-x-1.5">
            <span className="font-bold tracking-tight text-zinc-100 text-sm font-sans">
              DAAD
            </span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
          </div>
          <span className="text-[10px] text-zinc-500 font-mono tracking-wider uppercase -mt-0.5">
            Softphone
          </span>
        </div>
      )}
    </div>
  );
};

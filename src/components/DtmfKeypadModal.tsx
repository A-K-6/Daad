import React, { useState } from 'react';
import { X, Delete } from 'lucide-react';
import { soundService } from '@/services';
import { Button } from '@fluentui/react-components';

interface DtmfKeypadModalProps {
  onSendTone: (tone: string) => void;
  onClose: () => void;
}

interface DtmfKey {
  digit: string;
  letters?: string;
}

const DTMF_KEYS: DtmfKey[] = [
  { digit: '1', letters: '' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: '' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: '' },
];

export const DtmfKeypadModal: React.FC<DtmfKeypadModalProps> = ({
  onSendTone,
  onClose,
}) => {
  const [toneHistory, setToneHistory] = useState<string[]>([]);

  const handleKeyClick = (key: string) => {
    soundService.playDtmf(key);
    setToneHistory((prev) => [...prev.slice(-15), key]);
    onSendTone(key);
  };

  const handleClearHistory = () => {
    setToneHistory([]);
  };

  return (
    <div className="absolute inset-0 bg-[var(--surface-1)]/98 backdrop-blur-md z-30 flex flex-col justify-between p-5 select-none animate-in fade-in duration-150">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--stroke-2)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--fg-1)]">DTMF Keypad</h3>
          <p className="text-[10px] text-[var(--fg-3)] font-medium">In-call touch tones for automated menus</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded-md transition-colors"
          title="Close Keypad"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Sent Tones Monitor */}
      <div className="flex items-center justify-between min-h-[36px] px-3 py-1.5 my-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--stroke-2)]">
        <div className="flex items-center space-x-1.5 overflow-x-auto min-w-0 pr-1">
          <span className="text-[10px] uppercase font-semibold text-[var(--fg-3)] shrink-0">Sent:</span>
          {toneHistory.length > 0 ? (
            <span className="font-mono text-xs font-semibold text-[var(--accent)] tracking-widest truncate">
              {toneHistory.join(' ')}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--fg-disabled)] italic font-mono">Press keys below...</span>
          )}
        </div>
        {toneHistory.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="p-1 text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors shrink-0"
            title="Clear tone history"
          >
            <Delete className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 3x4 Numeric Keypad */}
      <div className="grid grid-cols-3 gap-2.5 my-auto max-w-[270px] mx-auto w-full">
        {DTMF_KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            aria-label={digit}
            onClick={() => handleKeyClick(digit)}
            className="flex flex-col items-center justify-center h-13 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-4)] active:bg-[var(--surface-4)] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] text-[var(--fg-1)] hover:text-[var(--accent)] transition-all active:scale-[0.96] shadow-[var(--shadow-2)] group cursor-pointer"
          >
            <span className="text-lg font-semibold group-hover:text-[var(--accent)] leading-none">
              {digit}
            </span>
            {letters ? (
              <span className="text-[8px] font-medium text-[var(--fg-3)] tracking-widest uppercase mt-0.5 leading-none">
                {letters}
              </span>
            ) : (
              <span className="h-[8px] mt-0.5" />
            )}
          </button>
        ))}
      </div>

      {/* Bottom Dismiss */}
      <div className="pt-2 border-t border-[var(--stroke-2)]">
        <Button
          onClick={onClose}
          appearance="secondary"
          style={{ width: '100%', fontWeight: 500, fontSize: 13, height: 36 }}
        >
          Done
        </Button>
      </div>
    </div>
  );
};


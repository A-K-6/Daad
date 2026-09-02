import React, { useState, useEffect, useCallback } from 'react';
import { Phone, Delete } from 'lucide-react';
import { soundService } from '@/services';
import { ConnectionState } from '@/types';

interface DialerPadProps {
  connectionState: ConnectionState;
  onCall: (target: string) => void;
  onOpenSettings: () => void;
}

interface KeypadButton {
  digit: string;
  letters?: string;
}

const KEYPAD_KEYS: KeypadButton[] = [
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

export const DialerPad: React.FC<DialerPadProps> = ({
  connectionState,
  onCall,
  onOpenSettings,
}) => {
  const [inputNumber, setInputNumber] = useState<string>('');

  const handleKeyPress = useCallback((digit: string) => {
    soundService.playDtmf(digit);
    setInputNumber((prev) => prev + digit);
  }, []);

  const handleBackspace = useCallback(() => {
    setInputNumber((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setInputNumber('');
  }, []);

  const handleDial = useCallback(() => {
    if (!inputNumber.trim()) return;
    if (connectionState !== 'Registered') {
      onOpenSettings();
      return;
    }
    onCall(inputNumber.trim());
  }, [inputNumber, connectionState, onCall, onOpenSettings]);

  // Physical keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if (/^[0-9*#+]$/.test(e.key)) {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter') {
        handleDial();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyPress, handleBackspace, handleDial, handleClear]);

  return (
    <div className="flex flex-col h-full justify-between px-5 py-3 select-none">
      {/* Target Number Display */}
      <div className="flex flex-col items-center justify-center my-1 relative">
        <div className="w-full flex items-center justify-center px-2 min-h-[52px]">
          <span
            data-testid="dial-display"
            className={`font-mono font-medium tracking-wider text-[var(--fg-1)] transition-all text-center break-all ${
              inputNumber.length > 14
                ? 'text-xl'
                : inputNumber.length > 9
                ? 'text-2xl'
                : 'text-3xl'
            }`}
          >
            {inputNumber || (
              <span className="text-[var(--fg-disabled)] font-sans text-base font-normal">Enter number...</span>
            )}
          </span>
        </div>

        {inputNumber.length > 0 && (
          <div className="flex items-center space-x-2 mt-1">
            <button
              onClick={handleBackspace}
              className="p-1 text-[var(--fg-3)] hover:text-[var(--fg-1)] transition-colors rounded"
              title="Backspace"
            >
              <Delete className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleClear}
              className="px-1.5 py-0.5 text-[11px] text-[var(--fg-3)] hover:text-[var(--fg-1)] font-mono uppercase transition-colors"
              title="Clear"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* 3x4 Dialpad Grid */}
      <div className="grid grid-cols-3 gap-2.5 max-w-[270px] mx-auto w-full">
        {KEYPAD_KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            onClick={() => handleKeyPress(digit)}
            className="flex flex-col items-center justify-center h-13 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--surface-4)] active:bg-[var(--surface-4)] active:scale-[0.96] border border-[var(--stroke-2)] hover:border-[var(--stroke-1)] transition-all shadow-[var(--shadow-2)] group"
          >
            <span className="text-lg font-medium text-[var(--fg-1)] group-hover:text-[var(--accent)] transition-colors leading-none">
              {digit}
            </span>
            {letters ? (
              <span className="text-[8px] font-semibold text-[var(--fg-3)] tracking-wider uppercase mt-1 leading-none">
                {letters}
              </span>
            ) : (
              <span className="h-[8px] mt-1" />
            )}
          </button>
        ))}
      </div>

      {/* Call Action Button */}
      <div className="flex justify-center items-center pt-2 pb-1">
        <button
          onClick={handleDial}
          disabled={!inputNumber.trim()}
          className={`flex items-center justify-center w-14 h-14 rounded-full shadow-[var(--shadow-8)] transition-all active:scale-95 ${
            inputNumber.trim()
              ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] cursor-pointer'
              : 'bg-[var(--surface-4)] text-[var(--fg-disabled)] cursor-not-allowed border border-[var(--stroke-2)]'
          }`}
          title={
            connectionState === 'Registered'
              ? 'Initiate Call'
              : 'Connect SIP in Settings to make calls'
          }
        >
          <Phone className="w-5 h-5 fill-current" />
        </button>
      </div>
    </div>
  );
};

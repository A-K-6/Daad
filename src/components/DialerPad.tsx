import React, { useState, useEffect, useCallback } from 'react';
import { Phone, Delete } from 'lucide-react';
import { soundService } from '../services/soundService';
import { ConnectionState } from '../types/sip';

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
  { digit: '1', letters: ' ' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*', letters: ' ' },
  { digit: '0', letters: '+' },
  { digit: '#', letters: ' ' },
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
      // Don't capture when typing in modal inputs
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
    <div className="flex flex-col h-full justify-between p-4 select-none">
      {/* Target Number Display */}
      <div className="flex flex-col items-center justify-center my-2 relative">
        <div className="w-full flex items-center justify-center px-4 min-h-[48px]">
          <span
            data-testid="dial-display"
            className={`font-mono font-medium tracking-wider text-zinc-100 transition-all text-center break-all ${
              inputNumber.length > 14
                ? 'text-xl'
                : inputNumber.length > 9
                ? 'text-2xl'
                : 'text-3xl'
            }`}
          >
            {inputNumber || (
              <span className="text-zinc-600 font-sans text-lg">Enter number...</span>
            )}
          </span>
        </div>

        {inputNumber.length > 0 && (
          <div className="flex items-center space-x-2 mt-1">
            <button
              onClick={handleBackspace}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Backspace"
            >
              <Delete className="w-4 h-4" />
            </button>
            <button
              onClick={handleClear}
              className="px-2 py-0.5 text-[11px] text-zinc-500 hover:text-zinc-300 font-mono uppercase transition-colors"
              title="Clear"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* 3x4 Dialpad Grid */}
      <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto w-full">
        {KEYPAD_KEYS.map(({ digit, letters }) => (
          <button
            key={digit}
            onClick={() => handleKeyPress(digit)}
            className="flex flex-col items-center justify-center h-14 rounded-2xl bg-[#161a26] hover:bg-[#1e2334] active:bg-[#282f45] active:scale-95 border border-[#232838] transition-all shadow-sm group"
          >
            <span className="text-xl font-medium text-zinc-100 group-hover:text-emerald-400 transition-colors leading-none">
              {digit}
            </span>
            <span className="text-[9px] font-semibold text-zinc-400 tracking-widest uppercase mt-1 leading-none">
              {letters}
            </span>
          </button>
        ))}
      </div>

      {/* Call Action Button */}
      <div className="flex justify-center items-center pt-3 pb-2">
        <button
          onClick={handleDial}
          disabled={!inputNumber.trim()}
          className={`flex items-center justify-center w-16 h-16 rounded-full shadow-lg transition-all active:scale-95 ${
            inputNumber.trim()
              ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-emerald-500/25 hover:shadow-emerald-500/40 cursor-pointer'
              : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
          }`}
          title={
            connectionState === 'Registered'
              ? 'Initiate Call'
              : 'Connect SIP in Settings to make calls'
          }
        >
          <Phone className="w-7 h-7 fill-current" />
        </button>
      </div>
    </div>
  );
};

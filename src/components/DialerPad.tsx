import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Phone, Delete, Copy, ClipboardPaste, Check, RotateCcw } from 'lucide-react';
import { soundService, callHistoryService } from '@/services';
import { validateDialTarget } from '@/services/nativeSipClient';
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
  const [copied, setCopied] = useState<boolean>(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dialError, setDialError] = useState<string | null>(null);

  const zeroTimerRef = useRef<NodeJS.Timeout | null>(null);
  const zeroLongPressedRef = useRef<boolean>(false);

  const flashKey = useCallback((key: string) => {
    setActiveKey(key);
    setTimeout(() => {
      setActiveKey((curr) => (curr === key ? null : curr));
    }, 120);
  }, []);

  const handleKeyPress = useCallback((digit: string) => {
    soundService.playDtmf(digit);
    flashKey(digit);
    setDialError(null);
    setInputNumber((prev) => prev + digit);
  }, [flashKey]);

  const handleBackspace = useCallback(() => {
    setInputNumber((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setInputNumber('');
  }, []);

  const handleCopy = async () => {
    if (!inputNumber) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inputNumber);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  const handlePaste = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const cleaned = text.replace(/[^0-9*#+]/g, '');
        if (cleaned) {
          setInputNumber((prev) => prev + cleaned);
        }
      }
    } catch (err) {
      console.warn('Clipboard read failed:', err);
    }
  };

  const handleRedial = useCallback(() => {
    const records = callHistoryService.getRecords();
    if (records.length > 0) {
      setInputNumber(records[0].target);
      soundService.playDtmf('1');
    }
  }, []);

  const handleDial = useCallback(() => {
    const target = inputNumber.trim();
    if (!target) {
      handleRedial();
      return;
    }
    const v = validateDialTarget(target);
    if (!v.ok) {
      setDialError(v.error);
      return;
    }
    setDialError(null);
    if (connectionState !== 'Registered') {
      onOpenSettings();
      return;
    }
    onCall(target);
  }, [inputNumber, connectionState, onCall, onOpenSettings, handleRedial]);

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

  // Long press handling for '0' to output '+'
  const handleDigitMouseDown = (digit: string) => {
    if (digit === '0') {
      zeroLongPressedRef.current = false;
      zeroTimerRef.current = setTimeout(() => {
        zeroLongPressedRef.current = true;
        soundService.playDtmf('#');
        flashKey('0');
        setInputNumber((prev) => prev + '+');
      }, 500);
    }
  };

  const handleDigitMouseUp = (digit: string) => {
    if (digit === '0') {
      if (zeroTimerRef.current) {
        clearTimeout(zeroTimerRef.current);
        zeroTimerRef.current = null;
      }
    }
  };

  const handleDigitClick = (digit: string) => {
    if (digit === '0' && zeroLongPressedRef.current) {
      zeroLongPressedRef.current = false;
      return;
    }
    handleKeyPress(digit);
  };

  const recentRecords = callHistoryService.getRecords();
  const hasRecentHistory = recentRecords.length > 0;

  return (
    <div className="flex flex-col h-full justify-between px-5 py-3 select-none">
      {/* Target Number Display & Utilities */}
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

        {/* Input Action Toolbar (Copy, Paste, Backspace, Clear) */}
        <div className="flex items-center space-x-2 mt-1 min-h-[26px]">
          {inputNumber.length > 0 ? (
            <>
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1 px-1.5 py-0.5 text-[11px] text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded transition-colors"
                title="Copy number"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span className="text-[10px] font-mono">{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                onClick={handleBackspace}
                className="p-1 text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] transition-colors rounded"
                title="Backspace"
              >
                <Delete className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={handleClear}
                className="px-1.5 py-0.5 text-[11px] text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] font-mono uppercase rounded transition-colors"
                title="Clear"
              >
                Clear
              </button>
            </>
          ) : (
            <div className="flex items-center space-x-3 text-[11px] text-[var(--fg-3)]">
              <button
                onClick={handlePaste}
                className="flex items-center space-x-1 px-2 py-0.5 hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded transition-colors"
                title="Paste from clipboard"
              >
                <ClipboardPaste className="w-3 h-3" />
                <span className="text-[10px] font-mono">Paste</span>
              </button>
              {hasRecentHistory && (
                <button
                  onClick={handleRedial}
                  className="flex items-center space-x-1 px-2 py-0.5 hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] rounded transition-colors"
                  title={`Redial ${recentRecords[0].target}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span className="text-[10px] font-mono">Redial</span>
                </button>
              )}
            </div>
          )}
        </div>
        {dialError && (
          <p role="alert" className="text-[11px] text-rose-400 font-mono text-center mt-1">
            {dialError} Use 3–8 digits, no leading zero.
          </p>
        )}
        {!dialError && inputNumber && (
          <p className="text-[10px] text-zinc-500 font-mono text-center mt-1">
            Extension format: 3–8 digits, no leading zero
          </p>
        )}
      </div>

      {/* 3x4 Dialpad Grid */}
      <div className="grid grid-cols-3 gap-2.5 max-w-[270px] mx-auto w-full">
        {KEYPAD_KEYS.map(({ digit, letters }) => {
          const isFlashed = activeKey === digit;
          return (
            <button
              key={digit}
              onClick={() => handleDigitClick(digit)}
              onMouseDown={() => handleDigitMouseDown(digit)}
              onMouseUp={() => handleDigitMouseUp(digit)}
              onTouchStart={() => handleDigitMouseDown(digit)}
              onTouchEnd={() => handleDigitMouseUp(digit)}
              className={`flex flex-col items-center justify-center h-13 rounded-xl border transition-all active:scale-[0.95] shadow-[var(--shadow-2)] cursor-pointer group select-none ${
                isFlashed
                  ? 'bg-[var(--surface-4)] border-[var(--accent)] text-[var(--accent)] scale-[0.95] ring-2 ring-[var(--accent)]/30'
                  : 'bg-[var(--surface-2)] hover:bg-[var(--surface-4)] border-[var(--stroke-2)] hover:border-[var(--stroke-1)]'
              }`}
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
          );
        })}
      </div>

      {/* Call Action Button */}
      <div className="flex justify-center items-center pt-2 pb-1">
        <button
          onClick={handleDial}
          disabled={!inputNumber.trim() && !hasRecentHistory}
          className={`flex items-center justify-center w-14 h-14 rounded-full shadow-[var(--shadow-8)] transition-all active:scale-95 cursor-pointer group ${
            inputNumber.trim()
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_16px_rgba(16,185,129,0.35)]'
              : hasRecentHistory
              ? 'bg-[var(--surface-2)] hover:bg-[var(--surface-4)] text-[var(--accent)] border border-[var(--stroke-2)]'
              : 'bg-[var(--surface-4)] text-[var(--fg-disabled)] cursor-not-allowed border border-[var(--stroke-2)]'
          }`}
          title={
            connectionState === 'Registered'
              ? 'Initiate Call'
              : 'Connect SIP in Settings to make calls'
          }
        >
          <Phone className="w-5 h-5 fill-current transition-transform group-hover:scale-110" />
        </button>
      </div>
    </div>
  );
};


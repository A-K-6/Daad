import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/context';

/**
 * Theme toggle that lives inside widget chrome (header rows), never as a
 * floating overlay — in the fixed 360x600 Tauri window the widget fills the
 * screen, so any screen-corner overlay lands on top of real controls
 * (previously covered the Settings gear).
 */
export const ThemeToggleButton: React.FC<{ className?: string }> = ({ className }) => {
  const { isDark, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      data-testid="theme-toggle"
      className={
        className ||
        'p-1.5 rounded-md text-[var(--fg-3)] hover:text-[var(--fg-1)] hover:bg-[var(--surface-4)] transition-all active:scale-95'
      }
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};

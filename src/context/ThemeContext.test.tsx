import { StrictMode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@/context/ThemeContext';
import { ThemeToggleButton } from '@/components/ThemeToggleButton';

const mountTheme = () => render(
  <StrictMode><ThemeProvider><ThemeToggleButton /></ThemeProvider></StrictMode>,
);

describe('theme preference', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-theme');
  });

  it('restores dark mode without overwriting it during StrictMode startup', () => {
    localStorage.setItem('daad.theme', 'dark');
    const writes = vi.spyOn(localStorage, 'setItem');
    mountTheme();
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(writes).not.toHaveBeenCalledWith('daad.theme', 'light');
  });

  it('switches both ways and remembers the selection after remounting', () => {
    const view = mountTheme();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(localStorage.getItem('daad.theme')).toBe('dark');
    view.unmount();
    mountTheme();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('daad.theme')).toBe('light');
  });

  it('still switches when preference storage is unavailable', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
    mountTheme();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});

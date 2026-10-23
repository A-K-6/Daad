import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LandingHero } from '@/components/LandingHero';

describe('LandingHero Component', () => {
  it('renders title, description, and download buttons', () => {
    render(<LandingHero />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Daad/i);
    expect(screen.getByRole('link', { name: /macOS Apple Silicon/ })).toHaveAttribute('href', expect.stringContaining('_aarch64.dmg'));
    expect(screen.getByRole('link', { name: /Windows x64/ })).toHaveAttribute('href', expect.stringContaining('_x64-setup.exe'));
    expect(screen.getByRole('link', { name: /Linux x64/ })).toHaveAttribute('href', expect.stringContaining('_amd64.AppImage'));
    expect(screen.getByRole('link', { name: /Android arm64/ })).toHaveAttribute('href', expect.stringContaining('_android_arm64.apk'));
    expect(screen.queryByRole('link', { name: /iOS/ })).not.toBeInTheDocument();
    expect(screen.getByText(/GPL-3.0-or-later/)).toBeInTheDocument();
    expect(screen.getByText(/bun run tauri dev/i)).toBeInTheDocument();
  });
});

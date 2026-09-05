import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LandingHero } from '@/components/LandingHero';

describe('LandingHero Component', () => {
  it('renders title, description, and download buttons', () => {
    render(<LandingHero />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Daad/i);
    expect(screen.getByRole('link', { name: /macOS Apple Silicon/ })).toHaveAttribute('href', expect.stringContaining('_aarch64.dmg'));
    expect(screen.queryByRole('link', { name: /Windows|Linux/ })).not.toBeInTheDocument();
    expect(screen.getByText(/GPL-3.0-or-later/)).toBeInTheDocument();
    expect(screen.getByText(/bun run tauri dev/i)).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LandingHero } from './LandingHero';

describe('LandingHero Component', () => {
  it('renders title, description, and download buttons', () => {
    render(<LandingHero />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Daad/i);
    expect(screen.getByText(/macOS/i)).toBeInTheDocument();
    expect(screen.getByText(/Windows/i)).toBeInTheDocument();
    expect(screen.getByText(/Linux/i)).toBeInTheDocument();
    expect(screen.getByText(/bun run tauri dev/i)).toBeInTheDocument();
  });
});

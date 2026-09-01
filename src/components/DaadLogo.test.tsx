import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DaadLogo } from './DaadLogo';

describe('DaadLogo Component', () => {
  it('renders SVG icon without throwing', () => {
    const { container } = render(<DaadLogo size={32} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders brand text when showText is true', () => {
    render(<DaadLogo showText={true} />);
    expect(screen.getByText('DAAD')).toBeInTheDocument();
    expect(screen.getByText(/softphone/i)).toBeInTheDocument();
  });
});

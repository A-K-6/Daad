import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UpdateModal } from './UpdateModal';
import { updateService } from '../services/updateService';

describe('UpdateModal Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders update modal title and current version', () => {
    render(<UpdateModal onClose={vi.fn()} />);

    expect(screen.getByText('Software Update')).toBeInTheDocument();
    expect(screen.getByText(`Current version v${updateService.getCurrentVersion()}`)).toBeInTheDocument();
  });

  it('renders check again and done action buttons', () => {
    render(<UpdateModal onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
  });
});

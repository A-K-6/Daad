import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecentCallsView } from './RecentCallsView';
import { CallRecord } from '../types/callHistory';

describe('RecentCallsView Component', () => {
  const sampleRecords: CallRecord[] = [
    {
      id: '1',
      target: '1002',
      displayName: 'Alice Support',
      direction: 'incoming',
      status: 'answered',
      duration: 125,
      timestamp: Date.now() - 10000,
    },
    {
      id: '2',
      target: '1003',
      displayName: 'Bob Manager',
      direction: 'incoming',
      status: 'missed',
      duration: 0,
      timestamp: Date.now() - 300000,
    },
  ];

  it('renders empty state message when no calls exist', () => {
    render(
      <RecentCallsView
        records={[]}
        onCall={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByText('No Recent Calls')).toBeInTheDocument();
  });

  it('renders recent call list with names and durations', () => {
    render(
      <RecentCallsView
        records={sampleRecords}
        onCall={vi.fn()}
        onClear={vi.fn()}
      />
    );

    expect(screen.getByText('Alice Support')).toBeInTheDocument();
    expect(screen.getByText('Bob Manager')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('triggers onCall when clicking a call record', () => {
    const handleCall = vi.fn();
    render(
      <RecentCallsView
        records={sampleRecords}
        onCall={handleCall}
        onClear={vi.fn()}
      />
    );

    const recordAlice = screen.getByText('Alice Support');
    fireEvent.click(recordAlice);
    expect(handleCall).toHaveBeenCalledWith('1002');
  });

  it('triggers onClear when clear button is clicked', () => {
    const handleClear = vi.fn();
    render(
      <RecentCallsView
        records={sampleRecords}
        onCall={vi.fn()}
        onClear={handleClear}
      />
    );

    const clearBtn = screen.getByRole('button', { name: /clear/i });
    fireEvent.click(clearBtn);
    expect(handleClear).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DialerPad } from './DialerPad';


describe('DialerPad Component', () => {
  it('renders all 12 keypad buttons correctly', () => {
    render(
      <DialerPad
        connectionState="Registered"
        onCall={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].forEach((digit) => {
      expect(screen.getByText(digit)).toBeInTheDocument();
    });
  });

  it('updates display when keypad digits are clicked', () => {
    render(
      <DialerPad
        connectionState="Registered"
        onCall={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('1'));
    fireEvent.click(screen.getByText('0'));
    fireEvent.click(screen.getByText('0'));
    fireEvent.click(screen.getByText('2'));

    const display = screen.getByTestId('dial-display');
    expect(display).toHaveTextContent('1002');
  });

  it('handles backspace and clear buttons', () => {
    render(
      <DialerPad
        connectionState="Registered"
        onCall={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('5'));
    fireEvent.click(screen.getByText('6'));
    const display = screen.getByTestId('dial-display');
    expect(display).toHaveTextContent('56');

    const backspaceBtn = screen.getByTitle('Backspace');
    fireEvent.click(backspaceBtn);
    expect(display).toHaveTextContent('5');

    const clearBtn = screen.getByTitle('Clear');
    fireEvent.click(clearBtn);
    expect(display).toHaveTextContent('Enter number...');
  });

  it('triggers onCall when call button is pressed with valid number', () => {
    const handleCall = vi.fn();
    render(
      <DialerPad
        connectionState="Registered"
        onCall={handleCall}
        onOpenSettings={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('1'));
    fireEvent.click(screen.getByText('0'));
    fireEvent.click(screen.getByText('1'));

    const callBtn = screen.getByTitle('Initiate Call');
    fireEvent.click(callBtn);

    expect(handleCall).toHaveBeenCalledWith('101');
  });

  it('listens to physical keyboard events', () => {
    const handleCall = vi.fn();
    render(
      <DialerPad
        connectionState="Registered"
        onCall={handleCall}
        onOpenSettings={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: '9' });
    fireEvent.keyDown(window, { key: '1' });
    fireEvent.keyDown(window, { key: '1' });

    const display = screen.getByTestId('dial-display');
    expect(display).toHaveTextContent('911');

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handleCall).toHaveBeenCalledWith('911');
  });

  it('redials last called number when redial button is clicked', async () => {
    const { callHistoryService } = await import('@/services');
    callHistoryService.addRecord({
      target: '1005',
      displayName: 'Echo Test',
      direction: 'outgoing',
      status: 'answered',
      duration: 12,
    });

    render(
      <DialerPad
        connectionState="Registered"
        onCall={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    const redialBtn = screen.getByTitle('Redial 1005');
    fireEvent.click(redialBtn);

    const display = screen.getByTestId('dial-display');
    expect(display).toHaveTextContent('1005');
  });

  it('handles long press on 0 to insert +', () => {
    vi.useFakeTimers();
    render(
      <DialerPad
        connectionState="Registered"
        onCall={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    );

    const zeroBtn = screen.getByText('0').closest('button')!;
    fireEvent.mouseDown(zeroBtn);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    fireEvent.mouseUp(zeroBtn);
    fireEvent.click(zeroBtn);

    const display = screen.getByTestId('dial-display');
    expect(display).toHaveTextContent('+');
    vi.useRealTimers();
  });
});



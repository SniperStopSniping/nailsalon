import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoldCountdown } from './HoldCountdown';

describe('HoldCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T15:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the remaining time from the server-provided absolute expiry and ticks down', () => {
    render(
      <HoldCountdown
        expiresAt="2026-03-20T15:05:30.000Z"
        timeZone="America/Toronto"
      />,
    );

    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('5:30');
    expect(screen.getByTestId('hold-deadline')).toHaveAttribute(
      'datetime',
      '2026-03-20T15:05:30.000Z',
    );
    expect(screen.getByTestId('hold-deadline')).toHaveTextContent(/Friday, March 20, 2026/i);
    expect(screen.getByTestId('hold-deadline')).toHaveTextContent(/11:05.*EDT/i);

    act(() => {
      vi.advanceTimersByTime(61_000);
    });

    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('4:29');
  });

  it('accounts for wall-clock passage in one jump (backgrounded tab)', () => {
    render(<HoldCountdown expiresAt="2026-03-20T15:05:00.000Z" />);

    // The tab sleeps for 4 minutes; a single tick after waking must re-derive
    // from the absolute expiry, not an accumulated offset.
    act(() => {
      vi.setSystemTime(new Date('2026-03-20T15:04:00.000Z'));
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByTestId('hold-countdown')).toHaveTextContent(/^0:59$/);
  });

  it('renders an already-past expiry as expired immediately', () => {
    render(<HoldCountdown expiresAt="2026-03-20T14:00:00.000Z" />);

    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('0:00');
    expect(screen.getByTestId('hold-deadline')).toHaveAttribute(
      'datetime',
      '2026-03-20T14:00:00.000Z',
    );
  });

  it('formats the same expiry instant across a DST boundary in the requested salon timezone', () => {
    const view = render(
      <HoldCountdown
        expiresAt="2026-03-08T06:30:00.000Z"
        timeZone="America/Toronto"
      />,
    );

    expect(screen.getByTestId('hold-deadline')).toHaveTextContent(/1:30.*EST/i);

    view.rerender(
      <HoldCountdown
        expiresAt="2026-03-08T07:30:00.000Z"
        timeZone="America/Toronto"
      />,
    );

    expect(screen.getByTestId('hold-deadline')).toHaveTextContent(/3:30.*EDT/i);
    expect(screen.getByTestId('hold-deadline')).toHaveAttribute(
      'datetime',
      '2026-03-08T07:30:00.000Z',
    );
  });

  it('renders nothing for an unparsable timestamp', () => {
    render(<HoldCountdown expiresAt="not-a-date" />);

    expect(screen.queryByTestId('hold-countdown')).not.toBeInTheDocument();
    expect(screen.queryByTestId('hold-deadline')).not.toBeInTheDocument();
  });
});

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
    render(<HoldCountdown expiresAt="2026-03-20T15:05:30.000Z" />);

    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('5:30');

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

    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('0:5');
  });

  it('renders an already-past expiry as expired immediately', () => {
    render(<HoldCountdown expiresAt="2026-03-20T14:00:00.000Z" />);

    expect(screen.getByTestId('hold-countdown')).toHaveTextContent('0:00');
  });

  it('renders nothing for an unparsable timestamp', () => {
    render(<HoldCountdown expiresAt="not-a-date" />);

    expect(screen.queryByTestId('hold-countdown')).not.toBeInTheDocument();
  });
});

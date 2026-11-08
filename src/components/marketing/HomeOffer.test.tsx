import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FOUNDING_LIFETIME_CLAIM_DEADLINE } from '@/libs/billing/foundingLifetime';

import { HomeOffer } from './HomeOffer';

const deadline = Date.parse(FOUNDING_LIFETIME_CLAIM_DEADLINE);

afterEach(() => vi.useRealTimers());

describe('homepage promotion', () => {
  it('uses the enforced Toronto deadline and expires in an open tab', () => {
    vi.useFakeTimers();
    vi.setSystemTime(deadline - 1000);
    render(<HomeOffer locale="en" initiallyOpen />);

    expect(screen.getByText('Sign up by January 1, 2027.')).toBeVisible();
    expect(screen.getByText('Optional SMS and AI credits cost extra.')).toBeVisible();

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('removes stale prerendered offer copy after the deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(deadline + 1);
    render(<HomeOffer locale="en" initiallyOpen />);

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});

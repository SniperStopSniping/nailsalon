import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const envHolder = vi.hoisted(() => ({
  PUBLIC_PRICING_ENABLED: undefined as string | undefined,
}));
vi.mock('@/libs/Env', () => ({ Env: envHolder }));

const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
}));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

describe('public pricing page', () => {
  beforeEach(() => {
    notFoundMock.mockClear();
  });

  it('404s while PUBLIC_PRICING_ENABLED is unset', async () => {
    envHolder.PUBLIC_PRICING_ENABLED = undefined;
    const { default: PricingPage } = await import('./page');

    // Call the server component directly: rendering through React would
    // route the throw into jsdom's console.error and trip fail-on-console.
    expect(() => PricingPage()).toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('describes free core booking and exactly 100 starter credits without subscription offers', async () => {
    envHolder.PUBLIC_PRICING_ENABLED = 'true';
    const { default: PricingPage } = await import('./page');
    const { container } = render(<PricingPage />);

    expect(screen.getByRole('heading', { name: 'Optional SMS credits' })).toBeInTheDocument();
    expect(screen.getByText(/Core booking software is free/)).toBeInTheDocument();
    expect(screen.getByText(/receive 100 free starter SMS credits once after contact verification/)).toBeInTheDocument();
    expect(screen.getByText(/one-time purchases/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/50 free|per month|per year|founding offer|two months free/i);
    expect(container.innerHTML).not.toMatch(/price_|coupon_|prod_/);
  });
});

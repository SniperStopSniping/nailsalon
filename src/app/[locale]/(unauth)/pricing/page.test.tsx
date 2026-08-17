/**
 * Pricing page dark posture — §12. Unset PUBLIIC flag = 404 via notFound();
 * enabled = canonical catalogue only (no Stripe IDs anywhere in the tree),
 * and founding language stays absent while the committed promotion window
 * is null/null (closed).
 */
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

  it('renders the frozen catalogue with no Stripe IDs and no founding copy (window closed)', async () => {
    envHolder.PUBLIC_PRICING_ENABLED = 'true';
    const { default: PricingPage } = await import('./page');
    const { container } = render(<PricingPage />);

    // Frozen prices, exact (§3.1/§3.2).
    expect(screen.getByText('$14.99')).toBeInTheDocument();
    expect(screen.getByText('$24.99')).toBeInTheDocument();
    expect(screen.getByText('$44.99')).toBeInTheDocument();
    expect(screen.getByText('$149.90')).toBeInTheDocument();
    expect(screen.getByText('$249.90')).toBeInTheDocument();
    expect(screen.getByText('$449.90')).toBeInTheDocument();
    // The committed promotion window is closed: founding copy absent.
    expect(screen.queryByText(/founding/i)).not.toBeInTheDocument();
    // No Stripe identifiers can leak into the public tree.
    expect(container.innerHTML).not.toMatch(/price_|coupon_|prod_/);
  });
});

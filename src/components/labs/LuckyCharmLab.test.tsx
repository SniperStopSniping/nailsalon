import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LuckyCharmLab } from './LuckyCharmLab';

describe('LuckyCharmLab', () => {
  it('switches materials and exposes the illustrative value clearly', () => {
    render(<LuckyCharmLab />);

    expect(screen.getByText('Getting your studio ready…')).toBeInTheDocument();
    expect(screen.getByLabelText('Illustrative booking value, not live account data')).toHaveTextContent('sample');

    fireEvent.click(screen.getByRole('button', { name: /Liquid chrome/ }));

    expect(screen.getByTestId('lucky-charm-preview')).toHaveAttribute('data-material', 'chrome');
  });

  it('finishes immediately when the simulated app is ready', () => {
    vi.useFakeTimers();
    render(<LuckyCharmLab />);

    fireEvent.click(screen.getByRole('button', { name: 'Fast · 0.5s' }));
    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByTestId('lucky-charm-preview')).toHaveAttribute('data-ready', 'true');

    vi.useRealTimers();
  });

  it('supports reduced motion and the current spinner comparison', () => {
    render(<LuckyCharmLab />);

    const reducedMotion = screen.getByRole('button', { name: 'Reduced motion' });
    fireEvent.click(reducedMotion);

    expect(reducedMotion).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Compare with current spinner/ }));

    expect(screen.getByTestId('lucky-charm-preview')).toHaveAttribute('data-material', 'current');
    expect(screen.getAllByText('Checking your session...')).toHaveLength(2);
  });
});

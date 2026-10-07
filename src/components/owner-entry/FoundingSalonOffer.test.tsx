import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FoundingSalonOffer } from './FoundingSalonOffer';

describe('FoundingSalonOffer', () => {
  it('provides a dashboard exit after the acquisition deadline without promising a new grant', () => {
    const onClaim = vi.fn();
    const onContinue = vi.fn();
    render(<FoundingSalonOffer onClaim={onClaim} closed onContinue={onContinue} />);

    expect(screen.queryByRole('button', { name: 'Claim my free lifetime plan' })).not.toBeInTheDocument();
    expect(screen.getByText('The founding offer has ended')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go to my dashboard' }));

    expect(onContinue).toHaveBeenCalledOnce();
    expect(onClaim).not.toHaveBeenCalled();
  });

  it('offers one claim with the approved price and separate usage disclosure', () => {
    const onClaim = vi.fn();
    render(<FoundingSalonOffer onClaim={onClaim} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('$49.99/month').tagName).toBe('S');
    expect(screen.getByText('100 free texts included')).toBeInTheDocument();
    expect(screen.getByText('Unlimited emails')).toBeInTheDocument();
    expect(screen.getByText('Additional SMS, AI receptionist, phone calls, and other usage-based services are billed separately.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByText(/compare plans|price coming soon|upgrade later/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Claim my free lifetime plan' }));

    expect(onClaim).toHaveBeenCalledOnce();
  });

  it('preserves pending and status feedback without duplicate submission', () => {
    const onClaim = vi.fn();
    render(<FoundingSalonOffer onClaim={onClaim} pending message="Please wait while your claim is saved." />);
    const button = screen.getByRole('button', { name: 'Saving your claim…' });

    expect(button).toBeDisabled();

    fireEvent.click(button);

    expect(onClaim).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Please wait while your claim is saved.');
  });
});

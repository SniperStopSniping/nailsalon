import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, vi } from 'vitest';

import { createDefaultPlanOffer } from '../model/defaults';
import { PlanOfferSheet } from './PlanOfferSheet';

const installMatchMedia = () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string): MediaQueryList => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })));
};

describe('PlanOfferSheet', () => {
  beforeEach(installMatchMedia);

  it('is absent until explicitly opened and exposes three full-size keyboard actions', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const offer = createDefaultPlanOffer();
    const view = render(
      <PlanOfferSheet
        offer={offer}
        onChoose={onChoose}
        onClose={vi.fn()}
        open={false}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'Your site is saved' })).not.toBeInTheDocument();
    expect(onChoose).not.toHaveBeenCalled();

    view.rerender(
      <PlanOfferSheet
        offer={offer}
        onChoose={onChoose}
        onClose={vi.fn()}
        open
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Your site is saved' });
    const lifetime = within(dialog).getByRole('button', { name: 'Unlock lifetime access' });
    const monthly = within(dialog).getByRole('button', { name: 'Choose monthly' });
    const free = within(dialog).getByRole('button', { name: 'Continue free' });
    expect(lifetime).toBeEnabled();
    expect(monthly).toBeEnabled();
    expect(free).toBeEnabled();
    expect(within(dialog).getByText(/No Stripe · No subscription enforcement/i)).toBeVisible();
    await waitFor(() => expect(free).toHaveFocus());

    await user.click(lifetime);
    await user.click(monthly);
    await user.click(free);
    expect(onChoose.mock.calls.map(([intent]) => intent)).toEqual([
      'lifetime',
      'monthly',
      'free',
    ]);
  });

  it('keeps monthly and free available when the lifetime fixture is expired', () => {
    const offer = createDefaultPlanOffer();
    offer.fixtureState = 'expired';
    render(
      <PlanOfferSheet
        offer={offer}
        onChoose={vi.fn()}
        onClose={vi.fn()}
        open
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Your site is saved' });
    expect(within(dialog).getByRole('button', { name: 'Lifetime offer unavailable' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Choose monthly' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Continue free' })).toBeEnabled();
    expect(within(dialog).getByText('Founding offer expired · Lab fixture')).toBeVisible();
  });

  it('restores focus to the handoff control after the sheet closes', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open my Builder</button>
          <PlanOfferSheet
            offer={createDefaultPlanOffer()}
            onChoose={vi.fn()}
            onClose={() => setOpen(false)}
            open={open}
          />
        </>
      );
    }

    render(<Harness />);
    const handoff = screen.getByRole('button', { name: 'Open my Builder' });
    await user.click(handoff);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue free' })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Close Your site is saved' }));
    await waitFor(() => expect(handoff).toHaveFocus());
  });
});

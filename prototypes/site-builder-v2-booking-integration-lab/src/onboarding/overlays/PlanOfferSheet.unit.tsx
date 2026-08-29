import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, vi } from 'vitest';

import { createDefaultPlanOffer } from '../model/defaults';
import { createLabPlanConfiguration, PlanOfferSheet } from './PlanOfferSheet';

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
    const heading = within(dialog).getByRole('heading', { name: 'Your site is saved' });
    const founding = within(dialog).getByRole('button', {
      name: 'Choose founding lifetime offer',
    });
    const monthly = within(dialog).getByRole('button', { name: 'Choose monthly plan' });
    const free = within(dialog).getByRole('button', { name: 'Continue free' });
    expect(founding).toBeEnabled();
    expect(monthly).toBeEnabled();
    expect(free).toBeEnabled();
    expect(within(dialog).getByText(/You won’t be charged today/u)).toBeVisible();
    expect(within(dialog).getByText(/Prices and included features are shown for review/iu)).toBeVisible();
    expect(within(dialog).queryByText(/Lab|prototype|Stripe|server-backed|subscription enforcement/u))
      .not.toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(/Continue free, or choose a plan/u);
    await waitFor(() => expect(heading).toHaveFocus());
    expect(free).not.toHaveFocus();

    await user.click(founding);
    await user.click(monthly);
    await user.click(free);
    expect(onChoose.mock.calls.map(([intent]) => intent)).toEqual([
      'founding',
      'monthly',
      'free',
    ]);
  });

  it('keeps monthly and free available when the configured founding fixture is expired', () => {
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
    expect(within(dialog).getByRole('button', {
      name: 'Founding Nail Tech Lifetime Access unavailable',
    })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Choose monthly plan' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Continue free' })).toBeEnabled();
    expect(within(dialog).getByText('Founding offer has ended')).toBeVisible();
  });

  it.each([
    ['lifetime', 'Founding Nail Tech Lifetime Access'],
    ['discounted_annual', 'Founding annual access'],
    ['locked_monthly', 'Founding monthly rate'],
    ['free_beta', 'Founding Nail Tech beta'],
  ] as const)('drives the %s founding offer entirely from configuration', (mode, title) => {
    render(
      <PlanOfferSheet
        configuration={createLabPlanConfiguration(mode)}
        offer={createDefaultPlanOffer()}
        onChoose={vi.fn()}
        onClose={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole('heading', { name: title })).toBeVisible();
  });

  it('resolves its founding configuration from the persisted offer state', () => {
    const offer = createDefaultPlanOffer();
    offer.foundingMode = 'free_beta';
    render(
      <PlanOfferSheet
        offer={offer}
        onChoose={vi.fn()}
        onClose={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole('heading', { name: 'Founding Nail Tech beta' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Join founding beta' })).toBeEnabled();
  });

  it('can hide the founding offer and its comparison column', async () => {
    const user = userEvent.setup();
    render(
      <PlanOfferSheet
        configuration={createLabPlanConfiguration('hidden')}
        offer={createDefaultPlanOffer()}
        onChoose={vi.fn()}
        onClose={vi.fn()}
        open
      />,
    );

    expect(screen.queryByText(/Founding/iu)).not.toBeInTheDocument();
    expect(screen.getByText('Choose the option that fits you')).toBeVisible();
    await user.click(screen.getByText('Compare plans'));
    const table = screen.getByRole('table', { name: 'Plan feature comparison' });
    expect(within(table).queryByRole('columnheader', { name: /Founding/iu })).not.toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Monthly plan' })).toBeVisible();
    expect(within(table).getByRole('columnheader', { name: 'Continue free' })).toBeVisible();
  });

  it('hides a founding option when the offer fixture is set to none', () => {
    const offer = createDefaultPlanOffer();
    offer.fixtureState = 'none';
    render(
      <PlanOfferSheet
        offer={offer}
        onChoose={vi.fn()}
        onClose={vi.fn()}
        open
      />,
    );

    expect(screen.queryByRole('button', { name: /founding/iu })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose monthly plan' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue free' })).toBeEnabled();
  });

  it('restores focus to the handoff control after the sheet closes', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Finish setup</button>
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
    const handoff = screen.getByRole('button', { name: 'Finish setup' });
    await user.click(handoff);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your site is saved' }))
      .toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Close Your site is saved' }));
    await waitFor(() => expect(handoff).toHaveFocus());
  });
});

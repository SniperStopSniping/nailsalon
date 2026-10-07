import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, vi } from 'vitest';

import { createDefaultPlanOffer } from '../model/defaults';
import { createLabPlanConfiguration, PlanOfferSheet } from './PlanOfferSheet';

beforeEach(() => {
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
});

describe('PlanOfferSheet', () => {
  it('has one founding claim instead of plan choices and keeps initial focus', async () => {
    const onChoose = vi.fn();
    render(<PlanOfferSheet offer={createDefaultPlanOffer()} onChoose={onChoose} onClose={vi.fn()} open />);
    const dialog = screen.getByRole('dialog', { name: 'Your site is ready' });

    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Compare options')).not.toBeInTheDocument();
    expect(within(dialog).getByText('100 free texts included')).toBeVisible();
    expect(within(dialog).getByText('Unlimited emails')).toBeVisible();
    expect(within(dialog).getByText(/Additional SMS, AI receptionist/)).toBeVisible();

    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Your site is ready' })).toHaveFocus());
    const action = within(dialog).getByRole('button', { name: 'Claim my free lifetime plan' });
    fireEvent.click(action);
    fireEvent.click(action);

    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith('founding');
    expect(screen.getByRole('button', { name: 'Saving your claim…' })).toBeDisabled();
  });

  it.each(['none', 'expired'] as const)('does not offer a claim for an %s fixture', (fixtureState) => {
    const onChoose = vi.fn();
    render(<PlanOfferSheet offer={{ ...createDefaultPlanOffer(), fixtureState }} onChoose={onChoose} onClose={vi.fn()} open />);

    expect(screen.queryByRole('button', { name: 'Claim my free lifetime plan' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open my salon' }));

    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith('free');
  });

  it('respects disabled and hidden founding configuration without adding tiers', () => {
    const offer = createDefaultPlanOffer();
    const view = render(<PlanOfferSheet configuration={createLabPlanConfiguration('hidden')} offer={offer} onChoose={vi.fn()} onClose={vi.fn()} open />);

    expect(screen.queryByRole('button', { name: 'Claim my free lifetime plan' })).not.toBeInTheDocument();

    const configuration = createLabPlanConfiguration();
    view.rerender(<PlanOfferSheet configuration={{ ...configuration, options: configuration.options.map(option => ({ ...option, enabled: false })) }} offer={offer} onChoose={vi.fn()} onClose={vi.fn()} open />);

    expect(screen.getByRole('button', { name: 'Open my salon' })).toBeEnabled();
  });

  it.each(['lifetime', 'discounted_annual', 'locked_monthly', 'free_beta'] as const)('normalizes legacy %s configuration to the single current offer', (mode) => {
    const configuration = createLabPlanConfiguration(mode);

    expect(configuration.options).toHaveLength(1);
    expect(configuration.options[0]?.planIntent).toBe('founding');
    expect(configuration.showPlanComparison).toBe(false);
  });

  it('restores focus after Escape and the close control', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Finish setup</button>
          <PlanOfferSheet offer={createDefaultPlanOffer()} onChoose={vi.fn()} onClose={() => setOpen(false)} open={open} />
        </>
      );
    }
    render(<Harness />);
    const handoff = screen.getByRole('button', { name: 'Finish setup' });
    await user.click(handoff);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your site is ready' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(handoff).toHaveFocus());
    await user.click(handoff);
    await user.click(screen.getByRole('button', { name: 'Close Your site is ready' }));
    await waitFor(() => expect(handoff).toHaveFocus());
  });
});

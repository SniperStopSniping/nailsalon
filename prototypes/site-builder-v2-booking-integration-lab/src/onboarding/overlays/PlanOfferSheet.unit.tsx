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

  it('opens with Free selected, three selectable cards, and exactly one primary action', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const offer = createDefaultPlanOffer();
    const view = render(
      <PlanOfferSheet offer={offer} onChoose={onChoose} onClose={vi.fn()} open={false} />,
    );

    expect(screen.queryByRole('dialog', { name: 'Your site is saved' })).not.toBeInTheDocument();
    view.rerender(<PlanOfferSheet offer={offer} onChoose={onChoose} onClose={vi.fn()} open />);

    const dialog = screen.getByRole('dialog', { name: 'Your site is saved' });
    const heading = within(dialog).getByRole('heading', { name: 'Your site is saved' });
    const free = within(dialog).getByRole('radio', { name: /Free Always free to start/iu });
    const founding = within(dialog).getByRole('radio', { name: /Founding offer/iu });
    const monthly = within(dialog).getByRole('radio', { name: /Monthly plan/iu });
    expect(free).toBeChecked();
    expect(founding).not.toBeChecked();
    expect(monthly).not.toBeChecked();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(3);
    expect(within(dialog).getAllByRole('button', { name: /Continue free|Reserve founding offer|interested in monthly/iu })).toHaveLength(1);
    expect(within(dialog).getByText(/Nothing is charged today/u)).toBeVisible();
    await waitFor(() => expect(heading).toHaveFocus());

    await user.click(founding);
    expect(founding).toBeChecked();
    expect(onChoose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Reserve founding offer' }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith('founding');
  });

  it('uses truthful interest copy without urgency, lifetime promises, checkout, or a table', async () => {
    const user = userEvent.setup();
    render(
      <PlanOfferSheet
        offer={createDefaultPlanOffer()}
        onChoose={vi.fn()}
        onClose={vi.fn()}
        open
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Your site is saved' });
    expect(within(dialog).getByText('Always free to start')).toBeVisible();
    expect(within(dialog).getAllByText('Price coming soon')).toHaveLength(2);
    expect(within(dialog).getByText(/Final prices and features are still being confirmed/u)).toBeVisible();
    expect(within(dialog).queryByText(/lifetime|ending soon|expires|countdown|buy|purchase|checkout/iu)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();

    await user.click(within(dialog).getByText('Compare what’s included'));
    expect(within(dialog).getAllByText('Online booking')).toHaveLength(2);
    expect(within(dialog).getAllByText('Included with every plan')).toHaveLength(2);
    expect(within(dialog).getAllByText('Planned for paid options')).toHaveLength(3);
  });

  it('keeps Free and Monthly coherent when the founding option is hidden or expired', () => {
    const offer = createDefaultPlanOffer();
    const view = render(
      <PlanOfferSheet
        configuration={createLabPlanConfiguration('hidden')}
        offer={offer}
        onChoose={vi.fn()}
        onClose={vi.fn()}
        open
      />,
    );
    expect(screen.queryByRole('radio', { name: /Founding offer/iu })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Free Always free to start/iu })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Monthly plan/iu })).toBeEnabled();

    offer.fixtureState = 'expired';
    view.rerender(
      <PlanOfferSheet offer={offer} onChoose={vi.fn()} onClose={vi.fn()} open />,
    );
    expect(screen.queryByRole('radio', { name: /Founding offer/iu })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue free' })).toBeEnabled();
  });

  it.each(['lifetime', 'discounted_annual', 'locked_monthly', 'free_beta'] as const)(
    'normalizes legacy %s configuration to the truthful generic founding-interest card',
    (mode) => {
      render(
        <PlanOfferSheet
          configuration={createLabPlanConfiguration(mode)}
          offer={createDefaultPlanOffer()}
          onChoose={vi.fn()}
          onClose={vi.fn()}
          open
        />,
      );
      expect(screen.getByRole('radio', { name: /Founding offer/iu })).toBeEnabled();
      expect(screen.queryByText(/Lifetime Access|annual access|locked founding rate|beta access/iu))
        .not.toBeInTheDocument();
    },
  );

  it('restores focus to Finish setup after Escape or the close control', async () => {
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
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Your site is saved' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(handoff).toHaveFocus());

    await user.click(handoff);
    await user.click(screen.getByRole('button', { name: 'Close Your site is saved' }));
    await waitFor(() => expect(handoff).toHaveFocus());
  });
});

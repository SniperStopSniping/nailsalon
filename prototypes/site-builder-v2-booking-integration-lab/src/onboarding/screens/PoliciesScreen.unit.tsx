import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import type { OnboardingLabState } from '../model/types';
import {
  PoliciesScreen,
  type OnboardingStateUpdater,
} from './DesignScreens';

const policyState = (fixture: 'blank' | 'daniela'): OnboardingLabState => {
  const state = fixture === 'daniela'
    ? createDanielaFixtureState()
    : createDefaultOnboardingState();
  state.progress.currentScreen = 'policies';
  state.progress.lastActiveScreen = 'policies';
  return state;
};

function PoliciesHarness({
  initial,
  onEditBooking,
  onSkip = vi.fn(),
  onState,
}: {
  initial: OnboardingLabState;
  onEditBooking?: () => void;
  onSkip?: () => void;
  onState?: (state: OnboardingLabState) => void;
}) {
  const [state, setState] = useState(initial);
  const update: OnboardingStateUpdater = (transform) => setState((current) => {
    const next = transform(current);
    onState?.(next);
    return next;
  });
  return (
    <PoliciesScreen
      onBack={vi.fn()}
      onContinue={vi.fn()}
      onEditBooking={onEditBooking}
      onSkip={onSkip}
      onUpdate={update}
      state={state}
    />
  );
}

const previewCard = (name: string): HTMLElement => {
  const heading = screen.getByRole('heading', { name });
  const card = heading.closest('article');
  if (!card) throw new Error(`Missing ${name} policy preview card`);
  return card;
};

describe('PoliciesScreen', () => {
  it('uses six owner-friendly accordions and derives customer wording from structured answers', async () => {
    const user = userEvent.setup();
    let latest = policyState('blank');
    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    expect(screen.getByRole('heading', { name: 'What your clients will see' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Cancellations/u })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('button', { name: /Guests & appointment details/u }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', {
      name: 'How late can a client be?',
    })).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('How much notice do clients need to cancel?'),
      'custom',
    );
    await user.type(screen.getByRole('textbox', { name: 'Custom notice' }), '36 hours');
    await user.selectOptions(
      screen.getByLabelText('What happens after the cancellation deadline?'),
      'custom',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Custom consequence' }),
      'A $30 late cancellation fee applies',
    );
    expect(within(previewCard('Cancellations')).getByText(/at least 36 hours/u))
      .toBeVisible();

    await user.click(screen.getByRole('button', { name: /Late arrivals/u }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'How late can a client be?' }),
      '10',
    );
    expect(within(previewCard('Late arrivals')).getByText(/10-minute grace period/u))
      .toBeVisible();
    expect(latest.profile.policies.copy.late_arrivals.suggestedWording)
      .toContain('10-minute grace period');
  });

  it('reads one fixed Booking deposit and asks only policy consequences', async () => {
    const user = userEvent.setup();
    const onEditBooking = vi.fn();
    let latest = policyState('blank');
    latest.profile.policies.deposits = {
      amountCents: 2_500,
      mode: 'fixed',
      refundable: null,
      transferable: null,
      wordingOverride: '',
    };
    render(
      <PoliciesHarness
        initial={latest}
        onEditBooking={onEditBooking}
        onState={(state) => { latest = state; }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Deposits/u }));
    expect(screen.getByText('From your Booking settings')).toBeVisible();
    expect(screen.getAllByText('$25 deposit').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox', { name: 'Deposit amount' })).not.toBeInTheDocument();
    expect(screen.queryByText(/percentage|depends on the service/iu)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /require a deposit/iu })).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('Can clients get their deposit back?'),
      'yes',
    );
    await user.selectOptions(
      screen.getByLabelText('Can clients move it to another appointment?'),
      'no',
    );
    expect(latest.profile.policies.deposits).toMatchObject({
      amountCents: 2_500,
      mode: 'fixed',
      refundable: true,
      transferable: false,
    });
    await user.click(screen.getByRole('button', { name: 'Edit deposit in Booking' }));
    expect(onEditBooking).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: /No-shows/u }));
    await user.selectOptions(screen.getByLabelText('What happens after a no-show?'), 'deposit_lost');
    expect(latest.profile.policies.noShows.loseDeposit).toBe(true);
    expect(within(previewCard('No-shows')).getByText(/forfeit the deposit/u)).toBeVisible();
  });

  it('preserves an explicit wording override as facts change and supports website visibility', async () => {
    const user = userEvent.setup();
    let latest = policyState('daniela');
    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    const cancellations = previewCard('Cancellations');
    await user.click(within(cancellations).getByRole('button', { name: 'Edit wording' }));
    const wording = within(cancellations).getByRole('textbox', {
      name: 'Cancellations wording',
    });
    await user.clear(wording);
    await user.type(wording, 'Please text me if you need to change your appointment.');
    await user.selectOptions(
      screen.getByLabelText('How much notice do clients need to cancel?'),
      '48_hours',
    );

    expect(wording).toHaveValue('Please text me if you need to change your appointment.');
    expect(latest.profile.policies.copy.cancellations.wordingOverride).toBe(
      'Please text me if you need to change your appointment.',
    );
    expect(latest.profile.policies.copy.cancellations.suggestedWording).toContain('48 hours');

    await user.click(within(cancellations).getByRole('switch', {
      name: 'Show Cancellations on my website',
    }));
    expect(latest.profile.policies.copy.cancellations.visible).toBe(false);
    await user.click(within(cancellations).getByRole('button', {
      name: 'Use suggested wording',
    }));
    expect(within(cancellations).getByText(/at least 48 hours/u)).toBeVisible();
  });

  it('omits stale deposit-forfeit controls and summaries in no-deposit mode without deleting them', async () => {
    const user = userEvent.setup();
    const initial = policyState('blank');
    initial.profile.policies.cancellations.notice = '24_hours';
    initial.profile.policies.cancellations.consequence = 'deposit_lost';
    initial.profile.policies.noShows.loseDeposit = true;
    initial.profile.policies.deposits.mode = 'none';

    const view = render(<PoliciesHarness initial={initial} />);

    expect(screen.getByRole('button', { name: /Cancellations/u }))
      .toHaveTextContent('24 hours’ notice');
    expect(screen.getByRole('button', { name: /Cancellations/u }))
      .not.toHaveTextContent(/deposit/iu);
    expect(screen.getByLabelText('What happens after the cancellation deadline?'))
      .toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Keep the deposit' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No-shows/u }))
      .toHaveTextContent('Choose what happens after a no-show');
    expect(screen.queryByText(/forfeit the deposit|deposit is kept/iu))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /No-shows/u }));
    expect(screen.getByLabelText('What happens after a no-show?')).toHaveValue('');
    expect(initial.profile.policies.cancellations.consequence).toBe('deposit_lost');
    expect(initial.profile.policies.noShows.loseDeposit).toBe(true);

    view.unmount();
    initial.profile.policies.deposits.mode = 'fixed';
    initial.profile.policies.deposits.amountCents = 2_000;
    render(<PoliciesHarness initial={initial} />);
    expect(screen.getByLabelText('What happens after the cancellation deadline?'))
      .toHaveValue('deposit_lost');
    expect(screen.getByRole('option', { name: 'Keep the deposit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No-shows/u }))
      .toHaveTextContent('Deposit is kept');
  });

  it('keeps policies optional through the explicit skip action', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<PoliciesHarness initial={policyState('blank')} onSkip={onSkip} />);

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});

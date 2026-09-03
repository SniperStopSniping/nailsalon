import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
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
  onContinue = vi.fn(),
  onEditBooking,
  onSkip = vi.fn(),
  onState,
}: {
  initial: OnboardingLabState;
  onContinue?: () => void;
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
      onContinue={onContinue}
      onEditBooking={onEditBooking}
      onSkip={onSkip}
      onUpdate={update}
      state={state}
    />
  );
}

const previewCard = (name: string): HTMLElement => {
  const summary = screen.getByText(name, { selector: 'summary' });
  const card = summary.closest('details');
  if (!card) throw new Error(`Missing ${name} policy preview card`);
  card.open = true;
  return card;
};

describe('PoliciesScreen', () => {
  it('uses five owner-friendly accordions and derives combined customer wording', async () => {
    const user = userEvent.setup();
    let latest = policyState('blank');
    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    expect(screen.getByRole('heading', { name: 'What your clients will see' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Deposits & cancellations/u })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByRole('button').filter((button) => (
      button.getAttribute('aria-controls')?.startsWith('onboarding-policy-')
    ))).toHaveLength(5);
    expect(screen.queryByText('Cancellations', {
      selector: '.onboarding-collapsible-card__trigger strong',
    })).not.toBeInTheDocument();
    expect(screen.queryByText('Deposits', {
      selector: '.onboarding-collapsible-card__trigger strong',
    })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guests & appointment details/u }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', {
      name: 'How late can a client be?',
    })).not.toBeInTheDocument();
    expect(within(previewCard('No-shows')).getByText('Not ready — not shown'))
      .toBeVisible();
    expect(within(previewCard('Repairs')).getByText('Not ready — not shown'))
      .toBeVisible();
    expect(screen.queryByText('Shown on site')).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('How much notice do clients need to cancel?'),
      'custom',
    );
    await user.type(screen.getByRole('textbox', { name: 'Custom notice' }), '36 hours');
    await user.selectOptions(
      screen.getByLabelText('What happens if they cancel late?'),
      'custom',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Custom late-cancellation rule' }),
      'A $30 late cancellation fee applies',
    );
    expect(within(previewCard('Deposits & cancellations')).getByText(/at least 36 hours/u))
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

    expect(screen.getByText('From your Booking settings')).toBeVisible();
    expect(screen.getAllByText('$25 deposit').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox', { name: 'Deposit amount' })).not.toBeInTheDocument();
    expect(screen.queryByText(/percentage|depends on the service/iu)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /require a deposit/iu })).not.toBeInTheDocument();
    expect(screen.getByLabelText('What happens to the deposit if they cancel late?'))
      .toBeVisible();
    expect(screen.getByRole('option', { name: 'Move it to a new appointment' }))
      .toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Refund it' })).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('How much notice do clients need to cancel?'),
      '24_hours',
    );
    await user.selectOptions(
      screen.getByLabelText('What happens to the deposit if they cancel late?'),
      'deposit_lost',
    );

    await user.selectOptions(
      screen.getByLabelText(/Can clients get their deposit back\?/u),
      'yes',
    );
    await user.selectOptions(
      screen.getByLabelText(/Can clients move it to another appointment\?/u),
      'no',
    );
    expect(latest.profile.policies.deposits).toMatchObject({
      amountCents: 2_500,
      mode: 'fixed',
      refundable: true,
      transferable: false,
    });
    expect(screen.getByRole('button', { name: /Deposits & cancellations/u }))
      .toHaveTextContent('$25 deposit · 24 hours’ notice · deposit kept after late cancellation');
    expect(screen.getByRole('button', { name: /Deposits & cancellations/u }))
      .toHaveTextContent('Complete');
    await user.click(screen.getByRole('button', { name: 'Edit deposit in Booking' }));
    expect(onEditBooking).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: /No-shows/u }));
    await user.selectOptions(
      screen.getByLabelText('What happens if a client misses their appointment?'),
      'deposit_lost',
    );
    expect(latest.profile.policies.noShows.loseDeposit).toBe(true);
    expect(within(previewCard('No-shows')).getByText(/forfeit the deposit/u)).toBeVisible();
  });

  it('preserves an explicit wording override as facts change and supports website visibility', async () => {
    const user = userEvent.setup();
    let latest = policyState('daniela');
    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    const combined = previewCard('Deposits & cancellations');
    await user.click(within(combined).getByRole('button', { name: 'Edit wording' }));
    const wording = within(combined).getByRole('textbox', {
      name: 'Cancellation wording',
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

    await user.click(within(combined).getByRole('switch', {
      name: 'Show Deposits & cancellations on my website',
    }));
    expect(latest.profile.policies.copy.cancellations.visible).toBe(false);
    expect(latest.profile.policies.copy.deposits.visible).toBe(false);
    await user.click(within(combined).getByRole('button', {
      name: 'Use suggested wording',
    }));
    expect(latest.profile.policies.copy.cancellations.wordingOverride).toBe(
      'Please text me if you need to change your appointment.',
    );
  });

  it('omits stale deposit-forfeit controls and summaries in no-deposit mode without deleting them', async () => {
    const user = userEvent.setup();
    const initial = policyState('blank');
    initial.profile.policies.cancellations.notice = '24_hours';
    initial.profile.policies.cancellations.consequence = 'deposit_lost';
    initial.profile.policies.noShows.loseDeposit = true;
    initial.profile.policies.deposits.mode = 'none';

    const view = render(<PoliciesHarness initial={initial} />);

    expect(screen.getByRole('button', { name: /Deposits & cancellations/u }))
      .toHaveTextContent('Finish your deposit and cancellation rules');
    expect(screen.getByLabelText('What happens if they cancel late?'))
      .toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Keep the deposit' }))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Can clients get their deposit back\?/u))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Can clients move it to another appointment\?/u))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No-shows/u }))
      .toHaveTextContent('Choose what happens after a no-show');
    expect(screen.queryByText(/forfeit the deposit|deposit is kept/iu))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /No-shows/u }));
    expect(screen.getByLabelText('What happens if a client misses their appointment?'))
      .toHaveValue('');
    expect(initial.profile.policies.cancellations.consequence).toBe('deposit_lost');
    expect(initial.profile.policies.noShows.loseDeposit).toBe(true);

    view.unmount();
    initial.profile.policies.deposits.mode = 'fixed';
    initial.profile.policies.deposits.amountCents = 2_000;
    render(<PoliciesHarness initial={initial} />);
    expect(screen.getByLabelText('What happens to the deposit if they cancel late?'))
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

  it('re-enables meaningful saved policies and keeps master-hidden copy truthful', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    let latest = policyState('blank');
    latest.recipe.policiesEnabled = false;

    render(
      <FeedbackProvider testMode>
        <PoliciesHarness
          initial={latest}
          onContinue={onContinue}
          onState={(state) => { latest = state; }}
        />
      </FeedbackProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Your saved policy wording' }))
      .toBeVisible();
    expect(screen.getAllByText('Saved, but not shown on your site').length)
      .toBeGreaterThan(0);
    expect(screen.queryByText('Shown on site')).not.toBeInTheDocument();
    previewCard('Deposits & cancellations');
    expect(screen.getByRole('switch', {
      name: 'Show Deposits & cancellations on my website',
    }))
      .toBeDisabled();

    await user.selectOptions(
      screen.getByLabelText('How much notice do clients need to cancel?'),
      '24_hours',
    );
    await user.selectOptions(
      screen.getByLabelText('What happens if they cancel late?'),
      'cancellation_fee',
    );
    await user.click(screen.getByRole('button', { name: 'Save policies' }));

    expect(latest.recipe.policiesEnabled).toBe(true);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('does not call a partial or blank custom cancellation policy complete', async () => {
    const user = userEvent.setup();
    render(<PoliciesHarness initial={policyState('blank')} />);
    const combined = () => screen.getByRole('button', {
      name: /Deposits & cancellations/u,
    });

    expect(combined()).toHaveTextContent('Finish your deposit and cancellation rules');
    expect(combined()).toHaveTextContent('Set up');
    await user.selectOptions(
      screen.getByLabelText('How much notice do clients need to cancel?'),
      '24_hours',
    );
    expect(combined()).toHaveTextContent('Finish your deposit and cancellation rules');
    expect(combined()).not.toHaveTextContent('Complete');
    await user.selectOptions(
      screen.getByLabelText('What happens if they cancel late?'),
      'custom',
    );
    expect(combined()).toHaveTextContent('Finish your deposit and cancellation rules');
    expect(combined()).not.toHaveTextContent('Complete');
    await user.type(
      screen.getByRole('textbox', { name: 'Custom late-cancellation rule' }),
      'Please contact me directly.',
    );
    expect(combined()).toHaveTextContent('Complete');
  });

  it('keeps policy visibility controls inside their client-copy disclosures', async () => {
    const user = userEvent.setup();
    render(<PoliciesHarness initial={policyState('daniela')} />);

    expect(screen.getByRole('switch', { name: 'Show policies on my website' }))
      .toBeVisible();
    expect(screen.getByRole('switch', {
      name: 'Show Deposits & cancellations on my website',
    }))
      .not.toBeVisible();
    await user.click(screen.getByText('Deposits & cancellations', { selector: 'summary' }));
    expect(screen.getByRole('switch', {
      name: 'Show Deposits & cancellations on my website',
    }))
      .toBeVisible();
    expect(screen.getByText('You can add or change policies later from your dashboard.'))
      .toBeVisible();
  });

  it('reconciles split legacy visibility through the one combined switch', async () => {
    const user = userEvent.setup();
    let latest = policyState('daniela');
    latest.profile.policies.copy.cancellations.visible = false;
    latest.profile.policies.copy.deposits.visible = true;
    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    const combined = previewCard('Deposits & cancellations');
    expect(within(combined).getByText('Partly shown on site')).toBeVisible();
    const visibility = within(combined).getByRole('switch', {
      name: 'Show Deposits & cancellations on my website',
    });
    expect(visibility).not.toBeChecked();

    await user.click(visibility);
    expect(latest.profile.policies.copy.cancellations.visible).toBe(true);
    expect(latest.profile.policies.copy.deposits.visible).toBe(true);
  });

  it('shows guests and children as natural client prose', async () => {
    const user = userEvent.setup();
    render(<PoliciesHarness initial={policyState('blank')} />);

    await user.click(screen.getByRole('button', { name: /Guests & appointment details/u }));
    await user.selectOptions(screen.getByLabelText('Guests'), 'Guests welcome');
    await user.selectOptions(screen.getByLabelText('Children'), 'Children welcome');
    const card = previewCard('Guests & appointment details');
    expect(within(card).getByText('Guests and children are welcome.')).toBeVisible();
    expect(card).not.toHaveTextContent(/Guests:|Children:/u);
  });
});

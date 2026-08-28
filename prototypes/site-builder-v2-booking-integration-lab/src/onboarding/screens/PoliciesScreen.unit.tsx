import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDanielaFixtureState } from '../fixtures';
import { createDefaultOnboardingState } from '../model/defaults';
import {
  getDepositPolicyMode,
  updateDepositPolicyMode,
} from '../model/policies';
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
  onSkip = vi.fn(),
  onState,
}: {
  initial: OnboardingLabState;
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
      onSkip={onSkip}
      onUpdate={update}
      state={state}
    />
  );
}

const policyCard = (name: string): HTMLElement => {
  const heading = screen.getByRole('heading', { name });
  const card = heading.closest('article');
  if (!card) throw new Error(`Missing ${name} policy card`);
  return card;
};

describe('PoliciesScreen', () => {
  it('derives live wording from structured facts and reveals custom inputs only when selected', async () => {
    const user = userEvent.setup();
    let latest = policyState('blank');
    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    expect(within(policyCard('Cancellations')).queryByText(/24 hours/u)).not.toBeInTheDocument();
    expect(within(policyCard('Deposits')).queryByText(/\$50 deposit/u)).not.toBeInTheDocument();
    expect(within(policyCard('Late arrivals')).queryByText(/15-minute/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Custom notice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Custom consequence' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Required notice'), 'custom');
    await user.type(screen.getByRole('textbox', { name: 'Custom notice' }), '36 hours');
    await user.selectOptions(screen.getByLabelText('After deadline'), 'custom');
    await user.type(
      screen.getByRole('textbox', { name: 'Custom consequence' }),
      'A $30 late cancellation fee applies',
    );

    expect(within(policyCard('Cancellations')).getByText(/at least 36 hours/u)).toBeVisible();
    expect(within(policyCard('Cancellations')).getByText(/\$30 late cancellation fee applies/u)).toBeVisible();

    await user.click(within(screen.getByRole('group', {
      name: 'Do you generally require a deposit?',
    })).getByRole('radio', { name: 'Yes' }));
    await user.selectOptions(screen.getByLabelText('Fixed amount or percentage?'), 'percentage');
    await user.type(screen.getByRole('textbox', { name: 'Deposit amount' }), '25');
    await user.type(screen.getByRole('textbox', { name: 'Grace period (minutes)' }), '10');

    expect(within(policyCard('Deposits')).getByText(/25% deposit/u)).toBeVisible();
    expect(within(policyCard('Late arrivals')).getByText(/10-minute grace period/u)).toBeVisible();
    expect(latest.profile.policies.copy.deposits.suggestedWording).toContain('25% deposit');
    expect(latest.profile.policies.copy.late_arrivals.suggestedWording).toContain('10-minute grace period');
  });

  it('reuses the Booking deposit answer, keeps service-defined details authoritative, and preserves copy overrides', async () => {
    const user = userEvent.setup();
    let latest = policyState('blank');
    latest.profile.policies = updateDepositPolicyMode(
      latest.profile.policies,
      'depends_on_service',
    );
    latest.profile.policies.copy.deposits.useSuggestedWording = false;
    latest.profile.policies.copy.deposits.wordingOverride = 'My existing deposit wording.';

    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    expect(screen.getByText('Deposit depends on the service')).toBeVisible();
    expect(screen.getByText(/Booking remains the source of truth/u)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Deposit amount' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Refundable?')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', {
      name: 'Do you generally require a deposit?',
    })).not.toBeInTheDocument();
    expect(within(policyCard('Deposits')).getByRole('textbox', {
      name: 'Deposits wording',
    })).toHaveValue('My existing deposit wording.');

    await user.click(screen.getByRole('button', { name: 'Change deposit answer' }));
    await user.click(within(screen.getByRole('group', {
      name: 'Do you generally require a deposit?',
    })).getByRole('radio', { name: 'No' }));

    expect(getDepositPolicyMode(latest.profile.policies)).toBe('none');
    expect(latest.profile.policies.copy.deposits.suggestedWording)
      .toBe('No deposit is generally required.');
    expect(latest.profile.policies.copy.deposits.wordingOverride)
      .toBe('My existing deposit wording.');
    expect(latest.profile.policies.copy.deposits.useSuggestedWording).toBe(false);
    expect(screen.getByText('No general deposit')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Deposit amount' })).not.toBeInTheDocument();
  });

  it('preserves an explicit wording override as facts change and supports Show/Hide', async () => {
    const user = userEvent.setup();
    let latest = policyState('daniela');
    render(<PoliciesHarness initial={latest} onState={(state) => { latest = state; }} />);

    const cancellations = policyCard('Cancellations');
    await user.click(within(cancellations).getByRole('button', { name: 'Edit wording' }));
    const wording = within(cancellations).getByRole('textbox', { name: 'Cancellations wording' });
    await user.clear(wording);
    await user.type(wording, 'Please text me if you need to change your appointment.');
    await user.selectOptions(screen.getByLabelText('Required notice'), '48_hours');

    expect(wording).toHaveValue('Please text me if you need to change your appointment.');
    expect(latest.profile.policies.copy.cancellations.wordingOverride).toBe(
      'Please text me if you need to change your appointment.',
    );
    expect(latest.profile.policies.copy.cancellations.suggestedWording).toContain('48 hours');
    expect(latest.profile.policies.copy.cancellations.useSuggestedWording).toBe(false);

    await user.click(within(cancellations).getByRole('switch', { name: 'Show Cancellations on site' }));
    expect(latest.profile.policies.copy.cancellations.visible).toBe(false);

    await user.click(within(cancellations).getByRole('button', { name: 'Use suggested wording' }));
    expect(within(cancellations).getByText(/at least 48 hours/u)).toBeVisible();
    expect(latest.profile.policies.copy.cancellations.useSuggestedWording).toBe(true);
    expect(latest.profile.policies.copy.cancellations.wordingOverride).toBe(
      'Please text me if you need to change your appointment.',
    );
  });

  it('keeps policies optional through the explicit skip action', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<PoliciesHarness initial={policyState('blank')} onSkip={onSkip} />);

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledOnce();
  });
});

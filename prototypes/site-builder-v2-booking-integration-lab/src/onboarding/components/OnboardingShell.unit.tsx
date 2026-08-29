import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { OnboardingShell } from './OnboardingShell';

describe('OnboardingShell', () => {
  it('announces the current stage, autosave, and essentials without a screen count', () => {
    render(
      <OnboardingShell
        autosaveState="saving"
        completedStages={['basics']}
        currentStage="booking"
        essentialsRemaining={2}
      >
        <h1>How can clients book with you?</h1>
      </OnboardingShell>,
    );

    const progress = screen.getByRole('navigation', { name: 'Onboarding progress' });
    expect(within(progress).getByText('Booking').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(progress).getByText('Basics').closest('li')).toHaveAttribute('data-stage-state', 'complete');
    expect(screen.getByRole('status', { name: 'Autosave status' })).toHaveTextContent('Saving…');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('2 required steps left');
    expect(screen.queryByText(/step \d+ of \d+/i)).not.toBeInTheDocument();
  });

  it('runs each native More action and closes the menu first', async () => {
    const user = userEvent.setup();
    const onSaveForLater = vi.fn();
    const onRestart = vi.fn();
    const onLabOptions = vi.fn();
    render(
      <OnboardingShell
        autosaveState="saved"
        completedStages={[]}
        currentStage="basics"
        essentialsRemaining={5}
        onLabOptions={onLabOptions}
        onRestart={onRestart}
        onSaveForLater={onSaveForLater}
      >
        <h1>Screen content</h1>
      </OnboardingShell>,
    );

    const more = screen.getByRole('button', { name: 'More onboarding options' });
    const details = more.closest('details');
    for (const action of [
      'Save and finish later',
      'Start over',
      'Lab review options',
    ]) {
      await user.click(more);
      expect(details).toHaveAttribute('open');
      await user.click(screen.getByRole('menuitem', { name: action }));
      expect(details).not.toHaveAttribute('open');
      expect(more).toHaveFocus();
    }

    expect(onSaveForLater).toHaveBeenCalledOnce();
    expect(onRestart).toHaveBeenCalledOnce();
    expect(onLabOptions).toHaveBeenCalledOnce();
  });

  it('moves focus into its menu, supports arrow keys, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingShell
        autosaveState="saved"
        completedStages={[]}
        currentStage="basics"
        essentialsRemaining={5}
        onRestart={vi.fn()}
        onSaveForLater={vi.fn()}
      >
        <h1>Screen content</h1>
      </OnboardingShell>,
    );

    const more = screen.getByRole('button', { name: 'More onboarding options' });
    const details = more.closest('details');
    more.focus();
    await user.keyboard('{Enter}');
    expect(details).toHaveAttribute('open');
    const save = screen.getByRole('menuitem', { name: 'Save and finish later' });
    const restart = screen.getByRole('menuitem', { name: 'Start over' });
    await waitFor(() => expect(save).toHaveFocus());

    await user.keyboard('{ArrowDown}');
    expect(restart).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(save).toHaveFocus();
    await user.keyboard('{End}');
    expect(restart).toHaveFocus();
    await user.keyboard('{Home}');
    expect(save).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(details).not.toHaveAttribute('open'));
    await waitFor(() => expect(more).toHaveFocus());

    await user.keyboard(' ');
    expect(details).toHaveAttribute('open');
    await waitFor(() => expect(save).toHaveFocus());
    await user.tab({ shift: true });
    await waitFor(() => expect(details).not.toHaveAttribute('open'));
    expect(more).toHaveFocus();
  });

  it('closes without trapping focus when Tab leaves the nonmodal menu', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingShell
        autosaveState="saved"
        completedStages={[]}
        currentStage="basics"
        essentialsRemaining={5}
        onRestart={vi.fn()}
        onSaveForLater={vi.fn()}
      >
        <button type="button">First setup action</button>
      </OnboardingShell>,
    );

    const more = screen.getByRole('button', { name: 'More onboarding options' });
    const details = more.closest('details');
    await user.click(more);
    await waitFor(() => expect(screen.getByRole('menuitem', {
      name: 'Save and finish later',
    })).toHaveFocus());

    await user.tab();
    await waitFor(() => expect(details).not.toHaveAttribute('open'));
    expect(screen.getByRole('button', { name: 'First setup action' })).toHaveFocus();
  });

  it('closes on an outside pointer interaction', async () => {
    const user = userEvent.setup();
    render(
      <OnboardingShell
        autosaveState="saved"
        completedStages={[]}
        currentStage="basics"
        essentialsRemaining={5}
        onRestart={vi.fn()}
      >
        <button type="button">Outside action</button>
      </OnboardingShell>,
    );

    const more = screen.getByRole('button', { name: 'More onboarding options' });
    const details = more.closest('details');
    await user.click(more);
    expect(details).toHaveAttribute('open');
    await user.click(screen.getByRole('button', { name: 'Outside action' }));
    expect(details).not.toHaveAttribute('open');
  });

  it('closes when the onboarding route key changes', async () => {
    const shell = (routeKey: string) => (
      <OnboardingShell
        autosaveState="saved"
        completedStages={[]}
        currentStage="basics"
        essentialsRemaining={5}
        onRestart={vi.fn()}
        routeKey={routeKey}
      >
        <h1>{routeKey}</h1>
      </OnboardingShell>
    );
    const view = render(shell('business'));
    const more = screen.getByRole('button', { name: 'More onboarding options' });
    const details = more.closest('details');

    await userEvent.setup().click(more);
    expect(details).toHaveAttribute('open');
    view.rerender(shell('photo_social'));
    await waitFor(() => expect(details).not.toHaveAttribute('open'));
  });

  it('does not infer completion from a stage appearing before Review', () => {
    render(
      <OnboardingShell
        autosaveState="saved"
        completedStages={['basics', 'booking']}
        currentStage="review"
        essentialsRemaining={1}
      >
        <h1>Review your site</h1>
      </OnboardingShell>,
    );

    const progress = screen.getByRole('navigation', { name: 'Onboarding progress' });
    expect(within(progress).getByText('Design').closest('li')).toHaveAttribute(
      'data-stage-state',
      'upcoming',
    );
    expect(within(progress).getByText('Review').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });
});

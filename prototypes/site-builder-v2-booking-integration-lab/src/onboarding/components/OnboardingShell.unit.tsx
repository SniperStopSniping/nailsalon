import { render, screen, within } from '@testing-library/react';
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
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('2 essentials left');
    expect(screen.queryByText(/step \d+ of \d+/i)).not.toBeInTheDocument();
  });

  it('exposes every Lab More action as a native button', async () => {
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

    await user.click(screen.getByText('More'));
    await user.click(screen.getByRole('button', { name: 'Save and finish later' }));
    await user.click(screen.getByRole('button', { name: 'Restart onboarding' }));
    await user.click(screen.getByRole('button', { name: 'Lab review options' }));

    expect(onSaveForLater).toHaveBeenCalledOnce();
    expect(onRestart).toHaveBeenCalledOnce();
    expect(onLabOptions).toHaveBeenCalledOnce();
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

import { render, screen, within } from '@testing-library/react';

import { OnboardingStageProgress, resolveRailStepId } from './OnboardingStageProgress';

const railState = () => {
  const rail = screen.getByRole('navigation', { name: 'Onboarding progress' });
  return within(rail)
    .getAllByRole('listitem')
    .map(item => [item.textContent?.replace(' complete', '').trim(), item.dataset.stageState]);
};

// OP-003 — the rail listed Basics · Booking · Design · Review while the owner
// actually walks Basics → site style → account gate → Booking → the rest of
// Design → Review.
describe('OnboardingStageProgress', () => {
  it('lists the steps in the order the owner walks them', () => {
    render(
      <OnboardingStageProgress
        completedStages={['basics']}
        currentScreen="site_style"
        currentStage="design"
      />,
    );

    expect(railState()).toEqual([
      ['Basics', 'complete'],
      ['Style', 'current'],
      ['Booking', 'upcoming'],
      ['Design', 'upcoming'],
      ['Review', 'upcoming'],
    ]);
  });

  it('keeps the account gate inside the Style step, before Booking', () => {
    expect(resolveRailStepId('design', 'save_progress')).toBe('style');
    expect(resolveRailStepId('design', 'about')).toBe('design');
    expect(resolveRailStepId('design', 'booking_layout')).toBe('design');
    expect(resolveRailStepId('booking', 'booking_preferences')).toBe('booking');
  });

  it('marks Style complete once its essential is met and Booking is current', () => {
    render(
      <OnboardingStageProgress
        completedStages={['basics', 'design']}
        currentScreen="booking_preferences"
        currentStage="booking"
      />,
    );

    expect(railState()).toEqual([
      ['Basics', 'complete'],
      ['Style', 'complete'],
      ['Booking', 'current'],
      ['Design', 'upcoming'],
      ['Review', 'upcoming'],
    ]);
  });

  it('never claims a passed step is complete while its essential is missing', () => {
    render(
      <OnboardingStageProgress
        completedStages={['basics', 'booking']}
        currentScreen="final_preview"
        currentStage="review"
      />,
    );

    expect(railState()).toEqual([
      ['Basics', 'complete'],
      // The site style was never confirmed, so neither half of the design
      // stage may read complete.
      ['Style', 'upcoming'],
      ['Booking', 'complete'],
      ['Design', 'upcoming'],
      ['Review', 'current'],
    ]);
  });
});

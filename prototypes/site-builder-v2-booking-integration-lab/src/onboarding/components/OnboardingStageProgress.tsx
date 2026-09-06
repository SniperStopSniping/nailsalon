import type { OnboardingScreenId, OnboardingStage } from '../model/types';

/**
 * OP-003 — the rail used to render `STAGE_METADATA` order (Basics · Booking ·
 * Design · Review), which is NOT the order the owner walks:
 *
 *   Basics (starter → business → preview → location → hours)
 *   → design/site style          ← the rail called this step 3
 *   → the account gate
 *   → Booking (booking preferences)  ← the rail called this step 2
 *   → design (about → policies → layout → extras)
 *   → Review
 *
 * So the rail showed "Booking" incomplete and next while the owner was
 * already past the step the rail placed after it. Rather than reorder the
 * screens (an owner-facing sequence change nobody asked for), the rail now
 * names what actually happens: the design stage is presented as two steps —
 * "Style", the site-style essential met before the account gate, and
 * "Design", the finishing screens that come after Booking.
 *
 * `OnboardingStage` itself is unchanged; this mapping lives only in the rail.
 */
export type OnboardingRailStepId = 'basics' | 'style' | 'booking' | 'design' | 'review';

type RailStep = {
  id: OnboardingRailStepId;
  label: string;
  /** Essential stages that must be complete for this step to read complete. */
  requires: readonly OnboardingStage[];
};

export const ONBOARDING_RAIL_STEPS: readonly RailStep[] = [
  { id: 'basics', label: 'Basics', requires: ['basics'] },
  // The design stage's single essential IS the site style, so "Style" carries
  // it and "Design" (which has no essential of its own) does not.
  { id: 'style', label: 'Style', requires: ['design'] },
  { id: 'booking', label: 'Booking', requires: ['booking'] },
  // Same stage, same essential: neither half may read complete while the
  // site style is still unconfirmed.
  { id: 'design', label: 'Design', requires: ['design'] },
  { id: 'review', label: 'Review', requires: ['review'] },
];

/**
 * Screens that belong to the "Style" half of the design stage: the site-style
 * essential itself and the account gate that immediately follows it, both
 * reached BEFORE booking preferences.
 */
const STYLE_SCREENS: readonly OnboardingScreenId[] = ['site_style', 'save_progress'];

export const resolveRailStepId = (
  currentStage: OnboardingStage,
  currentScreen?: OnboardingScreenId,
): OnboardingRailStepId => {
  if (currentStage !== 'design') {
    return currentStage;
  }
  if (!currentScreen || STYLE_SCREENS.includes(currentScreen)) {
    // With no screen to go on, assume the earlier half: the rail must never
    // mark a step complete on no evidence.
    return 'style';
  }
  return 'design';
};

/** Label for the shell's "Current stage:" line, so it agrees with the rail. */
export const getRailStepLabel = (
  currentStage: OnboardingStage,
  currentScreen?: OnboardingScreenId,
): string => {
  const stepId = resolveRailStepId(currentStage, currentScreen);
  return ONBOARDING_RAIL_STEPS.find(step => step.id === stepId)?.label ?? '';
};

type OnboardingStageProgressProps = {
  completedStages: readonly OnboardingStage[];
  currentScreen?: OnboardingScreenId;
  currentStage: OnboardingStage;
};

export function OnboardingStageProgress({
  completedStages,
  currentScreen,
  currentStage,
}: OnboardingStageProgressProps) {
  const currentStepId = resolveRailStepId(currentStage, currentScreen);
  const currentIndex = ONBOARDING_RAIL_STEPS.findIndex(step => step.id === currentStepId);

  return (
    <nav aria-label="Onboarding progress" className="onboarding-stage-progress">
      <ol className="onboarding-stage-progress__list">
        {ONBOARDING_RAIL_STEPS.map((step, index) => {
          const satisfied = step.requires.every(stage => completedStages.includes(stage));
          const state = index < currentIndex && satisfied
            ? 'complete'
            : index === currentIndex
              ? 'current'
              : 'upcoming';

          return (
            <li
              aria-current={state === 'current' ? 'step' : undefined}
              className={`onboarding-stage-progress__item is-${state}`}
              data-stage={step.id}
              data-stage-state={state}
              key={step.id}
            >
              <span aria-hidden="true" className="onboarding-stage-progress__marker" />
              <span>{step.label}</span>
              {state === 'complete'
                ? (
                    <span className="visually-hidden"> complete</span>
                  )
                : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { OnboardingStageProgress as StageProgress };

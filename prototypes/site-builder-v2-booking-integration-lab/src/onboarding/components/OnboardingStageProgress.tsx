import { ONBOARDING_STAGE_ORDER, STAGE_METADATA } from '../copy';
import type { OnboardingStage } from '../model/types';

type OnboardingStageProgressProps = {
  completedStages: readonly OnboardingStage[];
  currentStage: OnboardingStage;
};

export function OnboardingStageProgress({
  completedStages,
  currentStage,
}: OnboardingStageProgressProps) {
  const currentIndex = ONBOARDING_STAGE_ORDER.indexOf(currentStage);

  return (
    <nav aria-label="Onboarding progress" className="onboarding-stage-progress">
      <ol className="onboarding-stage-progress__list">
        {ONBOARDING_STAGE_ORDER.map((stage, index) => {
          const state = index < currentIndex && completedStages.includes(stage)
            ? 'complete'
            : index === currentIndex
              ? 'current'
              : 'upcoming';

          return (
            <li
              aria-current={state === 'current' ? 'step' : undefined}
              className={`onboarding-stage-progress__item is-${state}`}
              data-stage={stage}
              data-stage-state={state}
              key={stage}
            >
              <span aria-hidden="true" className="onboarding-stage-progress__marker" />
              <span>{STAGE_METADATA[stage].label}</span>
              {state === 'complete' ? (
                <span className="visually-hidden"> complete</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { OnboardingStageProgress as StageProgress };

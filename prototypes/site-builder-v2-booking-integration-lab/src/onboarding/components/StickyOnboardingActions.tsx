type StickyOnboardingActionsProps = {
  backLabel?: string;
  formId?: string;
  onBack?: () => void;
  onPrimary?: () => void;
  onSkip?: () => void;
  primaryDisabled?: boolean;
  primaryLabel: string;
  skipLabel?: string;
};

export function StickyOnboardingActions({
  backLabel = 'Back',
  formId,
  onBack,
  onPrimary,
  onSkip,
  primaryDisabled = false,
  primaryLabel,
  skipLabel = 'Skip for now',
}: StickyOnboardingActionsProps) {
  return (
    <footer
      aria-label="Onboarding actions"
      className="sticky-onboarding-actions"
    >
      {onBack ? (
        <button
          className="sticky-onboarding-actions__back"
          type="button"
          onClick={onBack}
        >
          {backLabel}
        </button>
      ) : <span aria-hidden="true" />}
      {onSkip ? (
        <button
          className="sticky-onboarding-actions__skip"
          type="button"
          onClick={onSkip}
        >
          {skipLabel}
        </button>
      ) : null}
      <button
        className="sticky-onboarding-actions__primary"
        disabled={primaryDisabled}
        form={formId}
        type={formId ? 'submit' : 'button'}
        onClick={formId ? undefined : onPrimary}
      >
        {primaryLabel}
      </button>
    </footer>
  );
}

export { StickyOnboardingActions as StickyActions };

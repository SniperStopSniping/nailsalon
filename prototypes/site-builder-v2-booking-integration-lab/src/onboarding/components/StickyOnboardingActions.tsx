type StickyOnboardingActionsProps = {
  backLabel?: string;
  formId?: string;
  onBack?: () => void;
  onPrimary?: () => void;
  onSkip?: () => void;
  primaryDisabled?: boolean;
  primaryId?: string;
  primaryFirst?: boolean;
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
  primaryId,
  primaryFirst = false,
  primaryLabel,
  skipLabel = 'Skip for now',
}: StickyOnboardingActionsProps) {
  const primaryAction = (
    <button
      className="sticky-onboarding-actions__primary"
      disabled={primaryDisabled}
      form={formId}
      id={primaryId}
      type={formId ? 'submit' : 'button'}
      onClick={formId ? undefined : onPrimary}
    >
      {primaryLabel}
    </button>
  );
  const backAction = onBack ? (
    <button
      className="sticky-onboarding-actions__back"
      type="button"
      onClick={onBack}
    >
      {backLabel}
    </button>
  ) : <span aria-hidden="true" />;

  return (
    <footer
      aria-label="Onboarding actions"
      className={`sticky-onboarding-actions${primaryFirst ? ' is-primary-first' : ''}`}
    >
      {primaryFirst ? primaryAction : backAction}
      {onSkip ? (
        <button
          className="sticky-onboarding-actions__skip"
          type="button"
          onClick={onSkip}
        >
          {skipLabel}
        </button>
      ) : null}
      {primaryFirst ? backAction : primaryAction}
    </footer>
  );
}

export { StickyOnboardingActions as StickyActions };

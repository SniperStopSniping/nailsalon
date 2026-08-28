import { SCREEN_METADATA, WELCOME_BENEFITS } from '../copy';

type WelcomeScreenProps = {
  onBuildWebsite: () => void;
  onCanvaIntent: () => void;
};

export function WelcomeScreen({
  onBuildWebsite,
  onCanvaIntent,
}: WelcomeScreenProps) {
  const copy = SCREEN_METADATA.welcome;

  return (
    <main className="onboarding-welcome" id="onboarding-welcome">
      <div className="onboarding-welcome__brand" aria-label="Luster">
        <span aria-hidden="true">L</span>
        <strong>Luster</strong>
      </div>
      <section aria-labelledby="welcome-heading" className="onboarding-welcome__content">
        <p className="onboarding-screen-kicker">Your website starts here</p>
        <h1 id="welcome-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
        <ul aria-label="What Luster will do" className="onboarding-welcome__benefits">
          {WELCOME_BENEFITS.map((benefit) => (
            <li key={benefit}>
              <span aria-hidden="true">✓</span>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>
        <div className="onboarding-welcome__actions">
          <button className="onboarding-primary-action" type="button" onClick={onBuildWebsite}>
            {copy.primaryAction}
          </button>
          <button className="onboarding-secondary-action" type="button" onClick={onCanvaIntent}>
            {copy.secondaryAction}
          </button>
        </div>
        <p className="onboarding-lab-note">
          UX Lab · Saved only in this browser · Not connected to Production
        </p>
      </section>
    </main>
  );
}

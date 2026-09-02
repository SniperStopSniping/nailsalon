import { WeeklyHoursEditor } from '../components/WeeklyHoursEditor';
import {
  getWeeklyHoursCardSummary,
  hasCompleteWeeklyHours,
} from '../model/hours';
import type { BusinessProfileDraft } from '../model/types';
import { NativeSwitch } from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';

type HoursScreenProps = {
  onBack: () => void;
  onContinue: () => void;
  onProfileChange: (patch: Partial<BusinessProfileDraft>) => void;
  onSkipHours: () => void;
  profile: BusinessProfileDraft;
};

export function HoursScreen({
  onBack,
  onContinue,
  onProfileChange,
  onSkipHours,
  profile,
}: HoursScreenProps) {
  const complete = profile.hours.setupState === 'configured'
    && hasCompleteWeeklyHours(profile.hours);

  return (
    <section aria-labelledby="hours-screen-heading" className="onboarding-screen onboarding-hours-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Step 4 — Hours</p>
        <h1 id="hours-screen-heading">When are you open?</h1>
        <p>Set your regular business hours once, then adjust individual days if needed.</p>
      </header>
      <div className="onboarding-business-card is-expanded">
        <header>
          <div>
            <h2>Business hours</h2>
            <p>{getWeeklyHoursCardSummary(profile.hours)}</p>
          </div>
        </header>
        <NativeSwitch
          checked={complete && profile.hours.showOnSite}
          description={complete
            ? 'Clients can see your business hours on your site.'
            : 'Add valid hours before showing them publicly.'}
          disabled={!complete}
          label="Show hours on my website"
          onChange={(showOnSite) => onProfileChange({
            hours: { ...profile.hours, showOnSite },
          })}
        />
        <WeeklyHoursEditor
          hours={profile.hours}
          onChange={(hours) => onProfileChange({ hours })}
          onSkip={() => {
            onProfileChange({
              hours: { ...profile.hours, setupState: 'skipped', showOnSite: false },
            });
            onSkipHours();
            onContinue();
          }}
        />
        <p className="onboarding-field-hint">
          Website hours show clients when your business is open. Appointment availability
          remains controlled by your Booking settings.
        </p>
      </div>
      <StickyOnboardingActions
        onBack={onBack}
        onPrimary={onContinue}
        primaryFirst
        primaryLabel="Save and continue"
      />
    </section>
  );
}


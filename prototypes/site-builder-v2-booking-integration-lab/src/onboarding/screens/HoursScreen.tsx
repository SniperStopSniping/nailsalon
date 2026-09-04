import '../hours-screen.css';

import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Globe2,
} from 'lucide-react';
import { useState } from 'react';

import { Dialog } from '../../ui/Dialog';
import { NativeSwitch } from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { WeeklyHoursEditor } from '../components/WeeklyHoursEditor';
import {
  getWeeklyHoursCardSummary,
  hasCompleteWeeklyHours,
} from '../model/hours';
import type { BusinessProfileDraft } from '../model/types';

type HoursScreenProps = {
  onBack: () => void;
  onContinue: () => void;
  onProfileChange: (patch: Partial<BusinessProfileDraft>) => void;
  onSkipHours: () => void;
  profile: BusinessProfileDraft;
};

const TIME_ZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
] as const;

export function HoursScreen({
  onBack,
  onContinue,
  onProfileChange,
  onSkipHours,
  profile,
}: HoursScreenProps) {
  const complete = profile.hours.setupState === 'configured'
    && hasCompleteWeeklyHours(profile.hours);
  const skipped = profile.hours.setupState === 'skipped';
  const [open, setOpen] = useState(true);
  const [timeZoneDialogOpen, setTimeZoneDialogOpen] = useState(false);
  const [timeZoneDraft, setTimeZoneDraft] = useState(profile.timeZone);
  const summary = getWeeklyHoursCardSummary(complete
    ? { ...profile.hours, showOnSite: true }
    : profile.hours);
  const status = complete
    ? profile.hours.showOnSite ? 'Complete' : 'Saved, not shown'
    : skipped ? 'Skipped' : 'Set up';

  return (
    <section aria-labelledby="hours-screen-heading" className="onboarding-screen onboarding-hours-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Step 4 — Hours</p>
        <h1 id="hours-screen-heading">When are you open?</h1>
        <p>Set your regular business hours. You can adjust individual days anytime.</p>
      </header>

      <article className={`onboarding-hours-card${open ? ' is-open' : ''}`}>
        <button
          aria-expanded={open}
          className="onboarding-hours-card__trigger"
          type="button"
          onClick={() => setOpen(current => !current)}
        >
          <span className="onboarding-hours-card__icon" aria-hidden="true"><Clock3 /></span>
          <span className="onboarding-hours-card__title">
            <strong>Hours</strong>
            {!open ? <small>{summary}</small> : null}
          </span>
          <span className={`onboarding-hours-card__status is-${complete ? 'complete' : skipped ? 'skipped' : 'setup'}`}>
            {complete && profile.hours.showOnSite ? <Check aria-hidden="true" /> : null}
            {status}
          </span>
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>

        {open
          ? (
              <div className="onboarding-hours-card__content">
                <NativeSwitch
                  checked={complete && profile.hours.showOnSite}
                  description="Clients can see your regular business hours and whether you're currently open or closed."
                  disabled={!complete}
                  label="Show business hours to clients"
                  onChange={showOnSite => onProfileChange({
                    hours: { ...profile.hours, showOnSite },
                  })}
                />
                <WeeklyHoursEditor
                  hours={profile.hours}
                  hideSkipAction
                  onChange={hours => onProfileChange({ hours })}
                  onSkip={() => {
                    onProfileChange({
                      hours: { ...profile.hours, setupState: 'skipped', showOnSite: false },
                    });
                    onSkipHours();
                    onContinue();
                  }}
                />
                <section className="onboarding-hours-timezone" aria-labelledby="hours-timezone-heading">
                  <Globe2 aria-hidden="true" />
                  <span>
                    <strong id="hours-timezone-heading">Timezone</strong>
                    <small>{profile.timeZone}</small>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTimeZoneDraft(profile.timeZone);
                      setTimeZoneDialogOpen(true);
                    }}
                  >
                    Change
                  </button>
                </section>
                <button
                  className="onboarding-hours-skip"
                  type="button"
                  onClick={() => {
                    onProfileChange({
                      hours: { ...profile.hours, setupState: 'skipped', showOnSite: false },
                    });
                    onSkipHours();
                    onContinue();
                  }}
                >
                  <Clock3 aria-hidden="true" />
                  <span>
                    <strong>Skip hours for now</strong>
                    <small>You can add or update your hours later.</small>
                  </span>
                </button>
              </div>
            )
          : null}
      </article>
      <StickyOnboardingActions
        onBack={onBack}
        onPrimary={onContinue}
        primaryDisabled={!complete && !skipped}
        primaryFirst
        primaryLabel="Save and continue"
      />
      <Dialog
        description="Choose the timezone used to calculate your current open or closed status."
        initialFocusSelector="#onboarding-timezone-select"
        onClose={() => setTimeZoneDialogOpen(false)}
        open={timeZoneDialogOpen}
        title="Change timezone"
        variant="bottom-sheet"
      >
        <div className="onboarding-timezone-dialog">
          <label htmlFor="onboarding-timezone-select">Salon timezone</label>
          <select
            id="onboarding-timezone-select"
            value={timeZoneDraft}
            onChange={event => setTimeZoneDraft(event.target.value)}
          >
            {TIME_ZONES.map(timeZone => (
              <option key={timeZone} value={timeZone}>{timeZone}</option>
            ))}
          </select>
          <footer className="onboarding-overlay-actions">
            <button type="button" onClick={() => setTimeZoneDialogOpen(false)}>Cancel</button>
            <button
              className="is-primary"
              type="button"
              onClick={() => {
                onProfileChange({ timeZone: timeZoneDraft });
                setTimeZoneDialogOpen(false);
              }}
            >
              Save timezone
            </button>
          </footer>
        </div>
      </Dialog>
    </section>
  );
}

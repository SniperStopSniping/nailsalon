import {
  useId,
  useRef,
  useState,
  type Ref,
} from 'react';
import { CheckCircle2 } from 'lucide-react';

import { Dialog } from '../../ui/Dialog';
import {
  applyRegularHours,
  copyWeeklyHoursDay,
  formatHoursInterval,
  formatHoursTimeValue,
  getHoursIntervalError,
  getHoursIntervalErrorMessage,
  isValidOpenHoursDay,
  updateWeeklyHoursDay,
  WEEKDAY_LABELS,
  WEEKDAYS,
} from '../model/hours';
import type {
  DayHoursDraft,
  Weekday,
  WeeklyHoursDraft,
} from '../model/types';

type RegularHoursPreset = 'custom' | 'every_day' | 'monday_friday' | 'monday_saturday';

type WeeklyHoursEditorProps = {
  hours: WeeklyHoursDraft;
  hideSkipAction?: boolean;
  onChange: (hours: WeeklyHoursDraft) => void;
  onSkip: () => void;
};

const PRESET_DAYS: Record<Exclude<RegularHoursPreset, 'custom'>, readonly Weekday[]> = {
  every_day: WEEKDAYS,
  monday_friday: WEEKDAYS.slice(0, 5),
  monday_saturday: WEEKDAYS.slice(0, 6),
};

const PRESET_LABELS: Record<RegularHoursPreset, string> = {
  custom: 'Custom days',
  every_day: 'Every day',
  monday_friday: 'Monday–Friday',
  monday_saturday: 'Monday–Saturday',
};

const PRESET_ORDER: readonly RegularHoursPreset[] = [
  'every_day',
  'monday_friday',
  'monday_saturday',
  'custom',
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2).toString().padStart(2, '0');
  const minutes = index % 2 === 0 ? '00' : '30';
  return `${hours}:${minutes}`;
});

const sameDays = (left: readonly Weekday[], right: readonly Weekday[]): boolean =>
  left.length === right.length && left.every((weekday) => right.includes(weekday));

const presetForDays = (days: readonly Weekday[]): RegularHoursPreset => {
  if (sameDays(days, PRESET_DAYS.every_day)) return 'every_day';
  if (sameDays(days, PRESET_DAYS.monday_friday)) return 'monday_friday';
  if (sameDays(days, PRESET_DAYS.monday_saturday)) return 'monday_saturday';
  return 'custom';
};

const sameDayHours = (left: DayHoursDraft, right: DayHoursDraft): boolean => (
  left.close === right.close
  && left.closed === right.closed
  && left.open === right.open
);

const sameWeeklyHours = (left: WeeklyHoursDraft, right: WeeklyHoursDraft): boolean => (
  left.setupState === right.setupState
  && left.showOnSite === right.showOnSite
  && WEEKDAYS.every((weekday) => sameDayHours(left.days[weekday], right.days[weekday]))
);

const deriveRegularHours = (hours: WeeklyHoursDraft): {
  close: string;
  days: Weekday[];
  open: string;
  preset: RegularHoursPreset;
} => {
  const intervals = new Map<string, Weekday[]>();
  WEEKDAYS.forEach((weekday) => {
    const day = hours.days[weekday];
    if (!isValidOpenHoursDay(day)) return;
    const key = `${day.open}|${day.close}`;
    intervals.set(key, [...(intervals.get(key) ?? []), weekday]);
  });
  const common = [...intervals.entries()].sort((left, right) =>
    right[1].length - left[1].length)[0];
  if (!common) {
    const days = [...PRESET_DAYS.monday_saturday];
    return { close: '19:00', days, open: '10:00', preset: 'monday_saturday' };
  }
  const [open = '10:00', close = '19:00'] = common[0].split('|');
  return {
    close,
    days: [...common[1]],
    open,
    preset: presetForDays(common[1]),
  };
};

const hasIndividualHoursAdjustments = (
  hours: WeeklyHoursDraft,
  regularHours: ReturnType<typeof deriveRegularHours>,
): boolean => {
  if (hours.setupState !== 'configured') return false;
  if (regularHours.preset === 'custom') return true;
  const base = applyRegularHours(
    hours,
    PRESET_DAYS[regularHours.preset],
    regularHours.open,
    regularHours.close,
  );
  return Boolean(base && !sameWeeklyHours(hours, base));
};

function TimeSelect({
  describedBy,
  inputRef,
  label,
  value,
  onChange,
}: {
  describedBy?: string;
  inputRef?: Ref<HTMLSelectElement>;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const options = value && !TIME_OPTIONS.includes(value)
    ? [...TIME_OPTIONS, value].sort()
    : TIME_OPTIONS;
  return (
    <label className="onboarding-hours-time-field">
      <span>{label}</span>
      <select
        aria-describedby={describedBy}
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose time</option>
        {options.map((option) => (
          <option key={option} value={option}>{formatHoursTimeValue(option)}</option>
        ))}
      </select>
    </label>
  );
}

export function WeeklyHoursEditor({
  hours,
  hideSkipAction = false,
  onChange,
  onSkip,
}: WeeklyHoursEditorProps) {
  const initial = deriveRegularHours(hours);
  const bulkErrorId = useId();
  const dayErrorId = useId();
  const bulkOpenRef = useRef<HTMLSelectElement>(null);
  const bulkCloseRef = useRef<HTMLSelectElement>(null);
  const customDayRef = useRef<HTMLInputElement>(null);
  const dayOpenRef = useRef<HTMLSelectElement>(null);
  const dayCloseRef = useRef<HTMLSelectElement>(null);
  const [preset, setPreset] = useState<RegularHoursPreset>(initial.preset);
  const [selectedDays, setSelectedDays] = useState<Weekday[]>(initial.days);
  const [bulkOpen, setBulkOpen] = useState(initial.open);
  const [bulkClose, setBulkClose] = useState(initial.close);
  const [bulkError, setBulkError] = useState('');
  const [editingDay, setEditingDay] = useState<Weekday | null>(null);
  const [dayDraft, setDayDraft] = useState<DayHoursDraft | null>(null);
  const [dayError, setDayError] = useState('');
  const [copyTargets, setCopyTargets] = useState<Weekday[]>([]);
  const [showCopyTargets, setShowCopyTargets] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [appliedSummary, setAppliedSummary] = useState('');
  const [hasIndividualAdjustments, setHasIndividualAdjustments] = useState(
    () => hasIndividualHoursAdjustments(hours, initial),
  );
  const [pendingRegularHours, setPendingRegularHours] = useState<WeeklyHoursDraft | null>(null);

  const choosePreset = (nextPreset: RegularHoursPreset) => {
    setPreset(nextPreset);
    setBulkError('');
    if (nextPreset !== 'custom') setSelectedDays([...PRESET_DAYS[nextPreset]]);
  };

  const toggleSelectedDay = (weekday: Weekday) => {
    setBulkError('');
    setSelectedDays((current) => current.includes(weekday)
      ? current.filter((item) => item !== weekday)
      : WEEKDAYS.filter((item) => item === weekday || current.includes(item)));
  };

  const commitRegularHours = (next: WeeklyHoursDraft) => {
    onChange(next);
    setBulkError('');
    setHasIndividualAdjustments(false);
    setEditingDay(null);
    setDayDraft(null);
    setCopyTargets([]);
    setShowCopyTargets(false);
    const message = `Regular hours applied to ${selectedDays.length} ${selectedDays.length === 1 ? 'day' : 'days'}.`;
    setAnnouncement('Business hours updated.');
    setAppliedSummary(message);
  };

  const apply = () => {
    if (selectedDays.length === 0) {
      setBulkError('Choose at least one day.');
      customDayRef.current?.focus();
      return;
    }
    const error = getHoursIntervalError(bulkOpen, bulkClose);
    if (error) {
      setBulkError(getHoursIntervalErrorMessage(error));
      if (!bulkOpen.trim()) bulkOpenRef.current?.focus();
      else bulkCloseRef.current?.focus();
      return;
    }
    const next = applyRegularHours(hours, selectedDays, bulkOpen, bulkClose);
    if (!next) return;
    if (hasIndividualAdjustments && !sameWeeklyHours(hours, next)) {
      setPendingRegularHours(next);
      return;
    }
    commitRegularHours(next);
  };

  const beginDayEdit = (weekday: Weekday) => {
    const current = hours.days[weekday];
    setEditingDay(weekday);
    setDayDraft({
      close: current.close || bulkClose,
      closed: current.closed,
      open: current.open || bulkOpen,
    });
    setCopyTargets([]);
    setShowCopyTargets(false);
    setDayError('');
  };

  const saveDay = () => {
    if (!editingDay || !dayDraft) return;
    const error = dayDraft.closed
      ? null
      : getHoursIntervalError(dayDraft.open, dayDraft.close);
    if (error) {
      setDayError(getHoursIntervalErrorMessage(error));
      if (!dayDraft.open.trim()) dayOpenRef.current?.focus();
      else dayCloseRef.current?.focus();
      return;
    }
    let next = updateWeeklyHoursDay(hours, editingDay, dayDraft);
    if (!next) return;
    if (copyTargets.length > 0) {
      next = copyWeeklyHoursDay(next, editingDay, copyTargets);
    }
    if (!sameWeeklyHours(hours, next)) setHasIndividualAdjustments(true);
    onChange(next);
    setAnnouncement(copyTargets.length > 0
      ? `${WEEKDAY_LABELS[editingDay]} hours saved and copied to ${copyTargets.length} ${copyTargets.length === 1 ? 'day' : 'days'}.`
      : `${WEEKDAY_LABELS[editingDay]} hours saved.`);
    setEditingDay(null);
    setDayDraft(null);
    setCopyTargets([]);
    setShowCopyTargets(false);
    setDayError('');
  };

  return (
    <div className="onboarding-hours-editor">
      <section aria-labelledby="regular-hours-heading" className="onboarding-regular-hours">
        <header>
          <h2 id="regular-hours-heading">Set your regular hours</h2>
          <p>Choose the days that usually follow the same schedule.</p>
        </header>
        <fieldset className="onboarding-hours-presets">
          <legend>Days using these hours</legend>
          <div>
            {PRESET_ORDER.map((value) => (
              <label key={value}>
                <input
                  checked={preset === value}
                  name="regular-hours-preset"
                  type="radio"
                  value={value}
                  onChange={() => choosePreset(value)}
                />
                <span>{PRESET_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {preset === 'custom' ? (
          <fieldset
            aria-describedby={bulkError ? bulkErrorId : undefined}
            className="onboarding-hours-day-chips"
          >
            <legend>Choose days</legend>
            <div>
              {WEEKDAYS.map((weekday, index) => (
                <label key={weekday}>
                  <input
                    checked={selectedDays.includes(weekday)}
                    ref={index === 0 ? customDayRef : undefined}
                    type="checkbox"
                    onChange={() => toggleSelectedDay(weekday)}
                  />
                  <span>{WEEKDAY_LABELS[weekday].slice(0, 3)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="onboarding-hours-time-fields">
          <TimeSelect
            describedBy={bulkError ? bulkErrorId : undefined}
            inputRef={bulkOpenRef}
            label="Opens"
            value={bulkOpen}
            onChange={(value) => { setBulkOpen(value); setBulkError(''); }}
          />
          <TimeSelect
            describedBy={bulkError ? bulkErrorId : undefined}
            inputRef={bulkCloseRef}
            label="Closes"
            value={bulkClose}
            onChange={(value) => { setBulkClose(value); setBulkError(''); }}
          />
        </div>
        {bulkError ? (
          <p className="onboarding-field__error" id={bulkErrorId} role="alert">{bulkError}</p>
        ) : null}
        <div className="onboarding-hours-apply-row">
          <button className="onboarding-hours-apply" type="button" onClick={apply}>
            Apply to selected days
          </button>
          {appliedSummary ? (
            <p className="onboarding-hours-applied" role="status">
              <CheckCircle2 aria-hidden="true" />
              <span><strong>Applied</strong><small>{appliedSummary}</small></span>
            </p>
          ) : null}
        </div>
      </section>

      {hours.setupState === 'configured' ? (
        <section aria-labelledby="individual-hours-heading" className="onboarding-individual-hours">
          <header>
            <h3 id="individual-hours-heading">Adjust individual days</h3>
            <p>Close a day or give it different hours without changing your regular schedule.</p>
          </header>
          <ul>
            {WEEKDAYS.map((weekday) => (
              <li key={weekday}>
                <span className={`onboarding-hours-day-state${hours.days[weekday].closed ? ' is-closed' : ''}`} aria-hidden="true" />
                <span>
                  <strong>{WEEKDAY_LABELS[weekday]}</strong>
                  <small>{formatHoursInterval(hours.days[weekday])}</small>
                </span>
                <button
                  aria-label={`Edit ${WEEKDAY_LABELS[weekday]} hours`}
                  type="button"
                  onClick={() => beginDayEdit(weekday)}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dialog
        description={editingDay ? `Set ${WEEKDAY_LABELS[editingDay]}'s hours or mark the day closed.` : ''}
        initialFocusSelector="[name='day-open-state']"
        onClose={() => { setEditingDay(null); setDayDraft(null); }}
        open={Boolean(editingDay && dayDraft)}
        title={editingDay ? `Edit ${WEEKDAY_LABELS[editingDay]}` : 'Edit day'}
        variant="dialog"
      >
        {editingDay && dayDraft ? (
          <section className="onboarding-day-hours-editor">
            <fieldset className="onboarding-hours-day-status">
              <legend>Status</legend>
              <label>
                <input
                  checked={!dayDraft.closed}
                  name="day-open-state"
                  type="radio"
                  onChange={() => {
                    setDayDraft({ ...dayDraft, closed: false });
                    setDayError('');
                  }}
                />
                <span>Open</span>
              </label>
              <label>
                <input
                  checked={dayDraft.closed}
                  name="day-open-state"
                  type="radio"
                  onChange={() => {
                    setDayDraft({ ...dayDraft, closed: true });
                    setDayError('');
                  }}
                />
                <span>Closed</span>
              </label>
            </fieldset>
            {!dayDraft.closed ? (
              <div className="onboarding-hours-time-fields">
                <TimeSelect
                  describedBy={dayError ? dayErrorId : undefined}
                  inputRef={dayOpenRef}
                  label={`${WEEKDAY_LABELS[editingDay]} opens`}
                  value={dayDraft.open}
                  onChange={(open) => {
                    setDayDraft({ ...dayDraft, open });
                    setDayError('');
                  }}
                />
                <TimeSelect
                  describedBy={dayError ? dayErrorId : undefined}
                  inputRef={dayCloseRef}
                  label={`${WEEKDAY_LABELS[editingDay]} closes`}
                  value={dayDraft.close}
                  onChange={(close) => {
                    setDayDraft({ ...dayDraft, close });
                    setDayError('');
                  }}
                />
              </div>
            ) : null}
            {dayError ? (
              <p className="onboarding-field__error" id={dayErrorId} role="alert">{dayError}</p>
            ) : null}
            {!showCopyTargets ? (
              <button
                className="onboarding-day-hours-primary"
                type="button"
                onClick={saveDay}
              >
                Save {WEEKDAY_LABELS[editingDay]}
              </button>
            ) : null}
            <button
              aria-expanded={showCopyTargets}
              className="onboarding-hours-copy-toggle"
              type="button"
              onClick={() => setShowCopyTargets((current) => !current)}
            >
              Copy these hours to other days
            </button>
            {showCopyTargets ? (
              <fieldset className="onboarding-hours-day-chips">
                <legend>Apply these hours to:</legend>
                <div>
                  {WEEKDAYS.filter((weekday) => weekday !== editingDay).map((weekday) => (
                    <label key={weekday}>
                      <input
                        checked={copyTargets.includes(weekday)}
                        type="checkbox"
                        onChange={() => setCopyTargets((current) => current.includes(weekday)
                          ? current.filter((item) => item !== weekday)
                          : WEEKDAYS.filter((item) => item !== editingDay
                            && (item === weekday || current.includes(item))))}
                      />
                      <span>{WEEKDAY_LABELS[weekday].slice(0, 3)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {showCopyTargets ? (
              <footer className="onboarding-overlay-actions onboarding-day-hours-actions">
                <button className="is-primary" type="button" onClick={saveDay}>Apply hours</button>
              </footer>
            ) : null}
          </section>
        ) : null}
      </Dialog>

      {!hideSkipAction ? (
        <div className="onboarding-inline-actions">
          <button type="button" onClick={onSkip}>Skip hours for now</button>
        </div>
      ) : null}
      <p aria-live="polite" className="visually-hidden">{announcement}</p>
      <Dialog
        description="This applies the new regular schedule to the selected days and marks the other days Closed. Individual changes to those days will be replaced."
        initialFocusSelector="[data-dialog-title]"
        onClose={() => setPendingRegularHours(null)}
        open={Boolean(pendingRegularHours)}
        title="Replace your current hours?"
        variant="bottom-sheet"
      >
        <footer className="onboarding-overlay-actions">
          <button type="button" onClick={() => setPendingRegularHours(null)}>
            Keep current hours
          </button>
          <button
            className="is-primary"
            type="button"
            onClick={() => {
              const next = pendingRegularHours;
              setPendingRegularHours(null);
              if (next) commitRegularHours(next);
            }}
          >
            Replace hours
          </button>
        </footer>
      </Dialog>
    </div>
  );
}

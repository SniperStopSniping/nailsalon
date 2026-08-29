import {
  useId,
  useRef,
  useState,
  type Ref,
} from 'react';

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
    onChange(next);
    setBulkError('');
    setAnnouncement(`Regular hours applied to ${selectedDays.length} ${selectedDays.length === 1 ? 'day' : 'days'}.`);
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
          <p>Choose the days that usually use the same schedule. You can adjust any day afterward.</p>
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
        <button className="onboarding-hours-apply" type="button" onClick={apply}>
          Apply to selected days
        </button>
      </section>

      {hours.setupState === 'configured' ? (
        <section aria-labelledby="individual-hours-heading" className="onboarding-individual-hours">
          <header>
            <h3 id="individual-hours-heading">Adjust individual days</h3>
            <p>Close a day or give it different hours without re-entering the full week.</p>
          </header>
          <ul>
            {WEEKDAYS.map((weekday) => (
              <li key={weekday}>
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

      {editingDay && dayDraft ? (
        <section
          aria-labelledby="edit-day-hours-heading"
          className="onboarding-day-hours-editor"
        >
          <header>
            <h3 id="edit-day-hours-heading">Edit {WEEKDAY_LABELS[editingDay]}</h3>
            <button
              type="button"
              onClick={() => { setEditingDay(null); setDayDraft(null); }}
            >
              Cancel
            </button>
          </header>
          <label className="onboarding-hours-closed-control">
            <input
              checked={dayDraft.closed}
              type="checkbox"
              onChange={(event) => {
                setDayDraft({ ...dayDraft, closed: event.target.checked });
                setDayError('');
              }}
            />
            <span>Closed</span>
          </label>
          {!dayDraft.closed ? (
            <div className="onboarding-hours-time-fields">
              <TimeSelect
                describedBy={dayError ? dayErrorId : undefined}
                inputRef={dayOpenRef}
                label={`${WEEKDAY_LABELS[editingDay]} opens`}
                value={dayDraft.open}
                onChange={(open) => { setDayDraft({ ...dayDraft, open }); setDayError(''); }}
              />
              <TimeSelect
                describedBy={dayError ? dayErrorId : undefined}
                inputRef={dayCloseRef}
                label={`${WEEKDAY_LABELS[editingDay]} closes`}
                value={dayDraft.close}
                onChange={(close) => { setDayDraft({ ...dayDraft, close }); setDayError(''); }}
              />
            </div>
          ) : null}
          {dayError ? (
            <p className="onboarding-field__error" id={dayErrorId} role="alert">{dayError}</p>
          ) : null}
          <button
            aria-expanded={showCopyTargets}
            className="onboarding-hours-copy-toggle"
            type="button"
            onClick={() => setShowCopyTargets((current) => !current)}
          >
            Copy to other days
          </button>
          {showCopyTargets ? (
            <fieldset className="onboarding-hours-day-chips">
              <legend>Copy {WEEKDAY_LABELS[editingDay]} to</legend>
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
          <button className="onboarding-hours-save-day" type="button" onClick={saveDay}>
            Save changes
          </button>
        </section>
      ) : null}

      <div className="onboarding-inline-actions">
        <button type="button" onClick={onSkip}>Skip hours for now</button>
      </div>
      <p aria-live="polite" className="visually-hidden">{announcement}</p>
    </div>
  );
}

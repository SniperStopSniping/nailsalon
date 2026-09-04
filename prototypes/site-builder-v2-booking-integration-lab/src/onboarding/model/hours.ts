import type {
  DayHoursDraft,
  Weekday,
  WeeklyHoursDraft,
} from './types';

export const ONBOARDING_PREVIEW_TIME_ZONE = 'America/Toronto';

export type WeeklyHoursPreviewStatus = {
  kind: 'closed' | 'open';
  label: string;
  weekday: Weekday;
};

export type PublicWeeklyHoursRow = {
  hours: string;
  label: string;
  weekday: Weekday;
};

export const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  friday: 'Friday',
  monday: 'Monday',
  saturday: 'Saturday',
  sunday: 'Sunday',
  thursday: 'Thursday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
};

const WEEKDAY_BY_LABEL: Record<string, Weekday> = {
  Friday: 'friday',
  Monday: 'monday',
  Saturday: 'saturday',
  Sunday: 'sunday',
  Thursday: 'thursday',
  Tuesday: 'tuesday',
  Wednesday: 'wednesday',
};

export const parseHoursTime = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/u.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return (hours * 60) + minutes;
};

export const isValidOpenHoursDay = (day: DayHoursDraft): boolean => {
  if (day.closed) {
    return false;
  }
  const open = parseHoursTime(day.open);
  const close = parseHoursTime(day.close);
  return open !== null && close !== null && close > open;
};

export type HoursIntervalError = 'closing_not_after_open' | 'partial';

export const getHoursIntervalError = (
  openValue: string,
  closeValue: string,
): HoursIntervalError | null => {
  const hasOpen = Boolean(openValue.trim());
  const hasClose = Boolean(closeValue.trim());
  if (!hasOpen && !hasClose) {
    return 'partial';
  }
  if (!hasOpen || !hasClose) {
    return 'partial';
  }
  const open = parseHoursTime(openValue);
  const close = parseHoursTime(closeValue);
  if (open === null || close === null) {
    return 'partial';
  }
  return close > open ? null : 'closing_not_after_open';
};

export const getHoursIntervalErrorMessage = (
  error: HoursIntervalError,
): string => error === 'closing_not_after_open'
  ? 'Closing time must be later than opening time.'
  : 'Choose both an opening and closing time.';

export const isInvalidEnteredHoursDay = (day: DayHoursDraft): boolean => {
  if (day.closed) {
    return false;
  }
  if (!day.open.trim() && !day.close.trim()) {
    return false;
  }
  return getHoursIntervalError(day.open, day.close) !== null;
};

export const hasInvalidEnteredWeeklyHours = (hours: WeeklyHoursDraft): boolean =>
  Object.values(hours.days).some(isInvalidEnteredHoursDay);

const formatTime = (minutes: number): string => new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
}).format(new Date(Date.UTC(2026, 0, 1, Math.floor(minutes / 60), minutes % 60)));

export const formatHoursTimeValue = (value: string): string => {
  const minutes = parseHoursTime(value);
  return minutes === null ? value : formatTime(minutes);
};

export const formatHoursInterval = (day: DayHoursDraft): string => {
  if (day.closed) {
    return 'Closed';
  }
  if (!isValidOpenHoursDay(day)) {
    return 'Needs attention';
  }
  return `${formatHoursTimeValue(day.open)}–${formatHoursTimeValue(day.close)}`;
};

const nextOpeningLabel = (
  weekday: Weekday,
  dayOffset: number,
  open: number,
): string => {
  const dayLabel = dayOffset === 0
    ? 'today'
    : dayOffset === 1
      ? 'tomorrow'
      : WEEKDAY_LABELS[weekday];
  return `Opens ${dayLabel} at ${formatTime(open)}`;
};

const getPreviewClock = (
  timestamp: string,
  timeZone: string,
): { minutes: number; weekday: Weekday } | null => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    timeZone,
    weekday: 'long',
  }).formatToParts(date);
  const weekdayLabel = parts.find(part => part.type === 'weekday')?.value;
  const hours = Number(parts.find(part => part.type === 'hour')?.value);
  const minutes = Number(parts.find(part => part.type === 'minute')?.value);
  const weekday = weekdayLabel ? WEEKDAY_BY_LABEL[weekdayLabel] : undefined;
  if (!weekday || Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return { minutes: (hours * 60) + minutes, weekday };
};

export const getConfiguredOpenDayCount = (hours: WeeklyHoursDraft): number =>
  Object.values(hours.days).filter(isValidOpenHoursDay).length;

export const hasConfiguredWeeklyHours = (hours: WeeklyHoursDraft): boolean =>
  getConfiguredOpenDayCount(hours) > 0;

export const hasCompleteWeeklyHours = (hours: WeeklyHoursDraft): boolean =>
  hasConfiguredWeeklyHours(hours) && !hasInvalidEnteredWeeklyHours(hours);

export const applyRegularHours = (
  hours: WeeklyHoursDraft,
  selectedDays: readonly Weekday[],
  open: string,
  close: string,
): WeeklyHoursDraft | null => {
  if (selectedDays.length === 0 || getHoursIntervalError(open, close)) {
    return null;
  }
  const selected = new Set(selectedDays);
  const days = Object.fromEntries(WEEKDAYS.map((weekday) => {
    if (selected.has(weekday)) {
      return [weekday, { close, closed: false, open }];
    }
    return [weekday, { close: '', closed: true, open: '' }];
  })) as WeeklyHoursDraft['days'];
  return {
    ...hours,
    days,
    setupState: 'configured',
  };
};

export const updateWeeklyHoursDay = (
  hours: WeeklyHoursDraft,
  weekday: Weekday,
  day: DayHoursDraft,
): WeeklyHoursDraft | null => {
  if (!day.closed && getHoursIntervalError(day.open, day.close)) {
    return null;
  }
  const days = {
    ...hours.days,
    [weekday]: { ...day },
  };
  return {
    ...hours,
    days,
    setupState: Object.values(days).some(isValidOpenHoursDay)
      ? 'configured'
      : 'unset',
  };
};

export const copyWeeklyHoursDay = (
  hours: WeeklyHoursDraft,
  sourceDay: Weekday,
  targetDays: readonly Weekday[],
): WeeklyHoursDraft => {
  const source = hours.days[sourceDay];
  const targets = new Set(targetDays.filter(weekday => weekday !== sourceDay));
  const days = Object.fromEntries(WEEKDAYS.map(weekday => [
    weekday,
    targets.has(weekday) ? { ...source } : { ...hours.days[weekday] },
  ])) as WeeklyHoursDraft['days'];
  return {
    ...hours,
    days,
    setupState: Object.values(days).some(isValidOpenHoursDay)
      ? 'configured'
      : 'unset',
  };
};

export const getWeeklyHoursSetupSummary = (hours: WeeklyHoursDraft): string => {
  if (hours.setupState === 'unset') {
    return 'Not set · Optional';
  }
  if (hours.setupState === 'skipped') {
    return 'Not shown on your site';
  }
  if (hasInvalidEnteredWeeklyHours(hours)) {
    return 'Finish your hours';
  }
  const openDays = getConfiguredOpenDayCount(hours);
  if (openDays === 0) {
    return 'Not set · Optional';
  }
  if (!hours.showOnSite) {
    return 'Not shown on your site';
  }
  return `${openDays} day${openDays === 1 ? '' : 's'} · Shown on your site`;
};

export const getWeeklyHoursCardSummary = (hours: WeeklyHoursDraft): string => {
  if (hours.setupState === 'unset') {
    return 'Add your business hours';
  }
  if (hours.setupState === 'skipped' || !hours.showOnSite) {
    return 'Not shown on your website';
  }
  if (hasInvalidEnteredWeeklyHours(hours)) {
    return 'Finish your hours';
  }
  const openDays = WEEKDAYS.filter(weekday => isValidOpenHoursDay(hours.days[weekday]));
  if (openDays.length === 0) {
    return 'Add your business hours';
  }
  const first = hours.days[openDays[0] ?? 'monday'];
  const sharesInterval = openDays.every((weekday) => {
    const day = hours.days[weekday];
    return day.open === first.open && day.close === first.close;
  });
  const dayLabel = openDays.length === 7
    ? 'Every day'
    : openDays.length === 6
      && openDays.every(weekday => weekday !== 'sunday')
      ? 'Mon–Sat'
      : openDays.length === 5
        && openDays.every(weekday => weekday !== 'saturday' && weekday !== 'sunday')
        ? 'Mon–Fri'
        : `${openDays.length} day${openDays.length === 1 ? '' : 's'}`;
  return sharesInterval
    ? `${dayLabel} · ${formatHoursInterval(first)}`
    : `${dayLabel} configured`;
};

export const getPublicWeeklyHours = (
  hours: WeeklyHoursDraft,
): PublicWeeklyHoursRow[] => {
  if (
    hours.setupState !== 'configured'
    || !hours.showOnSite
    || !hasCompleteWeeklyHours(hours)
  ) {
    return [];
  }
  return WEEKDAYS.flatMap((weekday) => {
    const day = hours.days[weekday];
    if (day.closed) {
      return [{ hours: 'Closed', label: WEEKDAY_LABELS[weekday], weekday }];
    }
    const open = parseHoursTime(day.open);
    const close = parseHoursTime(day.close);
    if (open === null || close === null || close <= open) {
      return [];
    }
    return [{
      hours: `${formatTime(open)}–${formatTime(close)}`,
      label: WEEKDAY_LABELS[weekday],
      weekday,
    }];
  });
};

export const getWeeklyHoursPreviewStatus = (
  hours: WeeklyHoursDraft,
  timestamp: string,
  timeZone = ONBOARDING_PREVIEW_TIME_ZONE,
): WeeklyHoursPreviewStatus | null => {
  if (
    hours.setupState !== 'configured'
    || !hours.showOnSite
    || !hasCompleteWeeklyHours(hours)
  ) {
    return null;
  }
  const clock = getPreviewClock(timestamp, timeZone);
  if (!clock) {
    return null;
  }
  const day = hours.days[clock.weekday];
  const open = parseHoursTime(day.open);
  const close = parseHoursTime(day.close);
  if (
    !day.closed
    && open !== null
    && close !== null
    && close > open
    && clock.minutes >= open
    && clock.minutes < close
  ) {
    return {
      kind: 'open',
      label: `Open until ${formatTime(close)}`,
      weekday: clock.weekday,
    };
  }

  const currentWeekdayIndex = WEEKDAYS.indexOf(clock.weekday);
  for (let dayOffset = 0; dayOffset <= WEEKDAYS.length; dayOffset += 1) {
    const candidateWeekday = WEEKDAYS[
      (currentWeekdayIndex + dayOffset) % WEEKDAYS.length
    ];
    if (!candidateWeekday) {
      continue;
    }
    const candidate = hours.days[candidateWeekday];
    if (!isValidOpenHoursDay(candidate)) {
      continue;
    }
    const candidateOpen = parseHoursTime(candidate.open);
    if (candidateOpen === null) {
      continue;
    }
    if (dayOffset === 0 && clock.minutes >= candidateOpen) {
      continue;
    }
    return {
      kind: 'closed',
      label: nextOpeningLabel(candidateWeekday, dayOffset, candidateOpen),
      weekday: clock.weekday,
    };
  }

  return { kind: 'closed', label: 'Closed', weekday: clock.weekday };
};

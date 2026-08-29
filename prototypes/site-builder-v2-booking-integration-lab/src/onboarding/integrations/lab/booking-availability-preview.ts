import type { BookingAvailabilityPreview } from '../contracts/booking-preferences';

const LAB_PREVIEW_TIME_ZONE = 'America/Toronto';
const LAB_SALON_TIME_KEYS = new Set([
  '09:00',
  '10:30',
  '13:00',
  '15:30',
  '18:00',
  '20:00',
]);

const getTorontoTimeKey = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: LAB_PREVIEW_TIME_ZONE,
  }).formatToParts(date);
  const hour = parts.find(({ type }) => type === 'hour')?.value ?? '00';
  const minute = parts.find(({ type }) => type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
};

const formatCandidateTime = (startsAt: Date, previewAt: Date): string => {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    day: 'numeric',
    month: 'short',
    timeZone: LAB_PREVIEW_TIME_ZONE,
    weekday: 'short',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: LAB_PREVIEW_TIME_ZONE,
  });
  const sameTorontoDay = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: LAB_PREVIEW_TIME_ZONE,
    year: 'numeric',
  }).format(startsAt) === new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: LAB_PREVIEW_TIME_ZONE,
    year: 'numeric',
  }).format(previewAt);
  return `${sameTorontoDay ? 'Today' : dateFormatter.format(startsAt)} · ${timeFormatter.format(startsAt)}`;
};

export const createLabBookingAvailabilityPreview = (
  minimumNoticeMinutes: number,
  previewTimestamp: string,
): BookingAvailabilityPreview => {
  const previewAt = new Date(previewTimestamp);
  const safePreviewAt = Number.isNaN(previewAt.getTime())
    ? new Date()
    : previewAt;
  const normalizedNotice = Number.isFinite(minimumNoticeMinutes)
    ? Math.max(0, Math.round(minimumNoticeMinutes))
    : 0;
  const cutoffAt = new Date(
    safePreviewAt.getTime() + (normalizedNotice * 60_000),
  );
  const firstHalfHour = new Date(
    Math.ceil((safePreviewAt.getTime() + 1) / 1_800_000) * 1_800_000,
  );
  const fixtureEndAt = new Date(safePreviewAt.getTime() + (7 * 24 * 60 * 60_000));
  const bookableTimes: BookingAvailabilityPreview['bookableTimes'][number][] = [];
  for (let step = 0; step < 7 * 48 && bookableTimes.length < 7; step += 1) {
    const startsAt = new Date(firstHalfHour.getTime() + (step * 1_800_000));
    if (startsAt >= fixtureEndAt) break;
    if (startsAt < cutoffAt || startsAt <= safePreviewAt) continue;
    if (!LAB_SALON_TIME_KEYS.has(getTorontoTimeKey(startsAt))) continue;
    bookableTimes.push({
      id: `lab-time-${Math.round((startsAt.getTime() - safePreviewAt.getTime()) / 60_000)}`,
      label: formatCandidateTime(startsAt, safePreviewAt),
      startsAt: startsAt.toISOString(),
    });
  }

  return {
    bookableTimes,
    cutoffAt: cutoffAt.toISOString(),
    source: 'lab-seeded-candidate-times',
  };
};

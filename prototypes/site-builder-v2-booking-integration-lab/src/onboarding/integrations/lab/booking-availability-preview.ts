import type { BookingAvailabilityPreview } from '../contracts/booking-preferences';

/**
 * These offsets are a deterministic UX-Lab fixture, not salon availability.
 * The future Production BookingPreferencesPort will replace them with slots
 * returned by the existing tenant-scoped availability service.
 */
const LAB_CANDIDATE_TIME_OFFSETS_MINUTES = [
  60,
  240,
  720,
  1_560,
  3_000,
  4_440,
  5_880,
] as const;

const formatCandidateTime = (startsAt: Date, previewAt: Date): string => {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Toronto',
    weekday: 'short',
  });
  const timeFormatter = new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto',
  });
  const sameTorontoDay = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Toronto',
    year: 'numeric',
  }).format(startsAt) === new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Toronto',
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
    ? new Date('2026-08-27T18:30:00.000Z')
    : previewAt;
  const normalizedNotice = Number.isFinite(minimumNoticeMinutes)
    ? Math.max(0, Math.round(minimumNoticeMinutes))
    : 0;
  const cutoffAt = new Date(
    safePreviewAt.getTime() + (normalizedNotice * 60_000),
  );
  const bookableTimes = LAB_CANDIDATE_TIME_OFFSETS_MINUTES.flatMap((offset) => {
    const startsAt = new Date(safePreviewAt.getTime() + (offset * 60_000));
    if (startsAt < cutoffAt) return [];
    return [{
      id: `lab-time-${offset}`,
      label: formatCandidateTime(startsAt, safePreviewAt),
      startsAt: startsAt.toISOString(),
    }];
  });

  return {
    bookableTimes,
    cutoffAt: cutoffAt.toISOString(),
    source: 'lab-seeded-candidate-times',
  };
};

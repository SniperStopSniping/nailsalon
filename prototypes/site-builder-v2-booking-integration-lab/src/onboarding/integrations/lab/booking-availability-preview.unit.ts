import { createLabBookingAvailabilityPreview } from './booking-availability-preview';

describe('Lab booking availability preview', () => {
  const previewTimestamp = '2026-08-27T18:30:00.000Z';

  it('filters one deterministic candidate set through the selected minimum notice', () => {
    const noNotice = createLabBookingAvailabilityPreview(0, previewTimestamp);
    const twoHours = createLabBookingAvailabilityPreview(120, previewTimestamp);
    const oneDay = createLabBookingAvailabilityPreview(1_440, previewTimestamp);

    expect(noNotice.bookableTimes.map(({ id }) => id)).toContain('lab-time-60');
    expect(twoHours.bookableTimes.map(({ id }) => id)).not.toContain('lab-time-60');
    expect(twoHours.bookableTimes[0]?.id).toBe('lab-time-210');
    expect(oneDay.bookableTimes[0]?.id).toBe('lab-time-1500');
    expect(oneDay.cutoffAt).toBe('2026-08-28T18:30:00.000Z');
    expect(noNotice.bookableTimes.every((time, index, all) => (
      index === 0 || time.startsAt > all[index - 1]!.startsAt
    ))).toBe(true);

    const localHours = noNotice.bookableTimes.map(({ startsAt }) => Number(
      new Intl.DateTimeFormat('en-CA', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'America/Toronto',
      }).format(new Date(startsAt)),
    ));

    expect(localHours.every(hour => hour >= 8 && hour < 22)).toBe(true);
  });

  it('returns no fabricated time when the notice exceeds the bounded fixture window', () => {
    const preview = createLabBookingAvailabilityPreview(10_080, previewTimestamp);

    expect(preview.bookableTimes).toEqual([]);
    expect(preview.source).toBe('lab-seeded-candidate-times');
  });

  it('falls back from an invalid saved clock without reviving stale past appointments', () => {
    const before = Date.now();
    const preview = createLabBookingAvailabilityPreview(0, 'not-a-date');

    expect(new Date(preview.cutoffAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(preview.bookableTimes.every(({ startsAt }) => (
      new Date(startsAt).getTime() > before
    ))).toBe(true);
  });
});

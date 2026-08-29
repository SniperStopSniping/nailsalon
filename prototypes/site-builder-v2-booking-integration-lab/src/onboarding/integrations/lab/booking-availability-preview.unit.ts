import { createLabBookingAvailabilityPreview } from './booking-availability-preview';

describe('Lab booking availability preview', () => {
  const previewTimestamp = '2026-08-27T18:30:00.000Z';

  it('filters one deterministic candidate set through the selected minimum notice', () => {
    const noNotice = createLabBookingAvailabilityPreview(0, previewTimestamp);
    const twoHours = createLabBookingAvailabilityPreview(120, previewTimestamp);
    const oneDay = createLabBookingAvailabilityPreview(1_440, previewTimestamp);

    expect(noNotice.bookableTimes.map(({ id }) => id)).toContain('lab-time-60');
    expect(twoHours.bookableTimes.map(({ id }) => id)).not.toContain('lab-time-60');
    expect(twoHours.bookableTimes[0]?.id).toBe('lab-time-240');
    expect(oneDay.bookableTimes[0]?.id).toBe('lab-time-1560');
    expect(oneDay.cutoffAt).toBe('2026-08-28T18:30:00.000Z');
  });

  it('returns no fabricated time when the notice exceeds the bounded fixture window', () => {
    const preview = createLabBookingAvailabilityPreview(10_080, previewTimestamp);

    expect(preview.bookableTimes).toEqual([]);
    expect(preview.source).toBe('lab-seeded-candidate-times');
  });
});

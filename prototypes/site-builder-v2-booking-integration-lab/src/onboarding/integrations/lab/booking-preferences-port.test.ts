import { createLabBookingPreferencesPort } from './booking-preferences-port';

describe('Lab BookingPreferencesPort', () => {
  const port = createLabBookingPreferencesPort();

  it.each([
    [0, 'preset:0'],
    [120, 'preset:120'],
    [240, 'preset:240'],
    [480, 'preset:480'],
    [720, 'preset:720'],
    [1_440, 'preset:1440'],
    [2_880, 'preset:2880'],
    [4_320, 'preset:4320'],
  ] as const)('recognizes the %i-minute preset', (minutes, choice) => {
    expect(port.getMinimumNoticeChoice(minutes)).toBe(choice);
  });

  it('normalizes custom hours and days to minutes', () => {
    expect(port.implementation).toBe('lab-only');
    expect(port.normalizeCustomMinimumNotice('5', 'hours')).toBe(300);
    expect(port.normalizeCustomMinimumNotice('2.5', 'days')).toBe(3_600);
    expect(port.getCustomMinimumNoticeInput(3_600)).toEqual({
      amount: '2.5',
      unit: 'days',
    });
  });

  it('filters the Lab candidate appointment times through the normalized notice', () => {
    const previewTimestamp = '2026-08-27T18:30:00.000Z';
    const noNotice = port.getAvailabilityPreview(0, previewTimestamp);
    const twoHours = port.getAvailabilityPreview(120, previewTimestamp);
    const threeDays = port.getAvailabilityPreview(4_320, previewTimestamp);

    expect(noNotice.bookableTimes[0]?.id).toBe('lab-time-60');
    expect(twoHours.bookableTimes[0]?.id).toBe('lab-time-240');
    expect(threeDays.bookableTimes.map(({ id }) => id)).toEqual([
      'lab-time-4440',
      'lab-time-5880',
    ]);
  });

  it('rejects blank, zero, and invalid custom values instead of converting them to zero', () => {
    expect(port.normalizeCustomMinimumNotice('', 'hours')).toBeNull();
    expect(port.normalizeCustomMinimumNotice('  ', 'days')).toBeNull();
    expect(port.normalizeCustomMinimumNotice('0', 'hours')).toBeNull();
    expect(port.normalizeCustomMinimumNotice('-2', 'days')).toBeNull();
    expect(port.normalizeCustomMinimumNotice('not a number', 'hours')).toBeNull();
    expect(port.normalizeCustomDepositAmount('')).toBeNull();
    expect(port.normalizeCustomDepositAmount('$0')).toBeNull();
    expect(port.normalizeCustomDepositAmount('-12')).toBeNull();
    expect(port.normalizeCustomDepositAmount('not a number')).toBeNull();
  });

  it('keeps one normalized fixed-deposit draft and has no service-level mode', () => {
    const initial = {
      amountCents: null,
      mode: 'none' as const,
      refundable: null,
      transferable: null,
      wordingOverride: '',
    };
    const fixed = port.updateDepositDraft(initial, {
      amountCents: port.normalizeCustomDepositAmount('$37.50'),
      mode: 'fixed',
    });

    expect(fixed).toEqual({
      ...initial,
      amountCents: 3_750,
      mode: 'fixed',
    });
    expect(port.depositAmountPresets).toEqual([
      1_000,
      1_500,
      2_000,
      2_500,
      3_000,
      4_000,
      5_000,
    ]);
    expect(JSON.stringify(fixed)).not.toMatch(/service.level|percentage/iu);
  });
});

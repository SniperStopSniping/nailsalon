import { describe, expect, it, vi } from 'vitest';

import { evaluateSmartFitSlot } from '@/libs/smartFit';
import {
  buildSmartFitClientKeys,
  buildSmartFitDayContext,
  buildSmartFitSlotAnnotation,
  smartFitServiceScopeAllows,
} from '@/libs/smartFitBooking';
import type { ResolvedSmartFitConfig } from '@/libs/smartFitConfig';
import { zonedTimeToUtc } from '@/libs/timeZone';
import type { WeeklySchedule } from '@/models/Schema';

// bookingPolicy (schedule resolution helpers) transitively imports the DB
// module; the builder itself never touches the database.
vi.mock('@/libs/DB', () => ({ db: null }));

const DATE = '2026-07-22'; // a Wednesday
const TIME_ZONE = 'America/Toronto';

const at = (time: string) => zonedTimeToUtc({ date: DATE, time, timeZone: TIME_ZONE });
const atMs = (time: string) => at(time).getTime();

const GRID_ANCHOR_MS = atMs('0:00');
const NOW_MS = atMs('6:00');

const WEEKLY: WeeklySchedule = {
  wednesday: { start: '9:00', end: '17:00' },
} as WeeklySchedule;

const ENABLED: ResolvedSmartFitConfig = {
  enabled: true,
  discountType: 'percent',
  value: 10,
  maxRemainingGapMinutes: 10,
  minImprovementMinutes: 20,
  eligibleServiceIds: [],
  eligibleTechnicianIds: [],
};

function baseArgs() {
  return {
    technicianId: 'tech_1',
    weeklySchedule: WEEKLY,
    appointments: [],
    locationId: null,
    date: DATE,
    timeZone: TIME_ZONE,
    slotIntervalMinutes: 15,
    gridAnchorMs: GRID_ANCHOR_MS,
    nowMs: NOW_MS,
  };
}

describe('buildSmartFitClientKeys', () => {
  it('produces stable opaque keys and collapses phone formats to one key', () => {
    const fromRaw = buildSmartFitClientKeys({
      salonClientId: 'sc_1',
      clientPhone: '+1 (416) 555-1234',
    });
    const fromStored = buildSmartFitClientKeys({
      salonClientId: 'sc_1',
      clientPhone: '4165551234',
    });

    expect(fromRaw).toEqual(['client:sc_1', 'phone:4165551234']);
    expect(fromStored).toEqual(fromRaw);
  });

  it('returns no keys for an anonymous identity', () => {
    expect(buildSmartFitClientKeys({})).toEqual([]);
    expect(buildSmartFitClientKeys({ salonClientId: null, clientPhone: '' })).toEqual([]);
  });
});

describe('buildSmartFitDayContext — working window', () => {
  it('converts the weekly schedule to UTC instants on the slot-grid basis', () => {
    const context = buildSmartFitDayContext(baseArgs());

    expect(context).not.toBeNull();
    expect(context!.workStartMs).toBe(atMs('9:00'));
    expect(context!.workEndMs).toBe(atMs('17:00'));
    expect(context!.technicianId).toBe('tech_1');
    expect(context!.gridAnchorMs).toBe(GRID_ANCHOR_MS);
  });

  it('intersects location business hours into the working window', () => {
    const context = buildSmartFitDayContext({
      ...baseArgs(),
      locationId: 'loc_1',
      locationBusinessHours: {
        wednesday: { open: '10:00', close: '16:00' },
      },
    });

    expect(context!.workStartMs).toBe(atMs('10:00'));
    expect(context!.workEndMs).toBe(atMs('16:00'));
    expect(context!.locationId).toBe('loc_1');
  });

  it('returns null when the location is closed that day', () => {
    const context = buildSmartFitDayContext({
      ...baseArgs(),
      locationId: 'loc_1',
      locationBusinessHours: { wednesday: null },
    });

    expect(context).toBeNull();
  });

  it('returns null on a day off, on time off, and for an inverted window', () => {
    expect(buildSmartFitDayContext({
      ...baseArgs(),
      weeklySchedule: { monday: { start: '9:00', end: '17:00' } } as WeeklySchedule,
    })).toBeNull();

    expect(buildSmartFitDayContext({ ...baseArgs(), isOnTimeOff: true })).toBeNull();

    expect(buildSmartFitDayContext({
      ...baseArgs(),
      override: { technicianId: 'tech_1', type: 'off', startTime: null, endTime: null },
    })).toBeNull();

    expect(buildSmartFitDayContext({
      ...baseArgs(),
      locationId: 'loc_1',
      locationBusinessHours: { wednesday: { open: '18:00', close: '20:00' } },
    })).toBeNull();
  });

  it('applies an hours override in place of the weekly schedule', () => {
    const context = buildSmartFitDayContext({
      ...baseArgs(),
      override: { technicianId: 'tech_1', type: 'hours', startTime: '11:00', endTime: '15:00' },
    });

    expect(context!.workStartMs).toBe(atMs('11:00'));
    expect(context!.workEndMs).toBe(atMs('15:00'));
  });
});

describe('buildSmartFitDayContext — blocks', () => {
  it('builds appointment blocks with the blocked end (duration + buffer fallback chain)', () => {
    const context = buildSmartFitDayContext({
      ...baseArgs(),
      appointments: [
        {
          // Explicit blocked duration wins.
          id: 'appt_a',
          startTime: at('9:00'),
          endTime: at('10:00'),
          blockedDurationMinutes: 70,
          totalDurationMinutes: 60,
          bufferMinutes: 5,
          salonClientId: 'sc_a',
          clientPhone: '4165550001',
        },
        {
          // Falls back to visible + buffer.
          id: 'appt_b',
          startTime: at('12:00'),
          endTime: at('13:00'),
          blockedDurationMinutes: null,
          totalDurationMinutes: 60,
          bufferMinutes: 10,
        },
        {
          // Falls back to wall-clock delta with a zero buffer.
          id: 'appt_c',
          startTime: at('15:00'),
          endTime: at('15:45'),
        },
      ],
    });

    const byId = new Map(context!.blocks.map(block => [block.id, block]));

    expect(byId.get('appt_a')).toMatchObject({
      kind: 'appointment',
      startMs: atMs('9:00'),
      endMs: atMs('10:10'),
      clientKeys: ['client:sc_a', 'phone:4165550001'],
    });
    expect(byId.get('appt_b')).toMatchObject({
      startMs: atMs('12:00'),
      endMs: atMs('13:10'),
    });
    expect(byId.get('appt_b')!.clientKeys).toBeUndefined();
    expect(byId.get('appt_c')).toMatchObject({
      startMs: atMs('15:00'),
      endMs: atMs('15:45'),
    });
  });

  it('converts breaks on the slot-grid basis and appends Google busy as shrink-only blocks', () => {
    const context = buildSmartFitDayContext({
      ...baseArgs(),
      blockedSlots: [
        { startTime: '12:00', endTime: '13:00', label: 'Lunch' },
        { startTime: '14:00', endTime: '13:00', label: 'Inverted (dropped)' },
      ],
      googleBusyWindows: [
        { startTime: at('15:00'), endTime: at('15:30') },
      ],
    });

    const kinds = context!.blocks.map(block => [block.id, block.kind]);

    expect(kinds).toEqual([
      ['break:12:00-13:00', 'break'],
      ['google:0', 'google_busy'],
    ]);
    expect(context!.blocks[0]).toMatchObject({
      startMs: atMs('12:00'),
      endMs: atMs('13:00'),
    });
  });

  it('feeds the evaluator end-to-end: a tight fit beside a real appointment qualifies', () => {
    const context = buildSmartFitDayContext({
      ...baseArgs(),
      appointments: [{
        id: 'appt_prev',
        startTime: at('9:00'),
        endTime: at('10:00'),
        blockedDurationMinutes: 60,
        salonClientId: 'sc_other',
        clientPhone: '4165559999',
      }],
    });

    const evaluation = evaluateSmartFitSlot({
      config: ENABLED,
      candidate: {
        startMs: atMs('10:00'),
        visibleDurationMinutes: 75,
        bufferMinutes: 10,
        serviceId: 'srv_1',
        technicianId: null,
        locationId: null,
        clientKeys: buildSmartFitClientKeys({ salonClientId: 'sc_me', clientPhone: '4165550000' }),
      },
      day: context!,
    });

    expect(evaluation.eligible).toBe(true);
    expect(evaluation.qualifyingSides).toEqual(['before']);
  });
});

describe('buildSmartFitSlotAnnotation', () => {
  const eligibleEvaluation = () => {
    const context = buildSmartFitDayContext({
      ...baseArgs(),
      appointments: [{
        id: 'appt_prev',
        startTime: at('9:00'),
        endTime: at('10:00'),
        blockedDurationMinutes: 60,
        salonClientId: 'sc_other',
        clientPhone: '4165559999',
      }],
    });
    return evaluateSmartFitSlot({
      config: ENABLED,
      candidate: {
        startMs: atMs('10:00'),
        visibleDurationMinutes: 75,
        bufferMinutes: 10,
        serviceId: 'srv_1',
        technicianId: null,
        locationId: null,
      },
      day: context!,
    });
  };

  it('derives prices and minutes for an eligible evaluation', () => {
    const annotation = buildSmartFitSlotAnnotation({
      config: ENABLED,
      evaluation: eligibleEvaluation(),
      subtotalBeforeDiscountCents: 6500,
    });

    expect(annotation).toEqual({
      eligible: true,
      discountType: 'percent',
      discountValue: 10,
      discountAmountCents: 650,
      originalPriceCents: 6500,
      discountedPriceCents: 5850,
      qualifyingSides: ['before'],
      improvementMinutes: expect.any(Number),
      consolidatedMinutes: expect.any(Number),
    });
  });

  it('never leaks neighbor records, ids, reasons, or client keys', () => {
    const annotation = buildSmartFitSlotAnnotation({
      config: ENABLED,
      evaluation: eligibleEvaluation(),
      subtotalBeforeDiscountCents: 6500,
    });

    const serialized = JSON.stringify(annotation);

    expect(serialized).not.toContain('appt_prev');
    expect(serialized).not.toContain('client:');
    expect(serialized).not.toContain('phone:');
    expect(serialized).not.toContain('neighbor');
    expect(serialized).not.toContain('4165559999');
  });

  it('returns null for ineligible evaluations and zero-value discounts', () => {
    const context = buildSmartFitDayContext(baseArgs());
    const openDayEvaluation = evaluateSmartFitSlot({
      config: ENABLED,
      candidate: {
        startMs: atMs('12:00'),
        visibleDurationMinutes: 60,
        bufferMinutes: 10,
        serviceId: 'srv_1',
        technicianId: null,
        locationId: null,
      },
      day: context!,
    });

    expect(openDayEvaluation.eligible).toBe(false);
    expect(buildSmartFitSlotAnnotation({
      config: ENABLED,
      evaluation: openDayEvaluation,
      subtotalBeforeDiscountCents: 6500,
    })).toBeNull();

    expect(buildSmartFitSlotAnnotation({
      config: { ...ENABLED, value: 0 },
      evaluation: eligibleEvaluation(),
      subtotalBeforeDiscountCents: 6500,
    })).toBeNull();
  });
});

describe('smartFitServiceScopeAllows', () => {
  it('applies the allowlist to the whole basket', () => {
    expect(smartFitServiceScopeAllows(ENABLED, ['srv_1', 'srv_2'])).toBe(true);
    expect(smartFitServiceScopeAllows(
      { ...ENABLED, eligibleServiceIds: ['srv_1', 'srv_2'] },
      ['srv_1', 'srv_2'],
    )).toBe(true);
    expect(smartFitServiceScopeAllows(
      { ...ENABLED, eligibleServiceIds: ['srv_1'] },
      ['srv_1', 'srv_2'],
    )).toBe(false);
    expect(smartFitServiceScopeAllows(ENABLED, [])).toBe(false);
  });
});

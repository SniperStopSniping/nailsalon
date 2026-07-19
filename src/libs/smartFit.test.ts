import { describe, expect, it } from 'vitest';

import {
  calculateSmartFitDiscountCents,
  effectiveMaxGapMinutes,
  evaluateSmartFitSlot,
  SMART_FIT_REASONS,
  type SmartFitBlock,
  type SmartFitCandidate,
  type SmartFitDayContext,
} from '@/libs/smartFit';
import {
  DISABLED_SMART_FIT_CONFIG,
  type ResolvedSmartFitConfig,
  resolveSmartFitConfig,
} from '@/libs/smartFitConfig';
import type { SalonSettings } from '@/types/salonPolicy';

// ---------------------------------------------------------------------------
// Harness — all times are fixed UTC ms offsets from an arbitrary grid anchor
// ("salon-local midnight"), keeping every test deterministic and DST-free.
// ---------------------------------------------------------------------------

const DAY0 = 1_800_000_000_000;
const t = (hours: number, minutes = 0) => DAY0 + (hours * 60 + minutes) * 60_000;

const ENABLED: ResolvedSmartFitConfig = {
  enabled: true,
  discountType: 'percent',
  value: 10,
  maxRemainingGapMinutes: 10,
  minImprovementMinutes: 20,
  eligibleServiceIds: [],
  eligibleTechnicianIds: [],
};

function appointment(id: string, startMs: number, endMs: number, clientKeys?: string[]): SmartFitBlock {
  return { id, kind: 'appointment', startMs, endMs, clientKeys };
}

function day(overrides: Partial<SmartFitDayContext> = {}): SmartFitDayContext {
  return {
    technicianId: 'tech_daniela',
    locationId: null,
    workStartMs: t(9),
    workEndMs: t(18),
    blocks: [],
    slotIntervalMinutes: 15,
    gridAnchorMs: DAY0,
    nowMs: t(6), // lead boundary t(8): the whole working day is bookable
    ...overrides,
  };
}

function candidate(overrides: Partial<SmartFitCandidate> = {}): SmartFitCandidate {
  return {
    startMs: t(10),
    visibleDurationMinutes: 75,
    bufferMinutes: 10, // blocked window = 85 minutes
    serviceId: 'srv_biab-short',
    technicianId: 'tech_daniela',
    locationId: null,
    clientKeys: ['sc_booker', '+14165551234'],
    ...overrides,
  };
}

function evaluate(
  config: ResolvedSmartFitConfig,
  cand: Partial<SmartFitCandidate>,
  dayCtx: Partial<SmartFitDayContext>,
) {
  return evaluateSmartFitSlot({ config, candidate: candidate(cand), day: day(dayCtx) });
}

describe('evaluateSmartFitSlot — gates', () => {
  // Matrix 1: Smart Fit off regression.
  it('disabled config never qualifies, even for a perfect fit', () => {
    const result = evaluate(DISABLED_SMART_FIT_CONFIG, {}, {
      blocks: [appointment('appt_prev', t(9), t(10))],
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('SMART_FIT_DISABLED');
  });

  // Matrix 22: ineligible service.
  it('rejects a service outside the eligibility list', () => {
    const result = evaluate(
      { ...ENABLED, eligibleServiceIds: ['srv_other'] },
      {},
      { blocks: [appointment('appt_prev', t(9), t(10))] },
    );

    expect(result.reason).toBe('SERVICE_NOT_ELIGIBLE');
  });

  // Matrix 23: ineligible technician.
  it('rejects a technician outside the eligibility list', () => {
    const result = evaluate(
      { ...ENABLED, eligibleTechnicianIds: ['tech_other'] },
      {},
      { blocks: [appointment('appt_prev', t(9), t(10))] },
    );

    expect(result.reason).toBe('TECHNICIAN_NOT_ELIGIBLE');
  });

  // Matrix 20: different technician rejected ('any'/null passes).
  it('rejects an explicit technician mismatch but accepts null (any) against the day context', () => {
    expect(evaluate(ENABLED, { technicianId: 'tech_other' }, {}).reason).toBe('TECHNICIAN_MISMATCH');
    expect(
      evaluate(ENABLED, { technicianId: null }, { blocks: [appointment('a', t(9), t(10))] }).reason,
    ).toBe('ELIGIBLE');
  });

  // Matrix 21: different location rejected (null on either side passes).
  it('rejects an explicit location mismatch but accepts unscoped locations', () => {
    expect(
      evaluate(ENABLED, { locationId: 'loc_2' }, { locationId: 'loc_1' }).reason,
    ).toBe('LOCATION_MISMATCH');
    expect(
      evaluate(ENABLED, { locationId: 'loc_1' }, {
        locationId: 'loc_1',
        blocks: [appointment('a', t(9), t(10))],
      }).reason,
    ).toBe('ELIGIBLE');
  });

  // Matrix 24: minimum notice violation (default 120 minutes).
  it('rejects a candidate inside the 120-minute lead window', () => {
    const result = evaluate(ENABLED, {}, {
      nowMs: t(9),
      blocks: [appointment('appt_prev', t(9), t(10))],
    });

    expect(result.reason).toBe('MINIMUM_NOTICE');
  });

  // Matrix 10: working-window boundary violations.
  it('rejects candidates outside the working window (start before, blocked end after)', () => {
    expect(evaluate(ENABLED, { startMs: t(8, 45) }, {}).reason).toBe('OUTSIDE_WORKING_HOURS');
    // 17:00 + 85 blocked minutes = 18:25 > 18:00 close.
    expect(evaluate(ENABLED, { startMs: t(17) }, {}).reason).toBe('OUTSIDE_WORKING_HOURS');
  });

  // Matrix 25: overlap rejected.
  it('rejects any overlap with an existing block', () => {
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [appointment('appt_mid', t(11), t(12))], // candidate blocked end 11:25
    });

    expect(result.reason).toBe('OVERLAPS_BLOCK');
  });
});

describe('evaluateSmartFitSlot — qualifying fits', () => {
  // Matrix 5 + 11: exact tight fit AFTER an appointment (gap 0 on the before side).
  it('qualifies flush after a real appointment with an exact zero gap', () => {
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [appointment('appt_prev', t(9), t(10), ['sc_other'])],
    });

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ELIGIBLE');
    expect(result.qualifyingSides).toEqual(['before']);
    expect(result.remainingGapMinutes).toBe(0);
    expect(result.sides.before).toMatchObject({
      edge: 'block',
      neighbor: { id: 'appt_prev', kind: 'appointment' },
      gapMinutes: 0,
      tightest: true,
      qualifies: true,
    });
    // Span 10:00→18:00 = 480 − 85 blocked = 395 slack, all consolidated.
    expect(result.improvementMinutes).toBe(395);
    expect(result.consolidatedMinutes).toBe(395);
  });

  // Matrix 4: fit BEFORE an appointment (gap 0 on the after side).
  it('qualifies flush before a real appointment', () => {
    // Candidate 10:00–11:25 blocked; appointment blocked window starts 11:25.
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [appointment('appt_next', t(11, 25), t(13), ['sc_other'])],
    });

    expect(result.eligible).toBe(true);
    expect(result.qualifyingSides).toEqual(['after']);
    expect(result.remainingGapMinutes).toBe(0);
    // Span 9:00→11:25 = 145 − 85 = 60 slack.
    expect(result.improvementMinutes).toBe(60);
    expect(result.consolidatedMinutes).toBe(60);
    expect(result.sides.before.edge).toBe('boundary');
  });

  // Matrix 6: fit BETWEEN two real appointments (tight on one side).
  it('qualifies between two appointments, reporting both edges as blocks', () => {
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [
        appointment('appt_prev', t(9), t(10), ['sc_other']),
        appointment('appt_next', t(13), t(14), ['sc_third']),
      ],
    });

    expect(result.eligible).toBe(true);
    expect(result.qualifyingSides).toEqual(['before']);
    expect(result.sides.after).toMatchObject({ edge: 'block', qualifies: false });
    // Span 10:00→13:00 = 180 − 85 = 95 slack; gap 0 → all 95 consolidated.
    expect(result.improvementMinutes).toBe(95);
  });

  // Matrix 7: fit beside a break.
  it('qualifies flush against a break', () => {
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [{ id: 'blk_lunch', kind: 'break', startMs: t(11, 25), endMs: t(12) }],
    });

    expect(result.eligible).toBe(true);
    expect(result.sides.after.neighbor).toEqual({ id: 'blk_lunch', kind: 'break' });
  });

  // Matrix 8: fit beside time off.
  it('qualifies flush against a time-off interval', () => {
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [{ id: 'to_1', kind: 'time_off', startMs: t(11, 25), endMs: t(14) }],
    });

    expect(result.eligible).toBe(true);
    expect(result.sides.after.neighbor).toEqual({ id: 'to_1', kind: 'time_off' });
  });

  // Matrix 19: buffers are part of the candidate's blocked window.
  it('measures the gap from the buffered end and treats touching windows as gap 0, not overlap', () => {
    // Visible end 11:15, buffer pushes blocked end to 11:25 == neighbor start.
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [appointment('appt_next', t(11, 25), t(13), ['sc_other'])],
    });

    expect(result.eligible).toBe(true);
    expect(result.remainingGapMinutes).toBe(0);

    // A larger buffer makes the same visible window collide.
    const collides = evaluate(ENABLED, { startMs: t(10), bufferMinutes: 20 }, {
      blocks: [appointment('appt_next', t(11, 25), t(13), ['sc_other'])],
    });

    expect(collides.reason).toBe('OVERLAPS_BLOCK');
  });
});

describe('evaluateSmartFitSlot — shrink-only blocks and boundaries', () => {
  // Matrix 9: Google busy shrinks the span but never qualifies adjacency.
  it('a Google busy neighbor never creates eligibility, but does shrink the free span', () => {
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [{ id: 'gcal_1', kind: 'google_busy', startMs: t(11, 25), endMs: t(13) }],
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('NO_QUALIFYING_NEIGHBOR');
    // Span shrank to 9:00→11:25 (145 − 85 = 60), proving the google block bounded it.
    expect(result.improvementMinutes).toBe(60);
    expect(result.sides.after).toMatchObject({
      edge: 'block',
      neighbor: { id: 'gcal_1', kind: 'google_busy' },
      qualifies: false,
    });
  });

  // Matrix 10 (positive half): a working-window boundary measures gaps but never qualifies.
  it('a boundary-only tight fit does not qualify (empty day)', () => {
    const result = evaluate(ENABLED, { startMs: t(9) }, {});

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('NO_QUALIFYING_NEIGHBOR');
    expect(result.sides.before).toMatchObject({ edge: 'boundary', gapMinutes: 0, qualifies: false });
  });
});

describe('evaluateSmartFitSlot — grid quantization clamp', () => {
  it('exports the approved formula: max(configuredMaxGap, slotInterval − 5)', () => {
    expect(effectiveMaxGapMinutes(10, 15)).toBe(10);
    expect(effectiveMaxGapMinutes(10, 30)).toBe(25);
    expect(effectiveMaxGapMinutes(10, 5)).toBe(10);
  });

  // Matrix 12: a 30-minute grid salon is not silently excluded.
  it('allows the tightest reachable near-fit on a coarse grid', () => {
    // Block ends off-grid at 11:05; on a 30-minute grid the tightest slot is
    // 11:30 → gap 25 ≤ effectiveMaxGap = max(10, 30−5) = 25.
    const result = evaluate(ENABLED, { startMs: t(11, 30) }, {
      slotIntervalMinutes: 30,
      blocks: [appointment('appt_prev', t(9), t(11, 5), ['sc_other'])],
    });

    expect(result.eligible).toBe(true);
    expect(result.effectiveMaxGapMinutes).toBe(25);
    expect(result.remainingGapMinutes).toBe(25);
  });

  // Matrix 13: a near-fit beyond the clamp still fails.
  it('rejects a gap that exceeds the clamped maximum even at the tightest grid slot', () => {
    // Block ends 11:02; 15-minute grid → tightest slot 11:15, gap 13 > 10.
    const result = evaluate(ENABLED, { startMs: t(11, 15) }, {
      blocks: [appointment('appt_prev', t(9), t(11, 2), ['sc_other'])],
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('GAP_TOO_LARGE');
    expect(result.effectiveMaxGapMinutes).toBe(10);
  });

  // Matrix 14: exact boundary of the configured maximum qualifies.
  it('accepts a gap exactly equal to the effective maximum and rejects one minute over', () => {
    // Block ends 11:05 → tightest 15-grid slot 11:15, gap 10 == max.
    const atBoundary = evaluate(ENABLED, { startMs: t(11, 15) }, {
      blocks: [appointment('appt_prev', t(9), t(11, 5), ['sc_other'])],
    });

    expect(atBoundary.eligible).toBe(true);
    expect(atBoundary.remainingGapMinutes).toBe(10);

    // Block ends 11:04 → gap 11 at the same tightest slot.
    const overBoundary = evaluate(ENABLED, { startMs: t(11, 15) }, {
      blocks: [appointment('appt_prev', t(9), t(11, 4), ['sc_other'])],
    });

    expect(overBoundary.reason).toBe('GAP_TOO_LARGE');
  });

  it('rejects an off-grid candidate as not the tightest feasible slot', () => {
    // Gap 7 ≤ 10, but 10:07 is not a grid slot — 10:00 (the ceil of the edge) is.
    const result = evaluate(ENABLED, { startMs: t(10, 7) }, {
      blocks: [appointment('appt_prev', t(9), t(10), ['sc_other'])],
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('NOT_TIGHTEST_SLOT');
  });
});

describe('evaluateSmartFitSlot — anti-trivial-switch guard (slack rule)', () => {
  // Matrix 15: minimum improvement boundary.
  it('accepts slack exactly at the minimum and rejects one minute under', () => {
    // Span 10:00→11:45 = 105 − 85 blocked = 20 slack == minImprovement.
    const atBoundary = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [
        appointment('appt_prev', t(9), t(10), ['sc_other']),
        appointment('appt_next', t(11, 45), t(13), ['sc_third']),
      ],
    });

    expect(atBoundary.eligible).toBe(true);
    expect(atBoundary.improvementMinutes).toBe(20);
    // Tight side gap 0 → the remaining 20 stay contiguous on the far side.
    expect(atBoundary.consolidatedMinutes).toBe(20);

    // Next block one minute earlier → slack 19 < 20.
    const underBoundary = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [
        appointment('appt_prev', t(9), t(10), ['sc_other']),
        appointment('appt_next', t(11, 44), t(13), ['sc_third']),
      ],
    });

    expect(underBoundary.eligible).toBe(false);
    expect(underBoundary.reason).toBe('INSUFFICIENT_IMPROVEMENT');
    expect(underBoundary.improvementMinutes).toBe(19);
  });

  // Matrix 16: trivial switch rejected — exact fill gives the client no placement freedom.
  it('rejects an exact-fill candidate (slack 0) as documented policy', () => {
    const result = evaluate(ENABLED, { startMs: t(10) }, {
      blocks: [
        appointment('appt_prev', t(9), t(10), ['sc_other']),
        appointment('appt_next', t(11, 25), t(13), ['sc_third']),
      ],
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_IMPROVEMENT');
    expect(result.improvementMinutes).toBe(0);
  });

  it('clamps slack to the minimum-notice boundary so unbookable room does not count', () => {
    // now 9:00 → lead boundary 11:00. Block starts 12:35; candidate 11:00
    // fits tight-after (gap 10, tightest floor(12:35 − 85) = 11:00). Raw span
    // 9:00→12:35 has 130 slack, but only 11:00→12:35 is bookable → slack 10.
    const result = evaluate(ENABLED, { startMs: t(11) }, {
      nowMs: t(9),
      blocks: [appointment('appt_next', t(12, 35), t(14), ['sc_other'])],
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_IMPROVEMENT');
    expect(result.improvementMinutes).toBe(10);
  });
});

describe('evaluateSmartFitSlot — service and add-on duration', () => {
  // Matrix 17: service duration is part of the blocked window.
  it('a longer service duration turns the same start into an overlap', () => {
    const fits = evaluate(ENABLED, { startMs: t(10), visibleDurationMinutes: 75 }, {
      blocks: [appointment('appt_next', t(11, 25), t(13), ['sc_other'])],
    });
    const tooLong = evaluate(ENABLED, { startMs: t(10), visibleDurationMinutes: 90 }, {
      blocks: [appointment('appt_next', t(11, 25), t(13), ['sc_other'])],
    });

    expect(fits.eligible).toBe(true);
    expect(tooLong.reason).toBe('OVERLAPS_BLOCK');
  });

  // Matrix 18: add-on minutes ride visibleDurationMinutes identically.
  it('add-on minutes extend the blocked window and change the gap', () => {
    // 60 visible + 15 add-on + 10 buffer = 85 blocked → still flush at 11:25.
    const withAddOn = evaluate(
      ENABLED,
      { startMs: t(10), visibleDurationMinutes: 60 + 15 },
      { blocks: [appointment('appt_next', t(11, 25), t(13), ['sc_other'])] },
    );
    // Without the add-on the blocked end is 11:10 → gap 15 > 10 at a
    // non-tightest position (10:15 would be tighter) → not eligible.
    const withoutAddOn = evaluate(
      ENABLED,
      { startMs: t(10), visibleDurationMinutes: 60 },
      { blocks: [appointment('appt_next', t(11, 25), t(13), ['sc_other'])] },
    );

    expect(withAddOn.eligible).toBe(true);
    expect(withoutAddOn.eligible).toBe(false);
  });
});

describe('evaluateSmartFitSlot — self-adjacency exclusion', () => {
  // Matrix 26: a client's own appointment cannot mint their discount.
  it('rejects when the only qualifying neighbor belongs to the booking client', () => {
    const result = evaluate(
      ENABLED,
      { startMs: t(10), clientKeys: ['sc_booker', '+14165551234'] },
      { blocks: [appointment('appt_own', t(9), t(10), ['+14165551234'])] },
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('SELF_ADJACENCY');
    expect(result.sides.before.selfOnly).toBe(true);
  });

  // Matrix 27: a different real neighbor at the same edge still qualifies.
  it('qualifies when a non-self qualifying block shares the edge with the client’s own appointment', () => {
    const result = evaluate(
      ENABLED,
      { startMs: t(10), clientKeys: ['sc_booker'] },
      {
        blocks: [
          appointment('appt_own', t(9, 30), t(10), ['sc_booker']),
          { id: 'blk_setup', kind: 'break', startMs: t(9), endMs: t(10) },
        ],
      },
    );

    expect(result.eligible).toBe(true);
    expect(result.sides.before.selfOnly).toBe(false);
    // The reported neighbor is the non-self block.
    expect(result.sides.before.neighbor).toEqual({ id: 'blk_setup', kind: 'break' });
  });

  it('excludeAppointmentId removes the client’s current appointment entirely (reschedule)', () => {
    // The candidate overlaps the client's own current appointment, which a
    // reschedule cancels in the same transaction — with the exclusion it
    // evaluates against the remaining real neighbor and qualifies.
    const result = evaluate(
      ENABLED,
      { startMs: t(10), excludeAppointmentId: 'appt_current' },
      {
        blocks: [
          appointment('appt_current', t(10), t(11)),
          appointment('appt_prev', t(9), t(10), ['sc_other']),
        ],
      },
    );

    expect(result.eligible).toBe(true);
    expect(result.qualifyingSides).toEqual(['before']);
  });
});

describe('evaluateSmartFitSlot — result contract', () => {
  // Matrix 28: stable reason codes.
  it('exposes the frozen reason-code list later phases key off', () => {
    expect([...SMART_FIT_REASONS]).toEqual([
      'ELIGIBLE',
      'SMART_FIT_DISABLED',
      'SERVICE_NOT_ELIGIBLE',
      'TECHNICIAN_NOT_ELIGIBLE',
      'TECHNICIAN_MISMATCH',
      'LOCATION_MISMATCH',
      'MINIMUM_NOTICE',
      'OUTSIDE_WORKING_HOURS',
      'OVERLAPS_BLOCK',
      'INSUFFICIENT_IMPROVEMENT',
      'SELF_ADJACENCY',
      'NOT_TIGHTEST_SLOT',
      'GAP_TOO_LARGE',
      'NO_QUALIFYING_NEIGHBOR',
    ]);
  });

  // Matrix 29: deterministic output.
  it('returns identical results for identical inputs', () => {
    const args = {
      config: ENABLED,
      candidate: candidate({ startMs: t(10) }),
      day: day({ blocks: [appointment('appt_prev', t(9), t(10), ['sc_other'])] }),
    };

    expect(evaluateSmartFitSlot(args)).toEqual(evaluateSmartFitSlot(args));
  });

  // Matrix 30: no private neighbor data leaks into the result.
  it('never echoes client identity keys of neighboring appointments', () => {
    const result = evaluate(
      ENABLED,
      { startMs: t(10), clientKeys: ['sc_booker'] },
      { blocks: [appointment('appt_prev', t(9), t(10), ['sc_neighbor', '+16475550000'])] },
    );

    const serialized = JSON.stringify(result);

    expect(result.eligible).toBe(true);
    expect(serialized).not.toContain('sc_neighbor');
    expect(serialized).not.toContain('+16475550000');
    expect(serialized).not.toContain('clientKeys');
    expect(result.sides.before.neighbor).toEqual({ id: 'appt_prev', kind: 'appointment' });
  });
});

describe('resolveSmartFitConfig → evaluateSmartFitSlot integration', () => {
  it('a raw salon.settings blob drives the evaluator end to end', () => {
    const settings = {
      smartFit: {
        enabled: true,
        discountType: 'percent',
        value: 150, // clamps to 100
        maxRemainingGapMinutes: 10,
        minImprovementMinutes: 20,
        eligibleServiceIds: [],
        eligibleTechnicianIds: [],
        unknownFutureField: true,
      },
    } as unknown as SalonSettings;
    const config = resolveSmartFitConfig(settings);
    const result = evaluate(config, { startMs: t(10) }, {
      blocks: [appointment('appt_prev', t(9), t(10), ['sc_other'])],
    });

    expect(config.value).toBe(100);
    expect(result.eligible).toBe(true);
  });

  it('a missing smartFit namespace evaluates as disabled', () => {
    const config = resolveSmartFitConfig({} as SalonSettings);
    const result = evaluate(config, { startMs: t(10) }, {
      blocks: [appointment('appt_prev', t(9), t(10), ['sc_other'])],
    });

    expect(result.reason).toBe('SMART_FIT_DISABLED');
  });
});

describe('calculateSmartFitDiscountCents', () => {
  it('floors percent discounts and clamps fixed discounts to the subtotal', () => {
    expect(calculateSmartFitDiscountCents(ENABLED, 6549)).toBe(654); // 10% floored
    expect(calculateSmartFitDiscountCents({ enabled: true, discountType: 'fixed', value: 500 }, 300)).toBe(300);
    expect(calculateSmartFitDiscountCents({ enabled: true, discountType: 'fixed', value: 500 }, 6500)).toBe(500);
  });

  it('returns zero when disabled, valueless, or the subtotal is empty', () => {
    expect(calculateSmartFitDiscountCents(DISABLED_SMART_FIT_CONFIG, 6500)).toBe(0);
    expect(calculateSmartFitDiscountCents({ enabled: true, discountType: 'percent', value: 0 }, 6500)).toBe(0);
    expect(calculateSmartFitDiscountCents(ENABLED, 0)).toBe(0);
  });
});

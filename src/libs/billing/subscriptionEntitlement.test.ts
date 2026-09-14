/**
 * §6.5a entitlement projection proofs, plus the load-bearing sync check
 * against creditGrants.ts's private GRANT_ELIGIBLE_STATUSES (see the
 * module doc comment for why this can't just be an import).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { describeSubscriptionEntitlement, GRANT_ELIGIBLE_STATUSES } from './subscriptionEntitlement';

describe('GRANT_ELIGIBLE_STATUSES', () => {
  it('stays byte-for-byte in sync with the private set in creditGrants.ts', () => {
    const source = fs.readFileSync(path.join(__dirname, 'creditGrants.ts'), 'utf8');
    const match = source.match(/GRANT_ELIGIBLE_STATUSES\s*=\s*new Set\(\[([^\]]*)\]\)/);

    expect(match).not.toBeNull();

    const liveStatuses = new Set(
      match![1]!
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0)
        .map(entry => entry.replace(/^['"]|['"]$/g, '')),
    );

    expect(liveStatuses.size).toBeGreaterThan(0);
    expect(new Set(GRANT_ELIGIBLE_STATUSES)).toEqual(liveStatuses);
  });
});

describe('describeSubscriptionEntitlement', () => {
  const now = new Date('2026-09-14T00:00:00.000Z');

  it('returns null when there is no subscription', () => {
    expect(describeSubscriptionEntitlement(null, now)).toBeNull();
  });

  it('active: grants-eligible, plain label', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'active', paidThrough: new Date('2026-10-01T00:00:00.000Z') },
      now,
    );

    expect(result).toEqual({
      status: 'active',
      paidThrough: '2026-10-01T00:00:00.000Z',
      grantsEligible: true,
      label: 'Active',
    });
  });

  it('past_due: grants-eligible (prepaid), names the paid-through date', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'past_due', paidThrough: new Date('2026-09-30T00:00:00.000Z') },
      now,
    );

    expect(result?.grantsEligible).toBe(true);
    expect(result?.label).toBe('Payment past due — prepaid credits continue until Sep 30, 2026');
  });

  it('unpaid: not grants-eligible', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'unpaid', paidThrough: new Date('2026-09-01T00:00:00.000Z') },
      now,
    );

    expect(result).toEqual({
      status: 'unpaid',
      paidThrough: '2026-09-01T00:00:00.000Z',
      grantsEligible: false,
      label: 'Payment failed — no new monthly credits',
    });
  });

  it('incomplete: not grants-eligible', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'incomplete', paidThrough: now },
      now,
    );

    expect(result?.grantsEligible).toBe(false);
    expect(result?.label).toBe('Setup not finished — no monthly credits yet');
  });

  it('incomplete_expired: not grants-eligible', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'incomplete_expired', paidThrough: now },
      now,
    );

    expect(result?.grantsEligible).toBe(false);
    expect(result?.label).toBe('Setup expired — no subscription');
  });

  it('paused: not grants-eligible', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'paused', paidThrough: now },
      now,
    );

    expect(result?.grantsEligible).toBe(false);
    expect(result?.label).toBe('Paused — no new monthly credits');
  });

  it('canceled with paidThrough in the future: grants-eligible, names the date', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'canceled', paidThrough: new Date('2026-12-25T00:00:00.000Z') },
      now,
    );

    expect(result?.grantsEligible).toBe(true);
    expect(result?.label).toBe('Cancelled — credits continue until Dec 25, 2026');
  });

  it('canceled past paidThrough: still status-eligible (coarse §6.4 gate), plain "Cancelled" label', () => {
    // grantsEligible mirrors GRANT_ELIGIBLE_STATUSES verbatim — a coarse
    // "does the engine even look at this status" gate. 'canceled' is always
    // in that set; whether paidThrough covers any FUTURE window is a
    // separate, per-window decision the engine makes elsewhere. The label
    // is what carries the "credits already ended" nuance to the owner.
    const result = describeSubscriptionEntitlement(
      { status: 'canceled', paidThrough: new Date('2026-01-01T00:00:00.000Z') },
      now,
    );

    expect(result?.grantsEligible).toBe(true);
    expect(result?.label).toBe('Cancelled');
  });

  it('canceled exactly at paidThrough (boundary): treated as past, plain "Cancelled"', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'canceled', paidThrough: now },
      now,
    );

    expect(result?.label).toBe('Cancelled');
  });

  it('trialing: anomaly, grants nothing', () => {
    const result = describeSubscriptionEntitlement(
      { status: 'trialing', paidThrough: now },
      now,
    );

    expect(result?.grantsEligible).toBe(false);
    expect(result?.label).toBe('Needs review');
  });
});

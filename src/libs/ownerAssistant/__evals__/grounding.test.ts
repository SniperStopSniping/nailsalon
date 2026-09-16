/**
 * The grounding checker's own suite (A1-4, deliverable A).
 *
 * Two duties, and the first one matters more: the checker must NEVER pass a
 * number the tool results do not contain, because a real-model run is scored
 * with it and "0 invented facts" would otherwise be unprovable. The second is
 * that it must not cry wolf on the things an honest answer legitimately says —
 * a number the OWNER supplied, an ordinal, the year inside a date, or ordinary
 * capitalised English.
 *
 * Pure module, no database, no provider, no clock.
 */
import { describe, expect, it } from 'vitest';

import { checkGrounding } from './grounding';

const SERVICES_RESULT = {
  currency: 'CAD',
  services: [
    { id: 'svc_1', name: 'Gel Manicure', priceCents: 4500, priceDisplayText: null, durationMinutes: 60, category: 'manicure', isActive: true, bookable: true, hasVariants: false, isIntroPrice: false },
    { id: 'svc_2', name: 'Gel-X Extensions', priceCents: 7500, priceDisplayText: null, durationMinutes: 120, category: 'extensions', isActive: true, bookable: true, hasVariants: false, isIntroPrice: false },
    { id: 'svc_3', name: 'Builder Gel Refill', priceCents: 6500, priceDisplayText: null, durationMinutes: 90, category: 'builder_gel', isActive: false, bookable: false, hasVariants: false, isIntroPrice: false },
  ],
  addOns: [
    { id: 'add_1', name: 'Gel Removal', priceCents: 1500, durationMinutes: 20, category: 'removal', pricingType: 'fixed', isActive: true },
  ],
};

const OVERVIEW_RESULT = {
  salonName: 'Eval Studio',
  salonSlug: 'eval-studio',
  publicationStatus: 'published',
  timezone: 'America/Toronto',
  today: '2026-09-17',
  currency: 'CAD',
  technicianCount: 1,
  technicianNames: ['Dani'],
  hours: {
    source: 'salon',
    openDays: ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    byDay: { tuesday: '10:00–18:00', friday: '10:00–18:00' },
  },
  bookingRules: { minimumNoticeMinutes: 120, slotIntervalMinutes: 15, bufferMinutes: 10 },
  integrations: { googleCalendar: 'not_connected', paymentsConnected: false },
};

const DIAGNOSIS_RESULT = {
  resolvedDateKey: '2026-09-18',
  resolution: 'next_weekday',
  ambiguity: null,
  checked: { timezone: 'America/Toronto', serviceName: null, durationMinutes: 30, bufferMinutes: 10, technician: 'any' },
  bookableSlotCount: 12,
  firstBookable: '14:30',
  publicRouteState: 'ok',
  causes: [{ code: 'min_notice', count: 4, link: 'booking_rules' }],
};

const check = (answer: string, toolResults: unknown[] = [], ownerMessages: string[] = []) =>
  checkGrounding({ answer, toolResults, ownerMessages });

describe('money', () => {
  it('accepts dollars stated against a cents field', () => {
    const verdict = check('Gel Manicure is $45.00.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('accepts a bare dollar figure and a currency-suffixed one', () => {
    expect(check('Gel-X Extensions is $75.', [SERVICES_RESULT]).ok).toBe(true);
    expect(check('Gel-X Extensions is 75 CAD.', [SERVICES_RESULT]).ok).toBe(true);
  });

  it('reports a price no tool result contains', () => {
    const verdict = check('Gel Manicure is $55.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toEqual([{ kind: 'money', value: '$55' }]);
  });

  it('does not let the dollar sign hide the digits from every other check', () => {
    // A money amount is claimed as money, never silently dropped.
    const verdict = check('That costs $1234.', [SERVICES_RESULT]);

    expect(verdict.unsupported).toContainEqual({ kind: 'money', value: '$1234' });
  });
});

describe('counts', () => {
  it('accepts a list length the JSON never spells out', () => {
    const verdict = check('You have 3 services.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('accepts the size of a boolean-filtered subset', () => {
    // Two of the three services carry bookable: true.
    const verdict = check('2 of them are bookable online.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('reports a count that is absent (the conservative direction)', () => {
    const verdict = check('You have 7 services.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toEqual([{ kind: 'count', value: '7' }]);
  });

  it('reports an invented count even when other facts are fine', () => {
    const verdict = check('You have 3 services and 9 team members.', [SERVICES_RESULT]);

    expect(verdict.unsupported).toEqual([{ kind: 'count', value: '9' }]);
  });

  it('never passes a number just because the answer is long', () => {
    const verdict = check('Your minimum notice is 240 minutes and the slot interval is 15.', [OVERVIEW_RESULT]);

    expect(verdict.unsupported).toEqual([{ kind: 'duration', value: '240 minutes' }]);
  });
});

describe('durations', () => {
  it('accepts minutes in several spellings', () => {
    expect(check('It takes 60 minutes.', [SERVICES_RESULT]).ok).toBe(true);
    expect(check('It takes 60 min.', [SERVICES_RESULT]).ok).toBe(true);
    expect(check('It is a 60m appointment.', [SERVICES_RESULT]).ok).toBe(true);
  });

  it('converts hours to minutes before checking', () => {
    const verdict = check('Gel-X Extensions takes 2 hours.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('reports a duration no service has', () => {
    const verdict = check('It takes 45 minutes.', [SERVICES_RESULT]);

    expect(verdict.unsupported).toEqual([{ kind: 'duration', value: '45 minutes' }]);
  });
});

describe('clock times', () => {
  it('accepts a time from an hours range', () => {
    expect(check('You open at 10:00.', [OVERVIEW_RESULT]).ok).toBe(true);
    expect(check('You close at 18:00.', [OVERVIEW_RESULT]).ok).toBe(true);
  });

  it('accepts a 12-hour spelling of a 24-hour tool value', () => {
    const verdict = check('The first opening is 2:30 pm.', [DIAGNOSIS_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('reports a time nothing returned', () => {
    const verdict = check('The first opening is 09:15.', [DIAGNOSIS_RESULT]);

    expect(verdict.unsupported).toContainEqual({ kind: 'time', value: '09:15' });
  });
});

describe('dates and weekdays', () => {
  it('accepts a weekday that a date key implies', () => {
    // 2026-09-18 is a Friday.
    const verdict = check('Friday 18 September looks open.', [DIAGNOSIS_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('accepts a weekday that an openDays list contains', () => {
    const verdict = check('You are open Tuesday.', [OVERVIEW_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('reports a weekday the salon never mentioned', () => {
    const verdict = check('You are open Monday.', [OVERVIEW_RESULT]);

    expect(verdict.unsupported).toEqual([{ kind: 'date', value: 'Monday' }]);
  });

  it('reports a date phrase whose day is wrong even when the weekday is right', () => {
    const verdict = check('Friday 25 September is the day.', [DIAGNOSIS_RESULT]);

    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported[0]?.kind).toBe('date');
  });

  it('does not re-report the year inside a date phrase as a count', () => {
    const verdict = check('Friday 18 September 2026 has openings.', [DIAGNOSIS_RESULT]);

    expect(verdict.unsupported).toEqual([]);
  });

  it('accepts an ISO date key verbatim', () => {
    expect(check('I checked 2026-09-18.', [DIAGNOSIS_RESULT]).ok).toBe(true);
    expect(check('I checked 2026-09-25.', [DIAGNOSIS_RESULT]).ok).toBe(false);
  });
});

describe('entities', () => {
  it('accepts a service name that a tool returned', () => {
    const verdict = check('Gel-X Extensions is your longest service.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('accepts a quoted name that a tool returned', () => {
    const verdict = check('Your "Gel Removal" add-on is active.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('reports an invented service name', () => {
    const verdict = check('Your Paraffin Dip is active.', [SERVICES_RESULT]);

    expect(verdict.unsupported).toContainEqual({ kind: 'entity', value: 'Paraffin Dip' });
  });

  it('accepts a name that only a tool-result KEY spells out', () => {
    // `integrations.googleCalendar` is the only place "Google Calendar" occurs.
    const verdict = check('Your Google Calendar is not connected.', [OVERVIEW_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('does not treat sentence-initial English as an entity', () => {
    const verdict = check('Yes. Your page is live. Same availability rules as your booking page.', [OVERVIEW_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('does not treat a lone pronoun run as an entity', () => {
    const verdict = check('I cannot change that for you.', []);

    expect(verdict.ok).toBe(true);
  });
});

describe('owner-supplied facts are never invented', () => {
  it('accepts a number the owner typed', () => {
    const verdict = check(
      'I cannot change your minimum notice to 4 hours for you.',
      [],
      ['Change my minimum notice to 4 hours'],
    );

    expect(verdict.ok).toBe(true);
  });

  it('accepts a name the owner typed', () => {
    const verdict = check(
      'I could not find Paraffin Dip on your menu.',
      [SERVICES_RESULT],
      ['how much is Paraffin Dip?'],
    );

    expect(verdict.ok).toBe(true);
  });

  it('still reports a number neither the owner nor a tool supplied', () => {
    const verdict = check(
      'Your minimum notice is 6 hours.',
      [],
      ['Change my minimum notice to 4 hours'],
    );

    expect(verdict.unsupported).toEqual([{ kind: 'duration', value: '6 hours' }]);
  });
});

describe('ordinals and other non-facts', () => {
  it('ignores word ordinals', () => {
    const verdict = check('The first one is Gel Manicure.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('ignores numeric ordinals', () => {
    const verdict = check('Pick the 2nd option.', []);

    expect(verdict.ok).toBe(true);
  });

  it('reports nothing for an answer with no facts at all', () => {
    const verdict = check('Happy to help — just ask.', []);

    expect(verdict).toEqual({ ok: true, unsupported: [] });
  });

  it('treats an empty tool-result set as supporting nothing numeric', () => {
    const verdict = check('You have 12 services.', []);

    expect(verdict.ok).toBe(false);
  });
});

/**
 * Confirmed FALSE NEGATIVES found by an independent review of this instrument.
 *
 * Each one was reproduced first (the checker returned `ok: true` for an answer
 * that states a fact no tool result supports), then fixed. They stay here
 * because a false negative is the dangerous direction: it silently turns the
 * pilot's "invented facts: 0" gate into a statement about nothing.
 */
describe('regression — reviewer-constructed false negatives', () => {
  it('A1: reports a hallucinated name that OPENS a sentence', () => {
    // The only technician name in the tool results is "Dani".
    const verdict = check('Sarah is your only technician.', [OVERVIEW_RESULT]);

    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toContainEqual({ kind: 'entity', value: 'Sarah' });
  });

  it('A1: reports the same name mid-sentence too (the control)', () => {
    const verdict = check('Your only technician is Sarah.', [OVERVIEW_RESULT]);

    expect(verdict.unsupported).toContainEqual({ kind: 'entity', value: 'Sarah' });
  });

  it('A1: still does not report the sentence-initial function words', () => {
    expect(check('Nothing is missing.', [OVERVIEW_RESULT]).ok).toBe(true);
    expect(check('Both are bookable.', [SERVICES_RESULT]).ok).toBe(true);
    expect(check('Everything looks ready.', [OVERVIEW_RESULT]).ok).toBe(true);
    expect(check('Currently your page is published.', [OVERVIEW_RESULT]).ok).toBe(true);
    expect(check('Otherwise you are all set.', [OVERVIEW_RESULT]).ok).toBe(true);
  });

  it('A2: a slot interval does not vouch for a day of the month', () => {
    // The only 15 anywhere in the overview is `slotIntervalMinutes: 15`, and
    // 2026-09-15 is a Tuesday, not a Friday.
    const verdict = check('Friday 15 September is open.', [OVERVIEW_RESULT]);

    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toContainEqual({ kind: 'date', value: 'Friday 15 September' });
  });

  it('A2: a real date in the tool results still supports its own weekday, day and month', () => {
    // 2026-09-18 is a Friday, and the diagnosis result carries it.
    expect(check('Friday 18 September is open.', [DIAGNOSIS_RESULT]).ok).toBe(true);
  });

  it('A2: a weekday that belongs to ANOTHER date in the results is reported', () => {
    // The overview carries 2026-09-17 (a Thursday); the diagnosis carries
    // 2026-09-18 (a Friday). "Thursday 18 September" is neither.
    const verdict = check('Thursday 18 September is open.', [OVERVIEW_RESULT, DIAGNOSIS_RESULT]);

    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toContainEqual({ kind: 'date', value: 'Thursday 18 September' });
  });

  it('A3: a prefix of a real service name is not a match', () => {
    expect(check('Your Gel Man is active.', [SERVICES_RESULT]).ok).toBe(false);
  });

  it('A3: an infix of a real service name is not a match', () => {
    expect(check('Your El Manicur is active.', [SERVICES_RESULT]).ok).toBe(false);
  });

  it('A3: a name may not span two unrelated tool-result fields', () => {
    // The add-on's `category: 'removal'` value is immediately followed in the
    // haystack by the de-camelCased key `pricingType`. "Removal Pricing" is a
    // name nothing returned; only the join separator stops the match.
    const verdict = check('Your Removal Pricing is fixed.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toContainEqual({ kind: 'entity', value: 'Removal Pricing' });
  });

  it('A3: the boundary-aware match still accepts the real names', () => {
    expect(check('Gel Manicure is $45.', [SERVICES_RESULT]).ok).toBe(true);
    expect(check('Gel-X Extensions is $75.', [SERVICES_RESULT]).ok).toBe(true);
    expect(check('Your "Gel Removal" add-on is active.', [SERVICES_RESULT]).ok).toBe(true);
    expect(check('Your Google Calendar is not connected.', [OVERVIEW_RESULT]).ok).toBe(true);
  });

  it('A4 (KNOWN BLIND SPOT): a lower-case invented name is not extracted at all', () => {
    // Documented in the module header and docs/OWNER_ASSISTANT_EVALS.md §2.
    // This test pins the blind spot so it cannot close silently and unnoticed.
    const verdict = check('Your paraffin dip is active.', [SERVICES_RESULT]);

    expect(verdict.ok).toBe(true);
  });

  it('A5 (KNOWN BLIND SPOT): the check is value-set membership, not attribution', () => {
    // 7500 is Gel-X's price, not Gel Manicure's; both values exist, so the
    // mis-attribution passes. Price/duration attribution must be spot-checked
    // by hand in the first real-model report.
    expect(check('Gel Manicure is $75.', [SERVICES_RESULT]).ok).toBe(true);
    // Same class: a durationMinutes vouches for a money claim.
    expect(check('It costs $60.', [SERVICES_RESULT]).ok).toBe(true);
  });
});

describe('deduplication and shape', () => {
  it('reports a repeated invented fact once', () => {
    const verdict = check('You have 9 services. All 9 are bookable.', [SERVICES_RESULT]);

    expect(verdict.unsupported.filter(fact => fact.value === '9')).toHaveLength(1);
  });

  it('returns ok:true with an empty array when everything is supported', () => {
    const verdict = check('Gel Manicure is $45 and takes 60 minutes.', [SERVICES_RESULT]);

    expect(verdict).toEqual({ ok: true, unsupported: [] });
  });
});

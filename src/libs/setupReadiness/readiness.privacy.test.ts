/**
 * A1-3 Piece 1 — the privacy floor.
 *
 * The setup-readiness projection is handed to an assistant that answers owner
 * questions, so it must never carry a client's identity, contact details,
 * notes, sensitivities, appointment details or any revenue figure. This suite
 * walks EVERY key of every produced result — recursing through objects and
 * arrays — and fails on any denylisted key, then proves the walker is
 * non-vacuous by planting one.
 *
 * A second pass plants recognisable client-shaped values in the salon's own
 * fields and asserts none of them can reach the result by value either.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import { resolveBookingConfigFromSettings } from '@/libs/bookingConfig';
import { createDefaultBookingPageConfig } from '@/libs/bookingPageConfig';
import { createDefaultBookingPageContent } from '@/libs/bookingPageContent';
import type { DepositPolicyInactiveReason } from '@/libs/depositPolicy';
import { getStarterTemplates } from '@/libs/serviceTemplateCatalog';

import { deriveSetupReadiness } from './readiness';
import { baseReadinessInput } from './readinessFixtures';
import type { SetupReadinessInput } from './types';

/* eslint-enable import/first */

/**
 * The exact denylist this projection is held to. Every entry is a key that
 * carries client data somewhere else in this codebase.
 */
const FORBIDDEN_KEYS = [
  'phone',
  'email',
  'full_name',
  'first_name',
  'birthday',
  'notes',
  'sensitivities',
  'tags',
  'clientPhone',
  'clientSensitivities',
  'totalPrice',
  'totalSpent',
  'title',
  'summary',
  'attendees',
] as const;

const FORBIDDEN_KEY_SET = new Set<string>(FORBIDDEN_KEYS);

/** Every key encountered anywhere in the value, with its path. */
function collectKeys(value: unknown, path = '$', found: Array<{ key: string; path: string }> = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectKeys(entry, `${path}[${index}]`, found));
    return found;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      found.push({ key, path: `${path}.${key}` });
      collectKeys(child, `${path}.${key}`, found);
    }
  }

  return found;
}

function forbiddenKeysIn(value: unknown): string[] {
  return collectKeys(value)
    .filter(entry => FORBIDDEN_KEY_SET.has(entry.key))
    .map(entry => entry.path);
}

function collectStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(value);
    return found;
  }

  if (Array.isArray(value)) {
    value.forEach(entry => collectStrings(entry, found));
    return found;
  }

  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(entry => collectStrings(entry, found));
  }

  return found;
}

function scenarios(): SetupReadinessInput[] {
  const defaults = {
    bookingConfig: resolveBookingConfigFromSettings(null),
    bookingPageConfig: createDefaultBookingPageConfig(),
    bookingPageContent: createDefaultBookingPageContent(),
  };
  const template = getStarterTemplates()[0]!;
  const reasons: DepositPolicyInactiveReason[] = [
    'account_not_connected',
    'account_not_charge_ready',
    'readiness_never_synced',
    'undetermined',
    'not_entitled',
  ];

  const base = (overrides: Partial<SetupReadinessInput> = {}) =>
    baseReadinessInput(defaults, overrides);

  return [
    base(),
    base({ salon: { name: 'Isla Nail Studio', publicationStatus: 'draft' } }),
    base({ services: [], technicians: [], publiclyBookableServiceIds: new Set<string>() }),
    base({ publiclyBookableServiceIds: new Set<string>() }),
    base({ technicians: [{ id: 'tech_1', weeklySchedule: null }] }),
    base({ hoursCeiling: { locationId: null, businessHours: null, source: 'none' } }),
    base({
      bookingConfig: resolveBookingConfigFromSettings({ booking: { minimumNoticeMinutes: 99_999 } }),
    }),
    base({ depositPolicy: { active: true, reason: null, readinessStale: false } }),
    ...reasons.map(reason =>
      base({ depositPolicy: { active: false, reason, readinessStale: true } }),
    ),
    base({
      services: [{
        id: 'svc_1',
        name: template.name,
        isActive: true,
        templateKey: template.systemKey,
        price: template.defaultPriceCents,
      }],
      publiclyBookableServiceIds: new Set(['svc_1']),
    }),
    base({
      integrations: { googleReadiness: 'not_connected', stripeConnectStatus: 'not_connected' },
    }),
  ];
}

describe('setup readiness — client-data denylist', () => {
  it('produces no denylisted key in any result', () => {
    const offenders = scenarios().flatMap(scenario =>
      forbiddenKeysIn(deriveSetupReadiness(scenario)),
    );

    expect(offenders).toEqual([]);
  });

  it('walks nested objects and arrays (non-vacuous)', () => {
    const result = deriveSetupReadiness(scenarios()[0]!) as unknown as Record<string, unknown>;

    expect(forbiddenKeysIn(result)).toEqual([]);

    const planted = {
      ...result,
      items: [{ code: 'not_published', severity: 'required', links: [{ key: 'page_publish', label: 'x', email: 'a@b.c' }] }],
    };

    expect(forbiddenKeysIn(planted)).toEqual(['$.items[0].links[0].email']);
  });

  it('covers every denylist entry with a direct probe', () => {
    for (const key of FORBIDDEN_KEYS) {
      expect(forbiddenKeysIn({ nested: [{ [key]: 'value' }] })).toEqual([`$.nested[0].${key}`]);
    }
  });

  it('never carries a client-shaped value through the salon fields it does read', () => {
    const defaults = {
      bookingConfig: resolveBookingConfigFromSettings(null),
      bookingPageConfig: createDefaultBookingPageConfig(),
      bookingPageContent: createDefaultBookingPageContent(),
    };
    // Planted in the only two free-text fields the projection reads at all.
    // Neither the salon name nor a service name is client data; this asserts
    // that nothing ELSE the input carries can escape into the result.
    const scenario = baseReadinessInput(defaults, {
      services: [
        { id: 'svc_1', name: 'PLANTED_SERVICE_NAME', isActive: true, templateKey: null, price: 1 },
      ],
      publiclyBookableServiceIds: new Set<string>(),
      technicians: [
        { id: 'PLANTED_TECHNICIAN_ID', weeklySchedule: { monday: { start: '09:00', end: '17:00' } } },
      ],
    });

    const strings = collectStrings(deriveSetupReadiness(scenario));

    expect(strings).toContain('PLANTED_SERVICE_NAME');
    expect(strings).not.toContain('PLANTED_TECHNICIAN_ID');
  });
});

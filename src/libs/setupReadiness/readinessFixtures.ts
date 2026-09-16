/**
 * Shared, minimal fixtures for the setup-readiness derivation matrix.
 *
 * `baseReadinessInput()` is deliberately a FULLY-FINISHED salon: it produces
 * zero items. Every test then turns exactly one thing off and asserts exactly
 * one code appears, which is what makes the matrix non-vacuous — a rule that
 * fired unconditionally would break the baseline, and a rule that never fired
 * would break its own case.
 *
 * Test-support only: nothing in production imports this file.
 */

import type { BookingPageConfig } from '@/libs/bookingPageConfig';
import type { BookingPageContent } from '@/libs/bookingPageContent';
import type { BusinessHours } from '@/libs/bookingPolicy';
import type { WeeklySchedule } from '@/models/Schema';

import type { SetupReadinessInput } from './types';

export const FIXED_NOW = new Date('2026-09-16T12:00:00.000Z');

export const OPEN_WEEKDAY_HOURS: BusinessHours = {
  monday: { open: '09:00', close: '17:00' },
  tuesday: { open: '09:00', close: '17:00' },
};

export const WORKING_WEEKLY_SCHEDULE: WeeklySchedule = {
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
};

type Overrides = Partial<SetupReadinessInput>;

export function baseReadinessInput(
  defaults: {
    bookingPageConfig: BookingPageConfig;
    bookingPageContent: BookingPageContent;
    bookingConfig: SetupReadinessInput['bookingConfig'];
  },
  overrides: Overrides = {},
): SetupReadinessInput {
  const bookingPageConfig = defaults.bookingPageConfig;
  const bookingPageContent = defaults.bookingPageContent;

  return {
    salon: { name: 'Isla Nail Studio', publicationStatus: 'published' },
    bookingConfig: defaults.bookingConfig,
    bookingPageConfig,
    bookingPageContent,
    services: [
      { id: 'svc_1', name: 'Builder gel full set', isActive: true, templateKey: null, price: 9500 },
      { id: 'svc_2', name: 'Gel refill', isActive: true, templateKey: null, price: 7500 },
    ],
    technicians: [{ id: 'tech_1', weeklySchedule: WORKING_WEEKLY_SCHEDULE }],
    publiclyBookableServiceIds: new Set(['svc_1', 'svc_2']),
    hoursCeiling: { locationId: null, businessHours: OPEN_WEEKDAY_HOURS, source: 'salon' },
    depositPolicy: { active: false, reason: 'not_entitled', readinessStale: false },
    scheduleOverridesEntitled: false,
    technicianIdsWithUpcomingHoursOverrides: new Set<string>(),
    integrations: { googleReadiness: 'ready', stripeConnectStatus: 'charge_ready' },
    now: FIXED_NOW,
    ...overrides,
  };
}

/** Deep-clones a resolved config so a test can mutate one side in isolation. */
export function cloneConfig(config: BookingPageConfig): BookingPageConfig {
  return JSON.parse(JSON.stringify(config)) as BookingPageConfig;
}

/** Deep-clones resolved content so a test can mutate one side in isolation. */
export function cloneContent(content: BookingPageContent): BookingPageContent {
  return JSON.parse(JSON.stringify(content)) as BookingPageContent;
}

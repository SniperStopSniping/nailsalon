import 'server-only';

import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { getDateKeyInTimeZone, getTimeKeyInTimeZone } from '@/libs/timeZone';
import type { SalonFeatures } from '@/types/salonPolicy';

import { buildCustomerProposal } from './catalogue.server';
import type { CustomerAvailableSlot, CustomerDatePreference, CustomerProposal, CustomerSelection } from './contracts';

const MAX_AVAILABILITY_DAYS = 90;
const MAX_SLOTS = 8;

type BoundSalon = { id: string; slug: string };
type AvailabilityResponse = { slots?: unknown };

export type CustomerSlotLookup = (args: {
  salon: BoundSalon;
  date: string;
  baseServiceId: string;
  selectedAddOns: string;
}) => Promise<Response>;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function isTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }
  const [hour = Number.NaN, minute = Number.NaN] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isAvailableSlot(value: unknown): value is CustomerAvailableSlot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.availability === 'available'
    && typeof record.time === 'string' && record.time.length > 0 && record.time.length <= 80
    && typeof record.startTime === 'string' && !Number.isNaN(Date.parse(record.startTime));
}

async function publicAvailabilityLookup(args: Parameters<CustomerSlotLookup>[0]): Promise<Response> {
  // Kept behind this narrow adapter so no customer path can accidentally call
  // the public HTTP route or the side-effecting Google-calendar helper.
  const { getAnonymousCustomerBookingAvailability } = await import('@/libs/publicBookingAvailability.server');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  timeout.unref?.();
  try {
    return await getAnonymousCustomerBookingAvailability({ ...args, signal: controller.signal, timeoutMs: 8_000 });
  } finally {
    clearTimeout(timeout);
  }
}

export function validateCustomerDatePreference(args: {
  preference: CustomerDatePreference;
  today: string;
}): boolean {
  return isCalendarDate(args.preference.date)
    && isTime(args.preference.earliest)
    && isTime(args.preference.latest)
    && args.preference.earliest <= args.preference.latest
    && dayDistance(args.today, args.preference.date) >= 0
    && dayDistance(args.today, args.preference.date) <= MAX_AVAILABILITY_DAYS;
}

export async function getCustomerAvailabilityContext(salonId: string, now = new Date()) {
  const config = await getBookingConfigForSalon(salonId);
  return { today: getDateKeyInTimeZone(now, config.timezone), timeZone: config.timezone };
}

/**
 * Rebuilds the quote first, then invokes the same pure public availability
 * engine as manual booking. It intentionally serializes only the selection,
 * never model output or a technician/calendar row.
 */
export async function lookupCustomerSlots(args: {
  salon: BoundSalon;
  features: SalonFeatures | null;
  selection: CustomerSelection;
  preference: CustomerDatePreference;
  now?: Date;
  lookup?: CustomerSlotLookup;
  /** Used only for a recheck; it is never an extra slot exposed to the UI. */
  requiredStartTime?: string;
}): Promise<{
  proposal: CustomerProposal;
  today: string;
  timeZone: string;
  slots: CustomerAvailableSlot[];
  selected: CustomerAvailableSlot | null;
  quoteChanged: boolean;
} | null> {
  const [{ today, timeZone }, proposal] = await Promise.all([
    getCustomerAvailabilityContext(args.salon.id, args.now),
    buildCustomerProposal(args.salon.id, args.features, args.selection),
  ]);
  if (!validateCustomerDatePreference({ preference: args.preference, today })) {
    return null;
  }
  const response = await (args.lookup ?? publicAvailabilityLookup)({
    salon: args.salon,
    date: args.preference.date,
    baseServiceId: proposal.selection.baseServiceId,
    selectedAddOns: JSON.stringify(proposal.selection.selectedAddOns),
  });
  if (!response.ok) {
    return null;
  }
  let body: AvailabilityResponse;
  try {
    body = await response.json() as AvailabilityResponse;
  } catch {
    return null;
  }
  if (!Array.isArray(body.slots)) {
    return null;
  }
  // Cap rather than exposing any internal availability metadata. Slots are
  // still freshly re-checked before a later customer selection is accepted.
  const availableSlots = body.slots.filter(isAvailableSlot)
    // The shared public engine uses unpadded hours; canonicalize before comparison.
    .map(slot => ({ ...slot, time: slot.time.padStart(5, '0') }))
    .filter(slot => isTime(slot.time))
    .filter((slot) => {
      const startTime = new Date(slot.startTime);
      return getDateKeyInTimeZone(startTime, timeZone) === args.preference.date
        && getTimeKeyInTimeZone(startTime, timeZone) === slot.time;
    })
    .filter(slot => slot.time >= args.preference.earliest && slot.time <= args.preference.latest)
    .map(slot => ({ time: slot.time, startTime: new Date(slot.startTime).toISOString() }));
  // Do not use the display cap as a concurrency predicate. A newly available
  // earlier time must not make an already offered, still-valid selection look
  // as if it disappeared.
  const selected = args.requiredStartTime
    ? availableSlots.find(slot => slot.startTime === args.requiredStartTime) ?? null
    : null;
  const slots = availableSlots
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .slice(0, MAX_SLOTS)
    .map(slot => ({ ...slot }));
  const [freshContext, freshProposal] = await Promise.all([
    getCustomerAvailabilityContext(args.salon.id, args.now),
    buildCustomerProposal(args.salon.id, args.features, args.selection),
  ]);
  const quoteChanged = freshProposal.fingerprint !== proposal.fingerprint
    || freshContext.timeZone !== timeZone || freshContext.today !== today;
  return { proposal: freshProposal, today: freshContext.today, timeZone: freshContext.timeZone, slots, selected, quoteChanged };
}

export function hasOfferedCustomerSlot(slots: readonly CustomerAvailableSlot[], startTime: string): CustomerAvailableSlot | null {
  return slots.find(slot => slot.startTime === startTime) ?? null;
}

/** Bounded next-date search through the exact public availability authority; never hours-only guesses. */
export async function lookupNextCustomerSlots(args: Omit<Parameters<typeof lookupCustomerSlots>[0], 'preference'> & { fromDate?: string; earliest?: string; latest?: string }) {
  const context = await getCustomerAvailabilityContext(args.salon.id, args.now);
  const firstDate = args.fromDate ?? context.today;
  const deadline = performance.now() + 12_000;
  for (let offset = 0; offset < 7 && performance.now() < deadline; offset += 1) {
    const date = new Date(Date.parse(`${firstDate}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    const preference = { date, earliest: args.earliest ?? '00:00', latest: args.latest ?? '23:59' };
    const found = await lookupCustomerSlots({ ...args, preference });
    if (!found || found.quoteChanged) {
      return null;
    }
    if (found.slots.length) {
      return { ...found, preference };
    }
  }
  return null;
}

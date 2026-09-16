/**
 * `diagnose_day_availability` against a real schema (PGlite).
 *
 * The tool's whole value is that it answers with the PUBLIC booking page's own
 * rules, so almost nothing is stubbed: the booking policy, the overrides, the
 * time off, the blocked slots, the appointments, the locations, the service
 * validator and the slot loop all run their real code against migrated tables.
 * Google Calendar is the single seam (it is a network call), mocked the same
 * way `route.parity.test.ts` mocks it.
 *
 * Two invariants carry the weight. First, every cause must be something the
 * owner can act on: its `link` is a navigation registry key or an honest null,
 * never a guess. Second, nothing client-shaped may escape — the fixtures
 * deliberately include an appointment with a client name and phone, and the
 * denylist is asserted over every key and every string of the result.
 *
 * Counts: the engine's explain-mode tallies are asserted EXACTLY only where
 * the day makes them unambiguous — one blocked half-hour, one booked
 * half-hour, one busy half-hour on an otherwise open day, each landing on
 * exactly one slot of the 30-minute grid. Everywhere else the assertion is
 * that the code is present with a non-negative integer count, so a later
 * refinement of what the engine counts cannot turn this suite red for the
 * wrong reason.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { zonedTimeToUtc } from '@/libs/timeZone';
import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const { holder, GoogleCalendarAvailabilityError } = vi.hoisted(() => {
  class GoogleCalendarAvailabilityError extends Error {
    reconnectRequired: boolean;

    constructor(reconnectRequired = false) {
      super('Google Calendar availability is unavailable');
      this.name = 'GoogleCalendarAvailabilityError';
      this.reconnectRequired = reconnectRequired;
    }
  }

  return {
    GoogleCalendarAvailabilityError,
    holder: {
      db: null as unknown,
      googleBusy: [] as Array<{ startTime: Date; endTime: Date }>,
      googleError: null as Error | null,
    },
  };
});

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/googleCalendar', () => ({
  GoogleCalendarAvailabilityError,
  getGoogleCalendarBusyWindows: vi.fn(async () => {
    if (holder.googleError) {
      throw holder.googleError;
    }

    return holder.googleBusy;
  }),
  isBusyWindowConflict: (
    startTime: Date,
    endTime: Date,
    busyWindows: Array<{ startTime: Date; endTime: Date }>,
  ) => busyWindows.some(window => startTime < window.endTime && endTime > window.startTime),
}));

const { diagnoseDayAvailability, DiagnoseDayInvalidArgumentsError } = await import('./diagnoseDayAvailability.server');
const { executeOwnerAssistantTool } = await import('./index.server');
const { isRegistryKey } = await import('../registry');
const { OWNER_ASSISTANT_TOOL_NAMES } = await import('../contracts');

type DiagnoseResult = Awaited<ReturnType<typeof diagnoseDayAvailability>>;

const TIME_ZONE = 'America/Toronto';
/** Thursday 2026-03-05, 12:30 EST — the same frozen clock the parity suite uses. */
const NOW = new Date('2026-03-05T17:30:00.000Z');
const D_TODAY = '2026-03-05'; // Thursday
const D_FRI = '2026-03-06';
const D_SAT = '2026-03-07';
/** The Thursday AFTER today — what a bare "thursday" resolves to. */
const D_THU_NEXT = '2026-03-12';

const at = (date: string, time: string) => zonedTimeToUtc({ date, time, timeZone: TIME_ZONE });

const WORKING_WEEK = {
  sunday: null,
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
  wednesday: { start: '09:00', end: '17:00' },
  thursday: { start: '09:00', end: '17:00' },
  friday: { start: '09:00', end: '17:00' },
  saturday: null,
};

const WEEKDAY_HOURS = {
  sunday: null,
  monday: { open: '09:00', close: '17:00' },
  tuesday: { open: '09:00', close: '17:00' },
  wednesday: { open: '09:00', close: '17:00' },
  thursday: { open: '09:00', close: '17:00' },
  friday: { open: '09:00', close: '17:00' },
  saturday: null,
};

function bookingSettings(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      currency: 'CAD',
      timezone: TIME_ZONE,
      minimumNoticeMinutes: 0,
      slotIntervalMinutes: 30,
      bufferMinutes: 0,
      ...overrides,
    },
  } as unknown as typeof schema.salonSchema.$inferInsert['settings'];
}

/** docs/OWNER_ASSISTANT_CHAT.md §3.3 — nothing client-shaped may appear. */
const PII_DENYLIST = [
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
];

function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, into);
    }
    return into;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      into.push(key);
      collectKeys(nested, into);
    }
  }
  return into;
}

function expectNoPii(result: unknown, label: string) {
  for (const key of collectKeys(result)) {
    for (const banned of PII_DENYLIST) {
      expect(key.toLowerCase(), `${label}: key "${key}" matches denylisted "${banned}"`)
        .not.toContain(banned.toLowerCase());
    }
  }
  const serialized = JSON.stringify(result);

  expect(serialized, label).not.toContain('4165550');
  expect(serialized, label).not.toContain('Booked Client');
}

function expectLinksAreRegistryKeysOrNull(result: DiagnoseResult, label: string) {
  for (const cause of result.causes) {
    if (cause.link === null) {
      continue;
    }

    expect(isRegistryKey(cause.link), `${label}: "${cause.link}" for ${cause.code}`).toBe(true);
  }
}

function codes(result: DiagnoseResult): string[] {
  return result.causes.map(cause => cause.code);
}

function causeFor(result: DiagnoseResult, code: string) {
  return result.causes.find(cause => cause.code === code);
}

/** Every result this suite produces, checked for links and PII in one sweep. */
const produced: Array<{ label: string; result: DiagnoseResult }> = [];

async function diagnose(
  salonId: string,
  args: { date: string; serviceName?: string | null; technicianName?: string | null },
  label = `${salonId} ${args.date}`,
): Promise<DiagnoseResult> {
  const result = await diagnoseDayAvailability(
    salonId,
    {
      date: args.date,
      serviceName: args.serviceName ?? null,
      technicianName: args.technicianName ?? null,
    },
    { now: NOW },
  );

  produced.push({ label, result });

  return result;
}

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: 'salon_diag',
      name: 'Diag Studio',
      slug: 'diag-main',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings(),
    },
    {
      id: 'salon_diag_vancouver',
      name: 'Vancouver Studio',
      slug: 'diag-vancouver',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings({ timezone: 'America/Vancouver' }),
    },
    {
      id: 'salon_diag_draft',
      name: 'Draft Studio',
      slug: 'diag-draft',
      publicationStatus: 'draft',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings(),
    },
    {
      id: 'salon_diag_nobooking',
      name: 'No Online Booking Studio',
      slug: 'diag-nobooking',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings(),
      features: { booking: { onlineBooking: false } },
    },
    {
      id: 'salon_diag_location',
      name: 'Location Studio',
      slug: 'diag-location',
      // Open every day on the salon row; the LOCATION row is the one that
      // closes Friday, and the location is the more specific authority.
      businessHours: {
        sunday: { open: '09:00', close: '17:00' },
        monday: { open: '09:00', close: '17:00' },
        tuesday: { open: '09:00', close: '17:00' },
        wednesday: { open: '09:00', close: '17:00' },
        thursday: { open: '09:00', close: '17:00' },
        friday: { open: '09:00', close: '17:00' },
        saturday: { open: '09:00', close: '17:00' },
      },
      settings: bookingSettings(),
    },
    {
      id: 'salon_diag_empty',
      name: 'Empty Studio',
      slug: 'diag-empty',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings(),
    },
    {
      id: 'salon_diag_sched',
      name: 'Schedule Studio',
      slug: 'diag-sched',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings(),
    },
    {
      id: 'salon_diag_notice',
      name: 'Notice Studio',
      slug: 'diag-notice',
      businessHours: WEEKDAY_HOURS,
      // Seven days of minimum notice: nothing on Friday can be booked today.
      settings: bookingSettings({ minimumNoticeMinutes: 7 * 24 * 60 }),
    },
    {
      id: 'salon_diag_blocked',
      name: 'Blocked Studio',
      slug: 'diag-blocked',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings(),
    },
    {
      id: 'salon_diag_appt',
      name: 'Appointment Studio',
      slug: 'diag-appt',
      businessHours: WEEKDAY_HOURS,
      settings: bookingSettings(),
    },
  ]);

  await db.insert(schema.salonLocationSchema).values({
    id: 'loc_diag_main',
    salonId: 'salon_diag_location',
    name: 'Diag Main Studio',
    isPrimary: true,
    businessHours: { ...WEEKDAY_HOURS, friday: null },
  });

  await db.insert(schema.technicianSchema).values([
    { id: 'tech_isla', salonId: 'salon_diag', name: 'Isla', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_mara', salonId: 'salon_diag', name: 'Mara', weeklySchedule: WORKING_WEEK, isActive: true },
    // Inactive rows must never be matchable by name.
    { id: 'tech_retired', salonId: 'salon_diag', name: 'Retired', weeklySchedule: WORKING_WEEK, isActive: false },
    { id: 'tech_vancouver', salonId: 'salon_diag_vancouver', name: 'Vic', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_draft', salonId: 'salon_diag_draft', name: 'Dana', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_nobooking', salonId: 'salon_diag_nobooking', name: 'Nora', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_location', salonId: 'salon_diag_location', name: 'Lou', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_away', salonId: 'salon_diag_sched', name: 'Away', weeklySchedule: WORKING_WEEK, isActive: true },
    {
      id: 'tech_noday',
      salonId: 'salon_diag_sched',
      name: 'NoFriday',
      weeklySchedule: { ...WORKING_WEEK, friday: null },
      isActive: true,
    },
    { id: 'tech_ready', salonId: 'salon_diag_sched', name: 'Ready', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_notice', salonId: 'salon_diag_notice', name: 'Nina', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_blocked', salonId: 'salon_diag_blocked', name: 'Bree', weeklySchedule: WORKING_WEEK, isActive: true },
    { id: 'tech_appt', salonId: 'salon_diag_appt', name: 'Ada', weeklySchedule: WORKING_WEEK, isActive: true },
  ]);

  await db.insert(schema.serviceSchema).values([
    { id: 'svc_gel', salonId: 'salon_diag', name: 'Gel manicure', price: 6500, durationMinutes: 60, category: 'manicure', isActive: true },
    { id: 'svc_solo', salonId: 'salon_diag', name: 'Solo art', price: 3000, durationMinutes: 60, category: 'manicure', isActive: true },
    { id: 'svc_orphan', salonId: 'salon_diag', name: 'Orphan wrap', price: 4000, durationMinutes: 60, category: 'manicure', isActive: true },
    // Two active rows that normalize to the same name — the >1 match branch.
    { id: 'svc_dup_a', salonId: 'salon_diag', name: 'Fill', price: 2000, durationMinutes: 30, category: 'manicure', isActive: true },
    { id: 'svc_dup_b', salonId: 'salon_diag', name: 'fill!', price: 2500, durationMinutes: 30, category: 'manicure', isActive: true },
    { id: 'svc_hidden', salonId: 'salon_diag', name: 'Hidden buff', price: 1000, durationMinutes: 15, category: 'manicure', isActive: false },
  ]);

  await db.insert(schema.technicianServicesSchema).values([
    { technicianId: 'tech_isla', serviceId: 'svc_gel', enabled: true, priority: 0 },
    { technicianId: 'tech_mara', serviceId: 'svc_gel', enabled: true, priority: 0 },
    // Only Isla is assigned to Solo art, so asking for it WITH Mara is the
    // validator's `unsupported_technician`.
    { technicianId: 'tech_isla', serviceId: 'svc_solo', enabled: true, priority: 1 },
  ]);

  await db.insert(schema.technicianTimeOffSchema).values({
    id: 'timeoff_diag_1',
    salonId: 'salon_diag_sched',
    technicianId: 'tech_away',
    startDate: new Date('2026-03-06T00:00:00.000Z'),
    endDate: new Date('2026-03-07T00:00:00.000Z'),
    reason: 'vacation',
  });

  await db.insert(schema.technicianBlockedSlotSchema).values({
    id: 'blocked_diag_1',
    salonId: 'salon_diag_blocked',
    technicianId: 'tech_blocked',
    dayOfWeek: null,
    startTime: '12:00',
    endTime: '12:30',
    specificDate: at(D_FRI, '0:00'),
    label: 'Lunch',
    isRecurring: false,
  });

  await db.insert(schema.appointmentSchema).values({
    id: 'appt_diag_1',
    salonId: 'salon_diag_appt',
    technicianId: 'tech_appt',
    clientPhone: '4165550100',
    clientName: 'Booked Client',
    startTime: at(D_FRI, '12:00'),
    endTime: at(D_FRI, '12:30'),
    status: 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 30,
    bufferMinutes: 0,
    blockedDurationMinutes: 30,
  });
}, 120_000);

beforeEach(() => {
  holder.db = db;
  holder.googleBusy = [];
  holder.googleError = null;
});

afterAll(async () => {
  await client.close();
});

describe('step 0 — the Toronto-only refusal', () => {
  it('refuses a salon the policy engine cannot reason about, and says nothing else', async () => {
    const result = await diagnose('salon_diag_vancouver', { date: 'friday' });

    expect(result.causes).toEqual([{ code: 'timezone_unsupported', link: null }]);
    expect(result.checked.timezone).toBe('America/Vancouver');
    // The day is still named honestly: resolving it never needed the engine.
    expect(result.resolvedDateKey).toBe(D_FRI);
    expect(result.bookableSlotCount).toBe(0);
  });

  it('still refuses an unusable date argument on an unsupported timezone', async () => {
    await expect(diagnoseDayAvailability(
      'salon_diag_vancouver',
      { date: 'someday', serviceName: null, technicianName: null },
      { now: NOW },
    )).rejects.toThrow(DiagnoseDayInvalidArgumentsError);
  });
});

describe('step 1 — resolving the day the owner means', () => {
  it('takes an explicit date as given', async () => {
    const result = await diagnose('salon_diag', { date: D_FRI });

    expect(result.resolvedDateKey).toBe(D_FRI);
    expect(result.resolution).toBe('exact');
    expect(result.ambiguity).toBeNull();
  });

  it('reads a weekday word as the next occurrence', async () => {
    const result = await diagnose('salon_diag', { date: 'friday' });

    expect(result.resolvedDateKey).toBe(D_FRI);
    expect(result.resolution).toBe('next_weekday');
    expect(result.ambiguity).toBeNull();
  });

  it('is not case sensitive about weekday words', async () => {
    expect((await diagnose('salon_diag', { date: '  FRIDAY ' })).resolvedDateKey).toBe(D_FRI);
  });

  it('flags the weekday that is also today, and diagnoses the next one', async () => {
    const result = await diagnose('salon_diag', { date: 'thursday' });

    expect(result.ambiguity).toBe('today_or_next');
    expect(result.resolvedDateKey).toBe(D_THU_NEXT);
    expect(result.resolution).toBe('next_weekday');
  });

  it('understands today and tomorrow in the salon timezone', async () => {
    const today = await diagnose('salon_diag', { date: 'today' });
    const tomorrow = await diagnose('salon_diag', { date: 'tomorrow' });

    expect(today).toMatchObject({ resolvedDateKey: D_TODAY, resolution: 'today', ambiguity: null });
    expect(tomorrow).toMatchObject({ resolvedDateKey: D_FRI, resolution: 'tomorrow', ambiguity: null });
  });

  it.each([
    ['a day that has already passed', '2026-03-04'],
    ['a day beyond the sixty-day window', '2026-06-30'],
    ['a word that is not a day at all', 'someday'],
    ['a malformed date', '2026-3-6'],
  ])('refuses %s', async (_label, date) => {
    await expect(diagnoseDayAvailability(
      'salon_diag',
      { date, serviceName: null, technicianName: null },
      { now: NOW },
    )).rejects.toThrow(DiagnoseDayInvalidArgumentsError);
  });

  it('accepts both ends of the sixty-day window', async () => {
    await expect(diagnose('salon_diag', { date: D_TODAY })).resolves.toMatchObject({ resolvedDateKey: D_TODAY });
    await expect(diagnose('salon_diag', { date: '2026-05-04' })).resolves.toMatchObject({ resolvedDateKey: '2026-05-04' });
  });
});

describe('step 2 — naming a service or a team member', () => {
  it('asks which service when the name matches nothing', async () => {
    const result = await diagnose('salon_diag', { date: 'friday', serviceName: 'balayage' });

    expect(result.clarify).toEqual({
      kind: 'service',
      options: ['Fill', 'fill!', 'Gel manicure', 'Orphan wrap', 'Solo art'],
    });
    expect(result.causes).toEqual([]);
    // An inactive service is not an option, and is not a match either.
    expect(result.clarify?.options).not.toContain('Hidden buff');
  });

  it('asks which service when the name matches several', async () => {
    const result = await diagnose('salon_diag', { date: 'friday', serviceName: 'fill' });

    expect(result.clarify).toEqual({ kind: 'service', options: ['Fill', 'fill!'] });
    expect(result.causes).toEqual([]);
  });

  it('resolves a service by an exact normalized match and reports its real duration', async () => {
    const result = await diagnose('salon_diag', { date: 'friday', serviceName: '  gel Manicure ' });

    expect(result.clarify).toBeUndefined();
    expect(result.checked.serviceName).toBe('Gel manicure');
    expect(result.checked.durationMinutes).toBe(60);
  });

  it('resolves a team member, and asks when the name is not one', async () => {
    const resolved = await diagnose('salon_diag', { date: 'friday', technicianName: 'isla' });

    expect(resolved.checked.technician).toBe('Isla');

    const unknown = await diagnose('salon_diag', { date: 'friday', technicianName: 'Nobody' });

    expect(unknown.clarify).toEqual({ kind: 'technician', options: ['Isla', 'Mara'] });
    expect(unknown.causes).toEqual([]);
  });

  it('will not match an inactive team member', async () => {
    const result = await diagnose('salon_diag', { date: 'friday', technicianName: 'Retired' });

    expect(result.clarify).toEqual({ kind: 'technician', options: ['Isla', 'Mara'] });
  });

  it('checks the whole team when no name is given', async () => {
    expect((await diagnose('salon_diag', { date: 'friday' })).checked.technician).toBe('any');
  });
});

describe('steps 3 and 4 — the gates above the slot loop', () => {
  it('reports an unpublished page and keeps diagnosing', async () => {
    const result = await diagnose('salon_diag_draft', { date: 'friday' });

    expect(codes(result)).toContain('salon_not_public');
    expect(causeFor(result, 'salon_not_public')?.link).toBe('page_publish');
    // The rest of the day still ran: the owner hears both facts at once.
    expect(result.bookableSlotCount).toBeGreaterThan(0);
  });

  it('reports online booking being switched off, with nowhere to send the owner', async () => {
    const result = await diagnose('salon_diag_nobooking', { date: 'friday' });

    expect(codes(result)).toContain('online_booking_off');
    expect(causeFor(result, 'online_booking_off')?.link).toBeNull();
  });

  it('reports a day the salon is closed, and stops there', async () => {
    const result = await diagnose('salon_diag', { date: 'saturday' });

    expect(result.resolvedDateKey).toBe(D_SAT);
    expect(result.causes).toEqual([{ code: 'closed_that_day', link: 'business_hours' }]);
    expect(result.bookableSlotCount).toBe(0);
    expect(result.firstBookable).toBeNull();
  });

  it('reads the closure from the location when the salon row disagrees', async () => {
    const result = await diagnose('salon_diag_location', { date: 'friday' });

    expect(codes(result)).toEqual(['closed_that_day']);

    // The same salon is open the day before, so the closure is the location's
    // Friday and not a blanket refusal.
    const openDay = await diagnose('salon_diag_location', { date: 'today' });

    expect(codes(openDay)).not.toContain('closed_that_day');
    expect(openDay.bookableSlotCount).toBeGreaterThan(0);
  });
});

describe('step 5 — the public selection validator', () => {
  it('reports a service the booking page would refuse, with the validator\'s own code', async () => {
    const result = await diagnose('salon_diag', {
      date: 'friday',
      serviceName: 'Solo art',
      technicianName: 'Mara',
    });

    expect(result.causes).toEqual([
      { code: 'service_not_bookable', detail: 'unsupported_technician', link: 'services' },
    ]);
    expect(result.bookableSlotCount).toBe(0);
  });

  it('takes the duration and buffer from the quote, not from the service row', async () => {
    const result = await diagnose('salon_diag', { date: 'friday', serviceName: 'Gel manicure' });

    expect(result.checked).toMatchObject({
      serviceName: 'Gel manicure',
      durationMinutes: 60,
      bufferMinutes: 0,
      technician: 'any',
    });
  });
});

describe('steps 6 and 7 — who is there, and what their day looks like', () => {
  it('reports a salon with nobody active', async () => {
    const result = await diagnose('salon_diag_empty', { date: 'friday' });

    expect(result.causes).toEqual([{ code: 'no_active_technicians', link: 'team_members' }]);
  });

  it('reports a service nobody on the team offers', async () => {
    const result = await diagnose('salon_diag', { date: 'friday', serviceName: 'Orphan wrap' });

    expect(result.causes).toEqual([{ code: 'no_technician_offers_service', link: 'team' }]);
  });

  it('names who is on time off and who is not working that day', async () => {
    const result = await diagnose('salon_diag_sched', { date: 'friday' });

    expect(causeFor(result, 'technician_time_off')).toEqual({
      code: 'technician_time_off',
      technicianName: 'Away',
      link: 'team_time_off',
    });
    expect(causeFor(result, 'technician_day_off')).toEqual({
      code: 'technician_day_off',
      technicianName: 'NoFriday',
      link: 'team',
    });
    // Ready still works Friday, so the day is not lost.
    expect(result.bookableSlotCount).toBeGreaterThan(0);
  });
});

describe('step 8 — what the slot loop found', () => {
  it('counts an open day and names the first bookable time', async () => {
    const result = await diagnose('salon_diag', { date: 'friday' });

    // 09:00–17:00 on a 30-minute grid with a 30-minute default check.
    expect(result.bookableSlotCount).toBe(16);
    expect(result.firstBookable).toBe('9:00');
    expect(result.publicRouteState).toBe('ok');
  });

  it('reports minimum notice when it swallows the whole day', async () => {
    const result = await diagnose('salon_diag_notice', { date: 'friday' });

    const minNotice = causeFor(result, 'min_notice');

    expect(minNotice?.link).toBe('booking_rules');
    expect(minNotice?.count).toBeGreaterThan(0);
    expect(Number.isInteger(minNotice?.count)).toBe(true);
    expect(result.bookableSlotCount).toBe(0);
    expect(result.firstBookable).toBeNull();
  });

  it('reports one blocked half-hour as exactly one refused slot', async () => {
    const result = await diagnose('salon_diag_blocked', { date: 'friday' });

    expect(causeFor(result, 'blocked_slot')).toEqual({
      code: 'blocked_slot',
      count: 1,
      technicianName: 'Bree',
      link: 'team',
    });
    expect(result.bookableSlotCount).toBe(15);
  });

  it('reports one booked half-hour as a time conflict, with no trace of the booking', async () => {
    const result = await diagnose('salon_diag_appt', { date: 'friday' });

    expect(causeFor(result, 'time_conflict')).toEqual({
      code: 'time_conflict',
      count: 1,
      technicianName: 'Ada',
      link: 'calendar',
    });
    expect(result.bookableSlotCount).toBe(15);

    expectNoPii(result, 'time_conflict result');
  });

  it('reports one busy calendar half-hour as a count, with no event detail', async () => {
    holder.googleBusy = [{ startTime: at(D_FRI, '12:00'), endTime: at(D_FRI, '12:30') }];

    const result = await diagnose('salon_diag', { date: 'friday' });

    expect(causeFor(result, 'google_busy')).toEqual({ code: 'google_busy', count: 1, link: 'integrations' });
    expect(result.bookableSlotCount).toBe(15);
  });

  it('never carries a per-technician cause for somebody outside this salon', async () => {
    const result = await diagnose('salon_diag_sched', { date: 'friday' });
    const names = result.causes
      .map(cause => cause.technicianName)
      .filter((name): name is string => name !== undefined);

    for (const name of names) {
      expect(['Away', 'NoFriday', 'Ready']).toContain(name);
    }
  });
});

describe('step 9 — a calendar Luster cannot read', () => {
  it('reports the failure, marks the public page broken, and still reports the rest', async () => {
    holder.googleError = new GoogleCalendarAvailabilityError(true);

    const result = await diagnose('salon_diag_sched', { date: 'friday' });

    expect(causeFor(result, 'calendar_unverified')).toEqual({ code: 'calendar_unverified', link: 'integrations' });
    expect(result.publicRouteState).toBe('error');
    // The other causes survive the calendar failure.
    expect(codes(result)).toContain('technician_time_off');
    expect(codes(result)).toContain('technician_day_off');
  });

  it('lets a non-calendar fault surface as a fault', async () => {
    holder.googleError = new Error('boom');

    await expect(diagnoseDayAvailability(
      'salon_diag',
      { date: 'friday', serviceName: null, technicianName: null },
      { now: NOW },
    )).rejects.toThrow('boom');
  });
});

describe('what every result must satisfy', () => {
  it('links to a real destination or to nothing, and never leaks a client', () => {
    expect(produced.length).toBeGreaterThan(20);

    for (const { label, result } of produced) {
      expectLinksAreRegistryKeysOrNull(result, label);
      expectNoPii(result, label);
    }
  });

  it('never returns a count that is not a whole number of slots', () => {
    for (const { label, result } of produced) {
      for (const cause of result.causes) {
        if (cause.count === undefined) {
          continue;
        }

        expect(Number.isInteger(cause.count), `${label}: ${cause.code}`).toBe(true);
        expect(cause.count, `${label}: ${cause.code}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never returns a free-text detail', () => {
    for (const { label, result } of produced) {
      for (const cause of result.causes) {
        if (cause.detail === undefined) {
          continue;
        }

        expect(cause.detail, `${label}: ${cause.code}`).toMatch(/^[a-z_]+$/);
      }
    }
  });
});

describe('the dispatcher', () => {
  const ENABLED = [...OWNER_ASSISTANT_TOOL_NAMES];

  it('runs the tool with the resolved salon', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'diagnose_day_availability',
      argumentsJson: '{"date":"friday","serviceName":null,"technicianName":null}',
      salonId: 'salon_diag',
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result).toMatchObject({ resolvedDateKey: D_FRI, bookableSlotCount: 16 });
  });

  it('turns an unusable day into invalid_arguments, not a fault', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'diagnose_day_availability',
      argumentsJson: '{"date":"2026-06-30","serviceName":null,"technicianName":null}',
      salonId: 'salon_diag',
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('invalid_arguments');
  });

  it.each([
    ['a missing argument', '{"date":"friday"}'],
    ['a wrong-typed argument', '{"date":"friday","serviceName":3,"technicianName":null}'],
    ['an extra argument', '{"date":"friday","serviceName":null,"technicianName":null,"salonId":"salon_diag_empty"}'],
    ['a date that is far too long', `{"date":"${'a'.repeat(33)}","serviceName":null,"technicianName":null}`],
    ['arguments that are not JSON', 'not json'],
  ])('rejects %s before any query runs', async (_label, argumentsJson) => {
    const outcome = await executeOwnerAssistantTool({
      name: 'diagnose_day_availability',
      argumentsJson,
      salonId: 'salon_diag',
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('invalid_arguments');
  });

  it('refuses the tool when the operator has not enabled it', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'diagnose_day_availability',
      argumentsJson: '{"date":"friday","serviceName":null,"technicianName":null}',
      salonId: 'salon_diag',
      enabledTools: ['get_salon_overview'],
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('tool_not_enabled');
  });

  it('turns a missing salon into tool_failed', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'diagnose_day_availability',
      argumentsJson: '{"date":"friday","serviceName":null,"technicianName":null}',
      salonId: 'salon_that_does_not_exist',
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('tool_failed');
  });
});

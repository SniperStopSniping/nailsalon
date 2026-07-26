import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { GET } from './route';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({
  db: null as unknown,
}));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon: vi.fn(async () => ({
    salon: { id: 'salon_google_events', slug: 'google-events-salon' },
    error: null,
  })),
}));

vi.mock('@/libs/googleCalendarInbound', () => ({
  processGoogleCalendarInboundSync: vi.fn(async () => undefined),
}));

vi.mock('@/libs/googleEventReview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/googleEventReview')>();
  return {
    ...actual,
    getRecordedGoogleEventDecision: vi.fn(async () => null),
  };
});

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  const now = new Date();
  const eventStart = new Date(now.getTime() + 86_400_000);

  await db.insert(schema.salonSchema).values({
    id: 'salon_google_events',
    name: 'Google Events Salon',
    slug: 'google-events-salon',
  });
  await db.insert(schema.salonClientSchema).values([
    {
      id: 'google_active',
      salonId: 'salon_google_events',
      phone: '4165554201',
      fullName: 'Active Person',
      email: 'active@example.test',
    },
    {
      id: 'google_archived',
      salonId: 'salon_google_events',
      phone: '4165554202',
      fullName: 'Archived Person',
      email: 'archived@example.test',
      archivedAt: new Date(now.getTime() - 86_400_000),
      archivedBy: 'archive-test',
    },
    {
      id: 'google_archived_short_name',
      salonId: 'salon_google_events',
      phone: '4165554205',
      fullName: 'Al',
      archivedAt: new Date(now.getTime() - 86_400_000),
      archivedBy: 'archive-test',
    },
    {
      id: 'google_terminal',
      salonId: 'salon_google_events',
      phone: '4165554203',
      fullName: 'Canonical Person',
    },
    {
      id: 'google_merged_source',
      salonId: 'salon_google_events',
      phone: '4165554204',
      fullName: 'Merged Person',
      email: 'merged@example.test',
    },
  ]);

  await db.execute(sql.raw(
    'ALTER TABLE salon_client DISABLE TRIGGER salon_client_enforce_merge_transition',
  ));
  try {
    await db.execute(sql.raw(`
      UPDATE salon_client
      SET merged_into_client_id = 'google_terminal'
      WHERE id = 'google_merged_source'
    `));
  } finally {
    await db.execute(sql.raw(
      'ALTER TABLE salon_client ENABLE TRIGGER salon_client_enforce_merge_transition',
    ));
  }

  await db.insert(schema.googleCalendarEventSchema).values([
    {
      id: 'google_event_active',
      salonId: 'salon_google_events',
      calendarId: 'primary',
      googleEventId: 'provider_active',
      title: 'Active Person',
      startTime: eventStart,
      endTime: new Date(eventStart.getTime() + 3_600_000),
      durationMinutes: 60,
    },
    {
      id: 'google_event_archived',
      salonId: 'salon_google_events',
      calendarId: 'primary',
      googleEventId: 'provider_archived',
      title: 'Archived contact import',
      attendeeName: 'External Calendar Guest',
      attendeePhone: '+1 (416) 555-4202',
      startTime: new Date(eventStart.getTime() + 3_600_000),
      endTime: new Date(eventStart.getTime() + 7_200_000),
      durationMinutes: 60,
    },
    {
      id: 'google_event_merged',
      salonId: 'salon_google_events',
      calendarId: 'primary',
      googleEventId: 'provider_merged',
      title: 'Imported guest from calendar',
      attendeeName: 'Another Calendar Guest',
      attendeeEmail: 'MERGED@example.test',
      startTime: new Date(eventStart.getTime() + 7_200_000),
      endTime: new Date(eventStart.getTime() + 10_800_000),
      durationMinutes: 60,
    },
    {
      id: 'google_event_archived_title',
      salonId: 'salon_google_events',
      calendarId: 'primary',
      googleEventId: 'provider_archived_title',
      title: 'Gel manicure between Example Salon and Archived Person',
      startTime: new Date(eventStart.getTime() + 10_800_000),
      endTime: new Date(eventStart.getTime() + 14_400_000),
      durationMinutes: 60,
    },
    {
      id: 'google_event_external',
      salonId: 'salon_google_events',
      calendarId: 'primary',
      googleEventId: 'provider_external',
      title: 'External calendar guest',
      attendeeName: 'New External Person',
      attendeePhone: '+1 (416) 555-4299',
      attendeeEmail: 'external@example.test',
      startTime: new Date(eventStart.getTime() + 14_400_000),
      endTime: new Date(eventStart.getTime() + 18_000_000),
      durationMinutes: 60,
    },
    {
      id: 'google_event_short_name_collision',
      salonId: 'salon_google_events',
      calendarId: 'primary',
      googleEventId: 'provider_short_name_collision',
      title: 'Salon nail art workshop',
      attendeeName: 'Independent External Guest',
      attendeePhone: '+1 (416) 555-4298',
      startTime: new Date(eventStart.getTime() + 18_000_000),
      endTime: new Date(eventStart.getTime() + 21_600_000),
      durationMinutes: 60,
    },
  ]);
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe('GET /api/admin/google-events', () => {
  it('suggests active clients only and never revives archived or merged profiles by title', async () => {
    const response = await GET(new Request(
      'http://localhost/api/admin/google-events?salonSlug=google-events-salon',
    ));
    const body = await response.json();
    type GoogleEventResult = {
      id: string;
      suggestion: { client: unknown };
    };
    const events = new Map<string, GoogleEventResult>(
      body.data.events.map((event: GoogleEventResult) => [event.id, event]),
    );

    expect(response.status).toBe(200);
    expect(events.get('google_event_active')?.suggestion.client).toEqual({
      fullName: 'Active Person',
      phone: '4165554201',
      email: 'active@example.test',
    });
    expect(events.get('google_event_archived')?.suggestion.client).toBeNull();
    expect(events.get('google_event_merged')?.suggestion.client).toBeNull();
    expect(events.get('google_event_archived_title')?.suggestion.client).toBeNull();
    expect(events.get('google_event_external')?.suggestion.client).toEqual({
      fullName: 'New External Person',
      phone: '+1 (416) 555-4299',
      email: 'external@example.test',
    });
    expect(events.get('google_event_short_name_collision')?.suggestion.client)
      .toEqual({
        fullName: 'Independent External Guest',
        phone: '+1 (416) 555-4298',
        email: null,
      });
  });

  it('fails suggestion suppression closed when archived identities exceed the bounded scan', async () => {
    const archivedAt = new Date();
    await db.insert(schema.salonClientSchema).values(
      Array.from({ length: 499 }, (_, index) => ({
        id: `google_archived_overflow_${index}`,
        salonId: 'salon_google_events',
        phone: `647${String(10_000_000 + index).slice(-7)}`,
        fullName: `Archived Overflow ${index}`,
        archivedAt,
        archivedBy: 'archive-overflow-test',
      })),
    );

    const response = await GET(new Request(
      'http://localhost/api/admin/google-events?salonSlug=google-events-salon',
    ));
    const body = await response.json();
    type GoogleEventResult = {
      id: string;
      suggestion: { client: unknown };
    };
    const events = new Map<string, GoogleEventResult>(
      body.data.events.map((event: GoogleEventResult) => [event.id, event]),
    );

    expect(response.status).toBe(200);
    expect(events.get('google_event_external')?.suggestion.client).toBeNull();
    expect(events.get('google_event_short_name_collision')?.suggestion.client)
      .toBeNull();
  });
});

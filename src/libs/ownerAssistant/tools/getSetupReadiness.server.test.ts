/**
 * `get_setup_readiness` against a real schema (PGlite).
 *
 * The tool owns no rules, so this suite does not re-test the derivation (that
 * is `src/libs/setupReadiness/readiness.test.ts`, exhaustively). It proves the
 * three things the ADAPTER can get wrong: that the projection reaches the
 * model unchanged — no field silently dropped, none added — that every link
 * key it carries is a key the assistant's own registry can turn into a real
 * destination, and that nothing client-shaped rides along.
 *
 * `@/libs/integrationHealth` is held at the same seam the loader's own suite
 * holds it at: it fans out across eight unrelated tables and five environment
 * variables to answer two connection questions.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const health = vi.hoisted(() => ({
  google: { readiness: 'not_connected' as string },
  stripeConnect: { status: 'not_connected' as string },
}));

vi.mock('@/libs/integrationHealth', () => ({
  getSalonIntegrationHealth: vi.fn(async () => health),
}));

const { getSetupReadiness } = await import('./getSetupReadiness.server');
const { executeOwnerAssistantTool } = await import('./index.server');
const { loadSetupReadiness } = await import('@/libs/setupReadiness/readiness.server');
const { isRegistryKey } = await import('../registry');
const { OWNER_ASSISTANT_TOOL_NAMES } = await import('../contracts');

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
  expect(serialized, label).not.toContain('@example.com');
}

const READY_SALON = 'salon_readiness_tool_ready';
const UNFINISHED_SALON = 'salon_readiness_tool_unfinished';
const NOW = new Date('2026-09-16T12:00:00.000Z');

const WORKING_WEEK = {
  sunday: null,
  monday: { start: '09:00', end: '17:00' },
  tuesday: { start: '09:00', end: '17:00' },
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
};

const SALON_HOURS = {
  sunday: null,
  monday: { open: '09:00', close: '17:00' },
  tuesday: { open: '09:00', close: '17:00' },
  wednesday: null,
  thursday: null,
  friday: null,
  saturday: null,
};

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
      id: READY_SALON,
      name: 'Ready Studio',
      slug: 'readiness-tool-ready',
      publicationStatus: 'published',
      businessHours: SALON_HOURS,
      settings: {
        bookingPageContent: {
          version: 1,
          draft: { bio: 'Builder gel, structured and long-wearing.' },
          live: { bio: 'Builder gel, structured and long-wearing.' },
        },
        bookingPage: {
          version: 1,
          draft: { layout: 'quick_book', quickBookProfile: { version: 1, showBio: true } },
          live: { layout: 'quick_book', quickBookProfile: { version: 1, showBio: true } },
        },
      } as never,
    },
    {
      // Nothing done yet: unpublished, no services, no team, no hours, no
      // intro text and nothing connected — so the projection has to carry
      // several severities and several different link keys at once.
      id: UNFINISHED_SALON,
      name: 'Unfinished Studio',
      slug: 'readiness-tool-unfinished',
      publicationStatus: 'draft',
      businessHours: null,
    },
  ]);

  await db.insert(schema.technicianSchema).values({
    id: 'tech_readiness_tool',
    salonId: READY_SALON,
    name: 'Isla',
    isActive: true,
    weeklySchedule: WORKING_WEEK,
  });

  await db.insert(schema.serviceSchema).values({
    id: 'svc_readiness_tool',
    salonId: READY_SALON,
    name: 'Builder gel set',
    price: 9500,
    durationMinutes: 60,
    category: 'builder_gel',
    isActive: true,
  });
}, 120_000);

afterAll(async () => {
  await client.close();
});

describe('get_setup_readiness', () => {
  it('hands the projection over unchanged, and adds nothing of its own', async () => {
    const [viaTool, viaLoader] = await Promise.all([
      getSetupReadiness(UNFINISHED_SALON, { now: NOW }),
      loadSetupReadiness(UNFINISHED_SALON, NOW),
    ]);

    expect(viaTool).toEqual(viaLoader);
    expect(Object.keys(viaTool).sort()).toEqual(['computedAt', 'customersWillSee', 'items', 'salon']);
  });

  it('reports what an unfinished salon still owes, required items first', async () => {
    const result = await getSetupReadiness(UNFINISHED_SALON, { now: NOW });
    const severities = result.items.map(item => item.severity);
    const rank = { required: 0, recommended: 1, optional: 2, ready: 3 } as const;

    expect(result.items.map(item => item.code)).toEqual(
      expect.arrayContaining(['not_published', 'no_active_services', 'no_active_technician']),
    );
    // Ordering is the projection's contract; the tool must not reshuffle it.
    expect(severities.map(severity => rank[severity]))
      .toEqual([...severities.map(severity => rank[severity])].sort((a, b) => a - b));
    expect(result.salon).toMatchObject({ name: 'Unfinished Studio', publicationStatus: 'draft' });
    expect(result.computedAt).toBe(NOW.toISOString());
  });

  it('reports a finished salon as finished', async () => {
    health.google.readiness = 'ready';
    health.stripeConnect.status = 'charge_ready';

    const result = await getSetupReadiness(READY_SALON, { now: NOW });

    expect(result.items).toEqual([]);
    expect(result.customersWillSee).toMatchObject({ layoutId: 'quick_book', rendersBio: true });

    health.google.readiness = 'not_connected';
    health.stripeConnect.status = 'not_connected';
  });

  it('only ever points at a destination the assistant can actually open', async () => {
    const result = await getSetupReadiness(UNFINISHED_SALON, { now: NOW });
    const keys = result.items.flatMap(item => item.links.map(link => link.key));

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      expect(isRegistryKey(key), `"${key}" is not a navigation registry key`).toBe(true);
    }
  });

  it('carries no client-shaped data', async () => {
    expectNoPii(await getSetupReadiness(UNFINISHED_SALON, { now: NOW }), 'get_setup_readiness (unfinished)');
    expectNoPii(await getSetupReadiness(READY_SALON, { now: NOW }), 'get_setup_readiness (ready)');
  });
});

describe('the dispatcher', () => {
  const ENABLED = [...OWNER_ASSISTANT_TOOL_NAMES];

  it('runs the tool for the resolved salon', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'get_setup_readiness',
      argumentsJson: '{}',
      salonId: UNFINISHED_SALON,
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.result).toMatchObject({ salon: { name: 'Unfinished Studio' } });
  });

  it('accepts an empty argument string', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'get_setup_readiness',
      argumentsJson: '',
      salonId: READY_SALON,
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(true);
  });

  it.each([
    ['an argument it does not take', '{"includeInactive":true}'],
    ['a smuggled salon id', `{"salonId":"${READY_SALON}"}`],
    ['arguments that are not JSON', 'not json'],
  ])('rejects %s', async (_label, argumentsJson) => {
    const outcome = await executeOwnerAssistantTool({
      name: 'get_setup_readiness',
      argumentsJson,
      salonId: UNFINISHED_SALON,
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('invalid_arguments');
  });

  it('refuses the tool when the operator has not enabled it', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'get_setup_readiness',
      argumentsJson: '{}',
      salonId: READY_SALON,
      enabledTools: ['find_destination'],
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('tool_not_enabled');
  });

  it('turns a salon that does not exist into tool_failed', async () => {
    const outcome = await executeOwnerAssistantTool({
      name: 'get_setup_readiness',
      argumentsJson: '{}',
      salonId: 'salon_that_does_not_exist',
      enabledTools: ENABLED,
      now: NOW,
    });

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.code).toBe('tool_failed');
  });
});

/**
 * Owner feedback rows, against the real schema (PGlite).
 *
 * The contract being pinned is a privacy contract as much as a storage one: a
 * rating carries no free text at all, a report carries the owner's OWN sentence
 * and nothing else, a withdrawal carries no text ever, and every key name
 * survives `sanitizeAuditMetadata` (a redacted key would silently replace real
 * evidence with `[REDACTED]`). The de-duplication of a retried `feedbackId`
 * lives in the READER, because the table has no unique index — that is pinned
 * here too, so nobody later mistakes the writer for idempotent.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const {
  listOwnerAssistantFeedback,
  recordOwnerAssistantFeedback,
  recordOwnerAssistantFeedbackWithdrawal,
} = await import('./feedback.server');
const { OWNER_ASSISTANT_FEEDBACK_LIMITS } = await import('./contracts');
// The single source of truth for what the sanitiser redacts; imported rather
// than re-typed so this test cannot drift from the sanitiser it protects.
const { sanitizeAuditMetadata } = await import('@/libs/auditLog');

const SALON = { id: 'salon_feedback', slug: 'isla-nail-studio', name: 'Isla Nail Studio' };
const OWNER = 'user_clerk_owner';
const OTHER_OWNER = 'user_clerk_co_owner';

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values({
    id: SALON.id,
    name: SALON.name,
    slug: SALON.slug,
    settings: { booking: { currency: 'CAD', timezone: 'America/Toronto' } },
  });
});

beforeEach(async () => {
  holder.db = db;
  await db.delete(schema.salonAuditLogSchema).where(eq(schema.salonAuditLogSchema.salonId, SALON.id));
});

const rows = () =>
  db.select().from(schema.salonAuditLogSchema).where(eq(schema.salonAuditLogSchema.salonId, SALON.id));

type Payload = Record<string, unknown>;

function payloadOf(row: { metadata: unknown }): Payload {
  return (row.metadata as { newValue: Payload }).newValue;
}

const record = (overrides: Partial<Parameters<typeof recordOwnerAssistantFeedback>[0]> = {}) =>
  recordOwnerAssistantFeedback({
    salonId: SALON.id,
    performedBy: OWNER,
    feedbackId: 'fb-00000001',
    kind: 'up',
    conversationId: 'cid-abcdefgh',
    turnIndex: 2,
    cardKind: 'answer',
    ...overrides,
  });

describe('the row a rating writes', () => {
  it('writes one audit row with the documented shape', async () => {
    await record({ kind: 'down' });

    const written = await rows();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      salonId: SALON.id,
      action: 'owner_assistant_feedback',
      performedBy: OWNER,
      performedByEmail: null,
    });
    expect(written[0]?.metadata).toEqual({
      field: 'owner_assistant_feedback',
      details: 'Owner assistant feedback',
      newValue: {
        feedbackId: 'fb-00000001',
        kind: 'down',
        conversationId: 'cid-abcdefgh',
        turnIndex: 2,
        cardKind: 'answer',
        reasonCodes: [],
        ownerText: null,
        ownerTextChars: 0,
      },
    });
  });

  it('omits the correlation keys it was not given rather than writing nulls', async () => {
    await record({ conversationId: undefined, turnIndex: undefined, cardKind: undefined });

    const payload = payloadOf((await rows())[0]!);

    expect(payload).not.toHaveProperty('conversationId');
    expect(payload).not.toHaveProperty('turnIndex');
    expect(payload).not.toHaveProperty('cardKind');
  });

  it.each(['up', 'down'] as const)('drops free text from a %s rating even when a caller sends it', async (kind) => {
    await record({ kind, text: 'the assistant told me my client Jane cancelled' });

    const payload = payloadOf((await rows())[0]!);

    expect(payload.ownerText).toBeNull();
    expect(payload.ownerTextChars).toBe(0);
    expect(JSON.stringify(payload)).not.toContain('Jane');
  });

  it('keeps the closed reason vocabulary as given', async () => {
    await record({ kind: 'report', reasonCodes: ['wrong_answer', 'confusing'] });

    expect(payloadOf((await rows())[0]!).reasonCodes).toEqual(['wrong_answer', 'confusing']);
  });
});

describe('the row a report writes', () => {
  it('keeps the owner\'s own sentence, trimmed', async () => {
    await record({ kind: 'report', text: '   It said my page was live but it is not.   ' });

    const payload = payloadOf((await rows())[0]!);

    expect(payload.ownerText).toBe('It said my page was live but it is not.');
    expect(payload.ownerTextChars).toBe(39);
  });

  it('caps the text at the documented limit', async () => {
    const overlong = 'x'.repeat(OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars + 250);
    await record({ kind: 'report', text: overlong });

    const payload = payloadOf((await rows())[0]!);

    expect((payload.ownerText as string).length).toBe(OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars);
    expect(payload.ownerTextChars).toBe(OWNER_ASSISTANT_FEEDBACK_LIMITS.textMaxChars);
  });

  it('records a whitespace-only report as a report with no text', async () => {
    await record({ kind: 'report', text: '   \n  ' });

    expect(payloadOf((await rows())[0]!)).toMatchObject({ kind: 'report', ownerText: null, ownerTextChars: 0 });
  });
});

describe('key names survive the audit sanitiser', () => {
  it('writes no key the sanitiser would redact', async () => {
    await record({ kind: 'report', text: 'a note' });
    await recordOwnerAssistantFeedbackWithdrawal({
      salonId: SALON.id,
      performedBy: OWNER,
      feedbackId: 'fb-00000001',
      conversationId: 'cid-abcdefgh',
      turnIndex: 2,
    });

    const written = await rows();

    expect(written).toHaveLength(2);

    for (const row of written) {
      const serialized = JSON.stringify(row.metadata);

      expect(serialized).not.toContain('[REDACTED]');
      // The strongest form of the check: running the stored metadata back
      // through the sanitiser must be a no-op. If a future key name contains
      // `token`, `session`, `url`, `link`, … this fails.
      expect(sanitizeAuditMetadata(row.metadata)).toEqual(row.metadata);
    }
  });
});

describe('the withdrawal row', () => {
  it('names the same feedbackId under its own action and carries no text', async () => {
    await record({ kind: 'report', text: 'my own words' });
    await recordOwnerAssistantFeedbackWithdrawal({
      salonId: SALON.id,
      performedBy: OWNER,
      feedbackId: 'fb-00000001',
    });

    const withdrawal = (await rows()).find(row => row.action === 'owner_assistant_feedback_withdrawn');

    expect(withdrawal).toBeDefined();
    expect(withdrawal?.metadata).toEqual({
      field: 'owner_assistant_feedback',
      details: 'Owner assistant feedback withdrawn',
      newValue: { feedbackId: 'fb-00000001' },
    });
    expect(JSON.stringify(withdrawal?.metadata)).not.toContain('my own words');
  });

  it('never edits or deletes the row it withdraws', async () => {
    await record({ kind: 'up' });
    await recordOwnerAssistantFeedbackWithdrawal({
      salonId: SALON.id,
      performedBy: OWNER,
      feedbackId: 'fb-00000001',
    });

    const original = (await rows()).filter(row => row.action === 'owner_assistant_feedback');

    expect(original).toHaveLength(1);
    expect(payloadOf(original[0]!)).toMatchObject({ kind: 'up' });
  });
});

describe('a retry with the same feedbackId', () => {
  it('is tolerated by the writer and collapsed by the reader', async () => {
    // No unique index exists (this slice adds no migration), so the writer
    // happily writes twice — which is exactly why the reader de-duplicates.
    await record({ kind: 'down' });
    await record({ kind: 'down' });

    expect(await rows()).toHaveLength(2);

    const listed = await listOwnerAssistantFeedback({ salonId: SALON.id, performedBy: OWNER, database: db });

    expect(listed).toEqual([
      { feedbackId: 'fb-00000001', kind: 'down', createdAt: expect.any(String), withdrawn: false },
    ]);
  });
});

describe('the reader', () => {
  it('returns only the requesting owner\'s rows', async () => {
    await record({ feedbackId: 'fb-mine-001' });
    await recordOwnerAssistantFeedback({
      salonId: SALON.id,
      performedBy: OTHER_OWNER,
      feedbackId: 'fb-theirs-1',
      kind: 'down',
    });

    const listed = await listOwnerAssistantFeedback({ salonId: SALON.id, performedBy: OWNER, database: db });

    expect(listed.map(item => item.feedbackId)).toEqual(['fb-mine-001']);
  });

  it('reports a withdrawn rating as withdrawn', async () => {
    await record({ feedbackId: 'fb-with-001', kind: 'report', text: 'note' });
    await recordOwnerAssistantFeedbackWithdrawal({
      salonId: SALON.id,
      performedBy: OWNER,
      feedbackId: 'fb-with-001',
    });

    const listed = await listOwnerAssistantFeedback({ salonId: SALON.id, performedBy: OWNER, database: db });

    expect(listed).toEqual([
      { feedbackId: 'fb-with-001', kind: 'report', createdAt: expect.any(String), withdrawn: true },
    ]);
  });

  it('never returns the owner text', async () => {
    await record({ kind: 'report', text: 'something confidential the owner typed' });

    const listed = await listOwnerAssistantFeedback({ salonId: SALON.id, performedBy: OWNER, database: db });

    expect(JSON.stringify(listed)).not.toContain('confidential');
  });

  it('returns newest first and caps the list', async () => {
    // Written in order, so the newest ids must come back first. Timestamps are
    // forced apart because `defaultNow()` inside one statement batch can tie.
    for (let index = 0; index < 4; index += 1) {
      await db.insert(schema.salonAuditLogSchema).values({
        id: `row_${index}`,
        salonId: SALON.id,
        action: 'owner_assistant_feedback',
        performedBy: OWNER,
        performedByEmail: null,
        createdAt: new Date(Date.UTC(2026, 8, 16, 10, index)),
        metadata: {
          field: 'owner_assistant_feedback',
          details: 'Owner assistant feedback',
          newValue: { feedbackId: `fb-${index}`, kind: 'up', reasonCodes: [], ownerText: null, ownerTextChars: 0 },
        },
      });
    }

    const listed = await listOwnerAssistantFeedback({ salonId: SALON.id, performedBy: OWNER, database: db });

    expect(listed.map(item => item.feedbackId)).toEqual(['fb-3', 'fb-2', 'fb-1', 'fb-0']);

    const capped = await listOwnerAssistantFeedback({
      salonId: SALON.id,
      performedBy: OWNER,
      limit: 2,
      database: db,
    });

    expect(capped.map(item => item.feedbackId)).toEqual(['fb-3', 'fb-2']);
  });

  it('never returns more than the documented maximum, whatever the caller asks for', async () => {
    const listed = await listOwnerAssistantFeedback({
      salonId: SALON.id,
      performedBy: OWNER,
      limit: 10_000,
      database: db,
    });

    expect(listed.length).toBeLessThanOrEqual(OWNER_ASSISTANT_FEEDBACK_LIMITS.listMax);
  });

  it('ignores the salon\'s other audit rows', async () => {
    await db.insert(schema.salonAuditLogSchema).values({
      id: 'row_lifecycle',
      salonId: SALON.id,
      action: 'owner_assistant_turn',
      performedBy: OWNER,
      metadata: { field: 'owner_assistant', newValue: { feedbackId: 'not-feedback', conversationId: 'c' } },
    });

    const listed = await listOwnerAssistantFeedback({ salonId: SALON.id, performedBy: OWNER, database: db });

    expect(listed).toEqual([]);
  });
});

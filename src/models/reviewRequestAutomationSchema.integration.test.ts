import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db: null }));

const SALON_ID = 'review_automation_schema_salon';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

let client: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

function triggerValues(id: string) {
  return {
    id,
    salonId: SALON_ID,
    appointmentId: 'review_automation_schema_appointment',
    kind: 'scheduled_end' as const,
    triggerAt: new Date('2026-09-19T15:00:00Z'),
    appointmentStartAt: new Date('2026-09-19T14:00:00Z'),
    appointmentEndAt: new Date('2026-09-19T15:00:00Z'),
    policyRevision: 2,
    scheduledFor: new Date('2026-09-19T16:00:00Z'),
    availableAt: new Date('2026-09-19T16:00:00Z'),
    expiresAt: new Date('2026-09-20T16:00:00Z'),
  };
}

function sqlState(error: unknown): string | undefined {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code ?? candidate.cause?.code;
}

async function expectSqlState(promise: Promise<unknown>, expected: string) {
  try {
    await promise;
  } catch (error) {
    expect(sqlState(error)).toBe(expected);

    return;
  }
  throw new Error(`Expected SQLSTATE ${expected}.`);
}

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  await db.insert(schema.salonSchema).values({
    id: SALON_ID,
    name: 'Review automation schema salon',
    slug: 'review-automation-schema-salon',
  });
});

afterAll(async () => {
  await client?.close();
});

describe('migration 0081 — review request automation contract', () => {
  it('maps the additive policy and durable trigger columns', () => {
    const settingsColumns = new Set(Object.values(getTableColumns(schema.salonRetentionSettingsSchema)).map(column => column.name));
    const triggerColumns = new Set(Object.values(getTableColumns(schema.reviewRequestTriggerSchema)).map(column => column.name));
    const requestColumns = new Set(Object.values(getTableColumns(schema.reviewRequestSchema)).map(column => column.name));

    expect([...settingsColumns]).toEqual(expect.arrayContaining([
      'review_request_automation_mode',
      'review_request_repeat_cooldown_days',
      'review_request_policy_revision',
    ]));
    expect([...triggerColumns]).toEqual(expect.arrayContaining([
      'appointment_start_at',
      'appointment_end_at',
      'available_at',
      'expires_at',
      'scheduled_for',
    ]));
    expect(requestColumns.has('trigger_id')).toBe(true);
  });

  it('accepts the explicit 90-day policy and rejects invalid policy values', async () => {
    await db.insert(schema.salonRetentionSettingsSchema).values({
      salonId: SALON_ID,
      reviewRequestAutomationMode: 'scheduled_end',
      reviewRequestRepeatCooldownDays: 90,
      reviewRequestPolicyRevision: 2,
    });

    await expectSqlState(
      db.update(schema.salonRetentionSettingsSchema)
        .set({ reviewRequestRepeatCooldownDays: 30 })
        .where(sql`${schema.salonRetentionSettingsSchema.salonId} = ${SALON_ID}`),
      CHECK_VIOLATION,
    );
    await expectSqlState(
      db.update(schema.salonRetentionSettingsSchema)
        .set({ reviewRequestPolicyRevision: -1 })
        .where(sql`${schema.salonRetentionSettingsSchema.salonId} = ${SALON_ID}`),
      CHECK_VIOLATION,
    );
  });

  it('preserves a legacy policy without adopting new modes or cooldowns', async () => {
    const legacySalonId = 'review_automation_schema_legacy_salon';
    await db.insert(schema.salonSchema).values({
      id: legacySalonId,
      name: 'Legacy review automation schema salon',
      slug: 'legacy-review-automation-schema-salon',
    });
    await db.insert(schema.salonRetentionSettingsSchema).values({
      salonId: legacySalonId,
      automaticReviewRequests: true,
      reviewRequestDelayMinutes: 120,
    });

    const result = await db.execute(sql`
      select automatic_review_requests, review_request_delay_minutes,
        review_request_automation_mode, review_request_repeat_cooldown_days,
        review_request_policy_revision
      from salon_retention_settings
      where salon_id = ${legacySalonId}
    `);
    const rows = (result as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];

    expect(rows).toEqual([{
      automatic_review_requests: true,
      review_request_delay_minutes: 120,
      review_request_automation_mode: null,
      review_request_repeat_cooldown_days: null,
      review_request_policy_revision: 0,
    }]);
  });

  it('retains a single immutable scheduling decision per appointment policy', async () => {
    const trigger = triggerValues('review_automation_schema_trigger');
    await db.insert(schema.reviewRequestTriggerSchema).values(trigger);

    await db.insert(schema.reviewRequestTriggerSchema).values({
      ...triggerValues('review_automation_schema_trigger_rescheduled'),
      appointmentStartAt: new Date('2026-09-19T13:00:00Z'),
      state: 'skipped',
    });

    await expectSqlState(
      db.insert(schema.reviewRequestTriggerSchema).values({ ...trigger, id: 'review_automation_schema_trigger_duplicate' }),
      UNIQUE_VIOLATION,
    );
    await expectSqlState(
      db.insert(schema.reviewRequestTriggerSchema).values({
        ...triggerValues('review_automation_schema_trigger_invalid_expiry'),
        expiresAt: new Date('2026-09-19T16:00:00Z'),
      }),
      CHECK_VIOLATION,
    );
    await expectSqlState(
      db.update(schema.reviewRequestTriggerSchema)
        .set({ scheduledFor: new Date('2026-09-19T17:00:00Z') })
        .where(sql`${schema.reviewRequestTriggerSchema.id} = ${trigger.id}`),
      '55000',
    );
  });

  it('retains the legacy review-request uniqueness and completion constraints', async () => {
    const result = await db.execute(sql`
      select is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'review_request'
        and column_name = 'completed_at'
    `);
    const completedAt = (result as unknown as { rows?: { is_nullable: string }[] }).rows ?? [];
    const indexes = await db.execute(sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'review_request'
    `);
    const names = (indexes as unknown as { rows?: { indexname: string }[] }).rows?.map(row => row.indexname) ?? [];

    expect(completedAt).toEqual([{ is_nullable: 'NO' }]);
    expect(names).toEqual(expect.arrayContaining([
      'review_request_client_once',
      'review_request_phone_once',
    ]));
  });

  it('requires its durable review record to be removed before its trigger', async () => {
    const triggerId = 'review_automation_schema_trigger_referenced';
    await db.insert(schema.reviewRequestTriggerSchema).values({
      ...triggerValues(triggerId),
      appointmentId: 'review_automation_schema_appointment_referenced',
    });
    await db.insert(schema.reviewRequestSchema).values({
      id: 'review_automation_schema_request',
      salonId: SALON_ID,
      clientId: 'review_automation_schema_client',
      appointmentId: 'review_automation_schema_appointment_referenced',
      recipient: '+14165550100',
      source: 'automatic',
      triggerId,
      intentId: 'review_automation_schema_intent',
      completedAt: new Date('2026-09-19T15:00:00Z'),
      scheduledFor: new Date('2026-09-19T16:00:00Z'),
    });

    await expectSqlState(
      db.delete(schema.reviewRequestTriggerSchema)
        .where(sql`${schema.reviewRequestTriggerSchema.id} = ${triggerId}`),
      FOREIGN_KEY_VIOLATION,
    );
  });
});

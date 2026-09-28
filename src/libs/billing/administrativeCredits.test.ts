import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const { AdministrativeCreditConflictError, grantAdministrativeSmsCredits } = await import('./administrativeCredits');

let db: ReturnType<typeof drizzle<typeof schema>>;

async function seedSalon(id: string) {
  await db.insert(schema.salonSchema).values({ id, name: id, slug: id });
}

async function grant(input: { salonId: string; amount: number; reason: string; idempotencyKey: string }) {
  return db.transaction(tx => grantAdministrativeSmsCredits(tx, { ...input, actorId: 'super_1', now: new Date('2026-09-28T00:00:00.000Z') }));
}

beforeAll(async () => {
  const client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;
});

describe('grantAdministrativeSmsCredits', () => {
  it('adds one non-expiring administrative lot and replays the exact request without a second grant', async () => {
    await seedSalon('admin-credit-a');
    const input = {
      salonId: 'admin-credit-a',
      amount: 75,
      reason: 'Support correction',
      idempotencyKey: 'b82b21e8-4d2b-4d13-b7a9-5e8fa1bb7d60',
    };

    const first = await grant(input);
    const replay = await grant(input);
    const rows = await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, input.salonId));

    expect(first).toMatchObject({ created: true, balance: 75, administrativeBalance: 75 });
    expect(replay).toMatchObject({ created: false, lotId: first.lotId, balance: 75, administrativeBalance: 75 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bucket: 'administrative', amount: 75, expiresAt: null, reason: 'Support correction' });
  });

  it('rejects a reused key with a changed payload or target, preserving both salons', async () => {
    await seedSalon('admin-credit-b');
    await seedSalon('admin-credit-c');
    const key = '493f0f80-af21-4b0f-a183-1bca18cee215';
    await grant({ salonId: 'admin-credit-b', amount: 20, reason: 'Courtesy', idempotencyKey: key });

    await expect(grant({ salonId: 'admin-credit-b', amount: 21, reason: 'Courtesy', idempotencyKey: key }))
      .rejects.toBeInstanceOf(AdministrativeCreditConflictError);
    await expect(grant({ salonId: 'admin-credit-c', amount: 20, reason: 'Courtesy', idempotencyKey: key }))
      .rejects.toBeInstanceOf(AdministrativeCreditConflictError);

    expect(await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 'admin-credit-b'))).toHaveLength(1);
    expect(await db.select().from(schema.smsCreditLedgerSchema)
      .where(eq(schema.smsCreditLedgerSchema.salonId, 'admin-credit-c'))).toHaveLength(0);
  });
});

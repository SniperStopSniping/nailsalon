import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

import { getStarterAllowanceStatus } from './starterAllowanceStatus';

vi.mock('server-only', () => ({}));

let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
});

async function seedClaim(salonId: string, verified: boolean) {
  const identityId = `identity_${salonId}`;
  await db.insert(schema.salonSchema).values({ id: salonId, name: salonId, slug: salonId });
  await db.insert(schema.billingBusinessIdentitySchema).values({ id: identityId });
  await db.insert(schema.billingBusinessIdentityLinkSchema).values({
    id: `link_${salonId}`,
    businessIdentityId: identityId,
    linkType: 'salon',
    linkValue: salonId,
  });
  await db.insert(schema.billingStarterGrantSchema).values({
    id: `grant_${salonId}`,
    businessIdentityId: identityId,
    salonId,
    credits: 100,
  });
  if (verified) {
    await db.insert(schema.billingBusinessIdentityLinkSchema).values([
      { id: `email_${salonId}`, businessIdentityId: identityId, linkType: 'email_hmac', linkValue: `email_${salonId}`, hmacKeyVersion: 1 },
      { id: `phone_${salonId}`, businessIdentityId: identityId, linkType: 'phone_hmac', linkValue: `phone_${salonId}`, hmacKeyVersion: 1 },
    ]);
  }
  return identityId;
}

const status = (salonId: string) => db.transaction(tx => getStarterAllowanceStatus(tx, salonId));

describe('persisted starter allowance status', () => {
  it('recognizes completed verification with no remaining ledger balance on repeated reads', async () => {
    await seedClaim('status_verified', true);
    const linksBefore = await db.select().from(schema.billingBusinessIdentityLinkSchema);
    const grantsBefore = await db.select().from(schema.billingStarterGrantSchema);

    expect(await status('status_verified')).toBe('verified');
    expect(await status('status_verified')).toBe('verified');
    expect(await db.select().from(schema.billingBusinessIdentityLinkSchema)).toEqual(linksBefore);
    expect(await db.select().from(schema.billingStarterGrantSchema)).toEqual(grantsBefore);
    expect(await db.select().from(schema.smsCreditLedgerSchema)).toEqual([]);
  });

  it('requires reconciliation for a historical allowance without verified contacts', async () => {
    await seedClaim('status_historical', false);

    expect(await status('status_historical')).toBe('verification_required');
  });

  it('does not treat email verification alone as completed', async () => {
    const businessIdentityId = await seedClaim('status_email_only', false);
    await db.insert(schema.billingBusinessIdentityLinkSchema).values({
      id: 'email_only_link',
      businessIdentityId,
      linkType: 'email_hmac',
      linkValue: 'email_only_digest',
      hmacKeyVersion: 1,
    });

    expect(await status('status_email_only')).toBe('verification_required');
  });

  it('does not borrow another salon verification or grant', async () => {
    await db.insert(schema.salonSchema).values({ id: 'status_unclaimed', name: 'New salon', slug: 'status_unclaimed' });

    expect(await status('status_unclaimed')).toBe('unclaimed');
  });

  it('retains the claimed state when the same business creates another salon', async () => {
    const businessIdentityId = await seedClaim('status_original', true);
    await db.insert(schema.salonSchema).values({ id: 'status_recreated', name: 'Recreated', slug: 'status_recreated' });
    await db.insert(schema.billingBusinessIdentityLinkSchema).values({
      id: 'recreated_link',
      businessIdentityId,
      linkType: 'salon',
      linkValue: 'status_recreated',
    });

    expect(await status('status_recreated')).toBe('verified');
  });
});

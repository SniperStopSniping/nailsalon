import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/models/Schema';

import { FOUNDING_LIFETIME_TERMS } from './foundingLifetime';

describe('permanent free-core terms migration', () => {
  const client = new PGlite();
  const database = drizzle(client, { schema });
  let historical: typeof schema.foundingLifetimeClaimSchema.$inferSelect;
  const migrationFolder = path.join(process.cwd(), 'migrations');
  const priorFolder = mkdtempSync(path.join(tmpdir(), 'luster-core-terms-'));

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(path.join(migrationFolder, 'meta/_journal.json'), 'utf8'));
    const latestIndex = journal.entries.findIndex((entry: { tag: string }) => entry.tag === '0098_permanent_free_core_terms');

    expect(latestIndex).toBeGreaterThan(0);

    journal.entries = journal.entries.slice(0, latestIndex);
    mkdirSync(path.join(priorFolder, 'meta'));
    writeFileSync(path.join(priorFolder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) {
      copyFileSync(path.join(migrationFolder, `${entry.tag}.sql`), path.join(priorFolder, `${entry.tag}.sql`));
    }
    await migrate(database, { migrationsFolder: priorFolder });
    await database.insert(schema.salonSchema).values({ id: 'legacy-terms-salon', name: 'Historical fixture', slug: 'legacy-terms-salon' });
    const [claim] = await database.insert(schema.foundingLifetimeClaimSchema).values({
      id: 'legacy-terms-claim',
      salonId: 'legacy-terms-salon',
      sourceSiteId: 'historical-site',
      offerKey: 'founding_lifetime_2026',
      termsVersion: 1,
      terms: {
        coreSoftwareMonthlyPriceCents: 0,
        coreSoftwareAccess: 'lifetime',
        emails: 'unlimited',
        starterTextCredits: 100,
        starterTextCreditsFrequency: 'once_per_verified_business',
        additionalTexts: 'paid_separately',
        aiReceptionist: 'paid_separately',
        phoneUsage: 'paid_separately',
        otherUsageServices: 'paid_separately',
        claimDeadline: '2027-01-02T05:00:00.000Z',
        deadlineTimeZone: 'America/Toronto',
      },
    }).returning();
    historical = claim!;
    await migrate(database, { migrationsFolder: migrationFolder });
  }, 60_000);

  afterAll(async () => {
    await client.close();
    rmSync(priorFolder, { recursive: true, force: true });
  });

  it('leaves every field of a pre-migration lifetime claim unchanged', async () => {
    const [claim] = await database.select().from(schema.foundingLifetimeClaimSchema)
      .where(eq(schema.foundingLifetimeClaimSchema.id, historical.id));

    expect(claim).toEqual(historical);
  });

  it('accepts new v2 terms and remains compatible with the previous app writing v1', async () => {
    for (const version of [1, 2]) {
      const id = `compatible-v${version}`;
      await database.insert(schema.salonSchema).values({ id, name: id, slug: id });

      await expect(database.insert(schema.foundingLifetimeClaimSchema).values({
        ...historical,
        id,
        salonId: id,
        termsVersion: version,
        terms: version === 1 ? historical.terms : FOUNDING_LIFETIME_TERMS,
      })).resolves.toBeDefined();
    }
  });

  it.each([
    { purchasedTextCreditsExpire: true },
    { purchasedTextCreditsExpire: 'false' },
    { purchasedTextCreditsExpire: undefined },
    { claimDeadline: '2027-01-02T05:00:00.000Z' },
    { claimDeadline: undefined },
    { coreSoftwareMonthlyPriceCents: 4999 },
  ])('rejects incompatible v2 terms %j', async (invalid) => {
    await expect(client.query(
      'UPDATE founding_lifetime_claim SET terms_version = 2, terms = $1::jsonb WHERE id = $2',
      [JSON.stringify({ ...FOUNDING_LIFETIME_TERMS, ...invalid }), historical.id],
    )).rejects.toMatchObject({ constraint: 'founding_lifetime_claim_core_terms_valid' });
  });

  it('rejects unknown versions and offer identifiers', async () => {
    await expect(client.query('UPDATE founding_lifetime_claim SET terms_version = 3 WHERE id = $1', [historical.id]))
      .rejects.toThrow();
    await expect(client.query('UPDATE founding_lifetime_claim SET offer_key = $1 WHERE id = $2', ['unknown-offer', historical.id]))
      .rejects.toMatchObject({ constraint: 'founding_lifetime_claim_offer_valid' });
  });
});

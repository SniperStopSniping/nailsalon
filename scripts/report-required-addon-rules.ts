import 'dotenv/config';

/* eslint-disable no-console -- This command is an operations report. */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import * as schema from '../src/models/Schema';

/**
 * Read-only inventory of live `service_add_on` rows with
 * `selectionMode = 'required'`, grouped per salon.
 *
 * This is PR 1 stage (a) of the required-add-on enforcement rollout: it
 * measures how many salons/services would be affected by hard enforcement
 * before stage (e) turns evaluateRequiredAddOnRules into a blocking check.
 * It never writes.
 *
 * Usage:
 *   npm run db:report:required-addon-rules
 *   npm run db:report:required-addon-rules -- --salon-slug <slug>
 */

const salonSlugFlagIndex = process.argv.indexOf('--salon-slug');
const requestedSalonSlug = salonSlugFlagIndex >= 0 ? process.argv[salonSlugFlagIndex + 1] : undefined;

async function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    return { db: drizzlePg(client, { schema }), client };
  }

  const client = new PGlite();
  await client.waitReady;
  const db = drizzlePglite(client, { schema }) as PgliteDatabase<typeof schema>;
  await migratePglite(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  return { db, client: null };
}

async function main() {
  const { db, client } = await getDatabase();
  try {
    const salons = await db
      .select({ id: schema.salonSchema.id, slug: schema.salonSchema.slug, name: schema.salonSchema.name })
      .from(schema.salonSchema)
      .where(requestedSalonSlug ? eq(schema.salonSchema.slug, requestedSalonSlug) : undefined);

    if (requestedSalonSlug && salons.length === 0) {
      throw new Error(`Salon not found: ${requestedSalonSlug}`);
    }

    const scopedSalonId = requestedSalonSlug ? salons[0]?.id : undefined;

    const requiredRules = await db
      .select({
        id: schema.serviceAddOnSchema.id,
        salonId: schema.serviceAddOnSchema.salonId,
        serviceId: schema.serviceAddOnSchema.serviceId,
        addOnId: schema.serviceAddOnSchema.addOnId,
        serviceName: schema.serviceSchema.name,
        serviceIsActive: schema.serviceSchema.isActive,
        addOnName: schema.addOnSchema.name,
        addOnIsActive: schema.addOnSchema.isActive,
      })
      .from(schema.serviceAddOnSchema)
      .innerJoin(schema.serviceSchema, eq(schema.serviceSchema.id, schema.serviceAddOnSchema.serviceId))
      .innerJoin(schema.addOnSchema, eq(schema.addOnSchema.id, schema.serviceAddOnSchema.addOnId))
      .where(and(
        eq(schema.serviceAddOnSchema.selectionMode, 'required'),
        scopedSalonId ? eq(schema.serviceAddOnSchema.salonId, scopedSalonId) : undefined,
      ));

    const salonById = new Map(salons.map(salon => [salon.id, salon]));

    // A required rule pointing at a deactivated add-on (or attached to a
    // deactivated service) makes the service permanently unbookable online
    // once hard enforcement (stage e) is enabled — surface this before that
    // PR, not after.
    const rulesWithInactiveAddOn = requiredRules.filter(rule => rule.addOnIsActive === false);
    const rulesWithInactiveService = requiredRules.filter(rule => rule.serviceIsActive === false);

    const bySalon = new Map<string, typeof requiredRules>();
    for (const rule of requiredRules) {
      const current = bySalon.get(rule.salonId) ?? [];
      current.push(rule);
      bySalon.set(rule.salonId, current);
    }

    console.log(JSON.stringify({
      mode: 'read-only',
      scope: requestedSalonSlug ? { salonSlug: requestedSalonSlug } : { allSalons: true },
      perSalon: [...bySalon.entries()].map(([salonId, rules]) => ({
        salonId,
        salonSlug: salonById.get(salonId)?.slug ?? null,
        salonName: salonById.get(salonId)?.name ?? null,
        requiredRuleCount: rules.length,
        rules: rules.map(rule => ({
          serviceId: rule.serviceId,
          serviceName: rule.serviceName,
          serviceIsActive: rule.serviceIsActive,
          addOnId: rule.addOnId,
          addOnName: rule.addOnName,
          addOnIsActive: rule.addOnIsActive,
        })),
      })),
      summary: {
        salonCount: bySalon.size,
        totalRequiredRules: requiredRules.length,
        rulesWithInactiveAddOnCount: rulesWithInactiveAddOn.length,
        rulesWithInactiveServiceCount: rulesWithInactiveService.length,
      },
    }, null, 2));
  } finally {
    await client?.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

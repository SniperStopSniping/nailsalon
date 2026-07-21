import 'dotenv/config';

/* eslint-disable no-console -- This command is an operations report. */
/**
 * Read-only audit of a salon's add-on catalog.
 *
 * Written while fixing the Add-ons tab (it reported "0 add-ons" for a salon
 * that had 33) to prove whether the data itself was ever at fault. It only
 * SELECTs — there is deliberately no --apply path — because prices and
 * durations on an add-on are the salon's own data, not something to normalise
 * back to the catalog defaults.
 *
 * Usage: tsx scripts/audit-salon-add-ons.ts --salon-slug <slug> [--salon-slug <slug>]
 */
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { getTemplateByKey } from '../src/libs/serviceTemplateCatalog';
import * as schema from '../src/models/Schema';

/** Bounds enforced by PATCH /api/salon/add-ons/[id]; a row outside them would 400 on save. */
const EDITOR_BOUNDS = { nameMaxLength: 120, durationMaxMinutes: 240, maxQuantityMax: 50 };

function requestedSlugs(): string[] {
  const slugs = process.argv.reduce<string[]>((found, arg, index) => {
    if (arg === '--salon-slug') {
      const value = process.argv[index + 1];
      if (value && !value.startsWith('--')) {
        found.push(value);
      }
    }
    return found;
  }, []);

  if (slugs.length === 0) {
    throw new Error('Usage: tsx scripts/audit-salon-add-ons.ts --salon-slug <slug>');
  }
  return slugs;
}

type AuditDb = Omit<ReturnType<typeof drizzlePg<typeof schema>>, '$client'>;

async function auditSalon(db: AuditDb, slug: string) {
  const [salon] = await db
    .select()
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.slug, slug));

  if (!salon) {
    console.log(`\n${slug}: NOT FOUND`);
    return;
  }

  const [addOns, services, rules] = await Promise.all([
    db.select().from(schema.addOnSchema).where(eq(schema.addOnSchema.salonId, salon.id)),
    db.select().from(schema.serviceSchema).where(eq(schema.serviceSchema.salonId, salon.id)),
    db.select().from(schema.serviceAddOnSchema).where(eq(schema.serviceAddOnSchema.salonId, salon.id)),
  ]);

  const addOnIds = new Set(addOns.map(addOn => addOn.id));
  const serviceIds = new Set(services.map(service => service.id));
  const linkedAddOnIds = new Set(rules.map(rule => rule.addOnId));

  const orderCounts = new Map<number | null, number>();
  for (const addOn of addOns) {
    orderCounts.set(addOn.displayOrder, (orderCounts.get(addOn.displayOrder) ?? 0) + 1);
  }
  const duplicateOrders = [...orderCounts.entries()].filter(([, count]) => count > 1);

  const unlinked = addOns.filter(addOn => !linkedAddOnIds.has(addOn.id));
  const orphanRules = rules.filter(
    rule => !addOnIds.has(rule.addOnId) || !serviceIds.has(rule.serviceId),
  );
  const unknownTemplates = addOns.filter(
    addOn => addOn.templateKey && !getTemplateByKey(addOn.templateKey),
  );
  const outOfBounds = addOns.filter(
    addOn => addOn.name.length > EDITOR_BOUNDS.nameMaxLength
      || addOn.durationMinutes > EDITOR_BOUNDS.durationMaxMinutes
      || (addOn.maxQuantity ?? 0) > EDITOR_BOUNDS.maxQuantityMax,
  );
  const missingRequired = addOns.filter(
    addOn => !addOn.name.trim() || !addOn.slug?.trim() || addOn.priceCents == null,
  );

  console.log(`\n=== ${slug} (${salon.id}) ===`);
  console.log(`services: ${services.length}  add-ons: ${addOns.length}  compatibility rows: ${rules.length}`);
  console.log(`  active add-ons:            ${addOns.filter(addOn => addOn.isActive).length}`);
  console.log(`  inactive add-ons:          ${addOns.filter(addOn => !addOn.isActive).length}`);
  console.log(`  templated add-ons:         ${addOns.filter(addOn => addOn.templateKey).length}`);
  console.log(`  malformed (name/slug/price): ${missingRequired.length}`);
  console.log(`  outside editor bounds:     ${outOfBounds.length}`);
  console.log(`  unknown template keys:     ${unknownTemplates.length}`);
  console.log(`  orphaned compatibility rows: ${orphanRules.length}`);
  console.log(`  add-ons offered with no service: ${unlinked.length}`);
  console.log(`  duplicated display_order values: ${duplicateOrders.length}`);

  for (const addOn of missingRequired) {
    console.log(`    MALFORMED ${addOn.id}`);
  }
  for (const addOn of outOfBounds) {
    console.log(`    OUT OF BOUNDS ${addOn.id} name=${addOn.name.length} duration=${addOn.durationMinutes} maxQuantity=${addOn.maxQuantity}`);
  }
  for (const addOn of unknownTemplates) {
    console.log(`    UNKNOWN TEMPLATE ${addOn.id} templateKey=${addOn.templateKey}`);
  }
  for (const rule of orphanRules) {
    console.log(`    ORPHAN RULE ${rule.id} service=${rule.serviceId} addOn=${rule.addOnId}`);
  }
  for (const addOn of unlinked) {
    console.log(`    NO SERVICE LINK ${addOn.id} (${addOn.name}) — invisible to clients`);
  }
  if (duplicateOrders.length > 0) {
    console.log(`    display_order collisions: ${duplicateOrders.map(([order, count]) => `${order}×${count}`).join(', ')}`);
    console.log('    (presentation only — the API breaks ties on createdAt, so ordering is stable)');
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required — this audit reads a real database.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const db = drizzlePg(client, { schema });

  try {
    for (const slug of requestedSlugs()) {
      await auditSalon(db, slug);
    }
    console.log('\nRead-only audit complete — nothing was written.');
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/* eslint-disable no-console -- CLI seeding script; console output is its UI */
import 'dotenv/config';

import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { deriveBookingCategory } from '../src/libs/bookingCategory';
import {
  adminUserSchema,
  salonSchema,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
} from '../src/models/Schema';
import { SALON, SERVICES, TECHNICIANS } from './fixtures/nail-salon-no5';

/**
 * The one salon this script is allowed to create from nothing. Any other
 * E2E_SALON_SLUG must already exist: DATABASE_URL points at a database shared
 * with production, so inventing a salon nobody defined is not a safe default.
 */
const PROVISIONABLE_SLUG = SALON.slug;

function formatPhoneE164(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  throw new Error(`Invalid phone number: ${phone}`);
}

type Db = ReturnType<typeof drizzle>;

/**
 * Recreate the demo salon, its menu and its technicians.
 *
 * Deliberately does NOT run migrations - unlike scripts/seed.ts, which migrates
 * DATABASE_URL on startup. This runs in CI against the shared database, where
 * applying migrations as a side effect of seeding would be a much bigger event
 * than seeding.
 */
async function provisionSalon(db: Db) {
  await db
    .insert(salonSchema)
    .values(SALON)
    .onConflictDoUpdate({
      target: salonSchema.id,
      set: { slug: SALON.slug, name: SALON.name, isActive: true, updatedAt: new Date() },
    });

  for (const service of SERVICES) {
    const bookingCategory = deriveBookingCategory(service.category);
    await db
      .insert(serviceSchema)
      .values({ ...service, bookingCategory })
      .onConflictDoUpdate({
        target: serviceSchema.id,
        set: {
          salonId: service.salonId,
          name: service.name,
          price: service.price,
          durationMinutes: service.durationMinutes,
          category: service.category,
          bookingCategory,
          isActive: true,
          updatedAt: new Date(),
        },
      });
  }

  for (const technician of TECHNICIANS) {
    await db
      .insert(technicianSchema)
      .values(technician)
      .onConflictDoUpdate({
        target: technicianSchema.id,
        set: {
          salonId: technician.salonId,
          name: technician.name,
          weeklySchedule: technician.weeklySchedule,
          isActive: true,
          updatedAt: new Date(),
        },
      });
  }

  // Every technician can perform every service. getPublicBookableServiceIds()
  // treats a salon with zero assignment rows as unrestricted, but one with rows
  // as an allow-list, so a partial set here would silently hide the menu.
  for (const technician of TECHNICIANS) {
    for (const service of SERVICES) {
      await db
        .insert(technicianServicesSchema)
        .values({ technicianId: technician.id!, serviceId: service.id!, enabled: true })
        .onConflictDoNothing();
    }
  }

  console.log(
    `Provisioned salon ${SALON.slug}: ${SERVICES.length} services, ${TECHNICIANS.length} technicians.`,
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for E2E fixture seeding.');
  }

  const salonSlug = process.env.E2E_SALON_SLUG || PROVISIONABLE_SLUG;
  const staffTechName = process.env.E2E_STAFF_TECH_NAME || 'Daniela';
  const staffPhone = process.env.E2E_STAFF_PHONE || '4165550201';
  const superAdminPhone = process.env.E2E_SUPER_ADMIN_PHONE || '4165550101';
  const superAdminName = process.env.E2E_SUPER_ADMIN_NAME || 'E2E Super Admin';
  const superAdminEmail = process.env.E2E_SUPER_ADMIN_EMAIL || 'e2e-super-admin@nailsalon.dev';

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const db = drizzle(client);

  try {
    const findSalon = async () =>
      (await db
        .select({ id: salonSchema.id, name: salonSchema.name, slug: salonSchema.slug })
        .from(salonSchema)
        .where(eq(salonSchema.slug, salonSlug))
        .limit(1))[0];

    let salon = await findSalon();

    if (!salon) {
      if (salonSlug !== PROVISIONABLE_SLUG) {
        throw new Error(
          `Salon ${salonSlug} was not found, and only ${PROVISIONABLE_SLUG} can be created automatically. `
          + `Create it first, or unset E2E_SALON_SLUG.`,
        );
      }

      // The suite used to fail here forever once the salon went missing: a
      // super-admin hard delete removed it and nothing in CI could put it back.
      console.log(`Salon ${salonSlug} is missing - recreating it.`);
      await provisionSalon(db);
      salon = await findSalon();

      if (!salon) {
        throw new Error(`Failed to provision salon ${salonSlug}.`);
      }
    }

    // The core e2e suite assumes the free-Luster profile (e2eConfig.freeSolo
    // defaults to true): the public footer and auto tech-skip only render for
    // free-solo salons, so make sure the fixture salon actually is one.
    // isActive and publicationStatus additionally decide whether the public
    // booking route resolves at all rather than redirecting to /not-found.
    await db
      .update(salonSchema)
      .set({
        freeSoloEnabled: true,
        publicationStatus: 'published',
        isActive: true,
        deletedAt: null,
        status: 'active',
      })
      .where(eq(salonSchema.id, salon.id));

    const [technician] = await db
      .select({
        id: technicianSchema.id,
        name: technicianSchema.name,
      })
      .from(technicianSchema)
      .where(
        and(
          eq(technicianSchema.salonId, salon.id),
          eq(technicianSchema.name, staffTechName),
        ),
      )
      .limit(1);

    if (!technician) {
      throw new Error(`Technician ${staffTechName} was not found in ${salonSlug}.`);
    }

    await db
      .update(technicianSchema)
      .set({
        phone: staffPhone,
        email: `${staffTechName.toLowerCase().replace(/\s+/g, '.')}@e2e.local`,
        updatedAt: new Date(),
      })
      .where(eq(technicianSchema.id, technician.id));

    // The suite signs in by phone, so the phone is the fixture's identity and
    // the name/email are incidental. An existing account therefore only needs
    // the super-admin bit: the previous upsert also forced name and email onto
    // it, which would have renamed a real administrator to "E2E Super Admin"
    // and taken their address had the unique email index not rejected it first.
    const superAdminPhoneE164 = formatPhoneE164(superAdminPhone);
    const [existingAdmin] = await db
      .select({ id: adminUserSchema.id, name: adminUserSchema.name })
      .from(adminUserSchema)
      .where(eq(adminUserSchema.phoneE164, superAdminPhoneE164))
      .limit(1);

    if (existingAdmin) {
      await db
        .update(adminUserSchema)
        .set({ isSuperAdmin: true, updatedAt: new Date() })
        .where(eq(adminUserSchema.id, existingAdmin.id));
      console.log(
        `Promoted existing admin "${existingAdmin.name ?? existingAdmin.id}" to super-admin for E2E.`,
      );
    } else {
      // email is uniquely indexed; leave it unset rather than steal it from
      // whichever account already holds the fixture address.
      const [emailOwner] = await db
        .select({ id: adminUserSchema.id })
        .from(adminUserSchema)
        .where(sql`lower(${adminUserSchema.email}) = lower(${superAdminEmail})`)
        .limit(1);

      await db
        .insert(adminUserSchema)
        .values({
          id: `admin_e2e_super_${superAdminPhone.replace(/\D/g, '')}`,
          phoneE164: superAdminPhoneE164,
          name: superAdminName,
          email: emailOwner ? null : superAdminEmail,
          isSuperAdmin: true,
        });
      console.log(`Created E2E super-admin fixture: ${superAdminName}.`);
    }

    console.log(`Seeded E2E staff fixture: ${technician.name} (${staffPhone})`);
    console.log(`Target salon: ${salon.name} (${salon.slug})`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Failed to seed E2E fixtures:', error);
  process.exit(1);
});

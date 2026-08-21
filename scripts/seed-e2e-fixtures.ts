/* eslint-disable no-console -- CLI seeding script; console output is its UI */
import { fileURLToPath } from 'node:url';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { deriveBookingCategory } from '../src/libs/bookingCategory';
import {
  attestDisposableDatabaseSession,
  DisposableDatabaseTargetError,
  requireDisposableDatabaseTarget,
  resolveDisposableDatabaseServerExpectation,
} from '../src/libs/disposableDatabaseTarget';
import {
  addOnSchema,
  adminUserSchema,
  salonLocationSchema,
  salonSchema,
  serviceAddOnSchema,
  serviceSchema,
  technicianSchema,
  technicianServicesSchema,
} from '../src/models/Schema';
import { SALON, SERVICES, TECHNICIANS } from './fixtures/nail-salon-no5';

const PROVISIONABLE_SLUG = SALON.slug;
const E2E_PRIMARY_LOCATION_ID = 'location_nail-salon-no5_primary';
const E2E_ACCESSIBLE_ADD_ON_ID = 'addon_e2e_nail-repair';
const E2E_ACCESSIBLE_ADD_ON_RULE_ID = 'service-addon_e2e_biab-short_nail-repair';
const E2E_ACCESSIBLE_ADD_ON_SERVICE_ID = 'svc_biab-short';
const E2E_STAFF_TECHNICIAN_ID = 'tech_daniela';
const E2E_STAFF_TECH_NAME = 'Daniela';
const E2E_STAFF_PHONE = '4165550201';
const DEFAULT_E2E_SUPER_ADMIN_PHONE = '4165550101';
const E2E_SUPER_ADMIN_NAME = 'Synthetic E2E Super Admin';
const SYNTHETIC_SUPER_ADMIN_PHONE = /^1?[2-9]\d{2}55501\d{2}$/;

const SYNTHETIC_SALON = {
  ...SALON,
  address: '100 Fixture Lane',
  city: 'Testville',
  deletedAt: null,
  email: 'salon-fixture@example.invalid',
  freeSoloEnabled: true,
  isActive: true,
  phone: '555-010-0000',
  publicationStatus: 'published',
  socialLinks: { instagram: 'luster-e2e-fixture' },
  status: 'active',
  zipCode: '00000',
};

type Db = ReturnType<typeof drizzle>;
type Environment = Record<string, string | undefined>;

function formatPhoneE164(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  throw new Error('Synthetic E2E fixture phone is invalid.');
}

function requireSyntheticFixtureInputs(environment: Environment) {
  const salonSlug = environment.E2E_SALON_SLUG || PROVISIONABLE_SLUG;
  if (salonSlug !== PROVISIONABLE_SLUG) {
    throw new Error('Only the canonical synthetic E2E salon may be seeded.');
  }

  const staffTechName = environment.E2E_STAFF_TECH_NAME || E2E_STAFF_TECH_NAME;
  const staffPhone = environment.E2E_STAFF_PHONE || E2E_STAFF_PHONE;
  if (staffTechName !== E2E_STAFF_TECH_NAME || staffPhone !== E2E_STAFF_PHONE) {
    throw new Error('Only the canonical synthetic E2E staff identity may be seeded.');
  }

  const superAdminPhone
    = environment.E2E_SUPER_ADMIN_PHONE || DEFAULT_E2E_SUPER_ADMIN_PHONE;
  const superAdminDigits = superAdminPhone.replace(/\D/g, '');
  if (!SYNTHETIC_SUPER_ADMIN_PHONE.test(superAdminDigits)) {
    throw new Error('The E2E super-admin phone must use the reserved synthetic range.');
  }

  return {
    staffPhone,
    superAdminPhone,
  };
}

/**
 * Upsert only the canonical synthetic salon, menu, and technicians.
 *
 * Running every upsert on every invocation repairs a partially completed first
 * seed and makes the command safe to repeat. The disposable target guard has
 * already prohibited hosted databases before this function can mutate data.
 */
async function provisionSalon(db: Db) {
  await db
    .insert(salonSchema)
    .values(SYNTHETIC_SALON)
    .onConflictDoUpdate({
      target: salonSchema.id,
      set: {
        address: SYNTHETIC_SALON.address,
        businessHours: SYNTHETIC_SALON.businessHours,
        city: SYNTHETIC_SALON.city,
        deletedAt: null,
        email: SYNTHETIC_SALON.email,
        freeSoloEnabled: true,
        isActive: true,
        name: SYNTHETIC_SALON.name,
        phone: SYNTHETIC_SALON.phone,
        policies: SYNTHETIC_SALON.policies,
        publicationStatus: 'published',
        slug: SYNTHETIC_SALON.slug,
        socialLinks: SYNTHETIC_SALON.socialLinks,
        state: SYNTHETIC_SALON.state,
        status: 'active',
        themeKey: SYNTHETIC_SALON.themeKey,
        updatedAt: new Date(),
        zipCode: SYNTHETIC_SALON.zipCode,
      },
    });

  for (const service of SERVICES) {
    const bookingCategory = deriveBookingCategory(service.category);
    await db
      .insert(serviceSchema)
      .values({ ...service, bookingCategory })
      .onConflictDoUpdate({
        target: serviceSchema.id,
        set: {
          bookingCategory,
          category: service.category,
          description: service.description,
          durationMinutes: service.durationMinutes,
          imageUrl: service.imageUrl,
          isActive: true,
          name: service.name,
          price: service.price,
          salonId: service.salonId,
          sortOrder: service.sortOrder,
          updatedAt: new Date(),
        },
      });
  }

  await db
    .insert(addOnSchema)
    .values({
      id: E2E_ACCESSIBLE_ADD_ON_ID,
      salonId: SALON.id!,
      name: 'Nail Repair',
      slug: 'e2e-nail-repair',
      category: 'repair',
      templateKey: null,
      descriptionItems: ['Per nail'],
      priceCents: 500,
      priceDisplayText: null,
      durationMinutes: 10,
      pricingType: 'per_unit',
      unitLabel: 'nail',
      maxQuantity: 2,
      isActive: true,
      displayOrder: 999,
    })
    .onConflictDoUpdate({
      target: addOnSchema.id,
      set: {
        category: 'repair',
        descriptionItems: ['Per nail'],
        displayOrder: 999,
        durationMinutes: 10,
        isActive: true,
        maxQuantity: 2,
        name: 'Nail Repair',
        priceCents: 500,
        priceDisplayText: null,
        pricingType: 'per_unit',
        salonId: SALON.id!,
        slug: 'e2e-nail-repair',
        templateKey: null,
        unitLabel: 'nail',
        updatedAt: new Date(),
      },
    });

  await db
    .insert(serviceAddOnSchema)
    .values({
      id: E2E_ACCESSIBLE_ADD_ON_RULE_ID,
      salonId: SALON.id!,
      serviceId: E2E_ACCESSIBLE_ADD_ON_SERVICE_ID,
      addOnId: E2E_ACCESSIBLE_ADD_ON_ID,
      selectionMode: 'optional',
      conditions: null,
      defaultQuantity: null,
      maxQuantityOverride: 2,
      displayOrder: 999,
    })
    .onConflictDoUpdate({
      target: serviceAddOnSchema.id,
      set: {
        addOnId: E2E_ACCESSIBLE_ADD_ON_ID,
        conditions: null,
        defaultQuantity: null,
        displayOrder: 999,
        maxQuantityOverride: 2,
        salonId: SALON.id!,
        selectionMode: 'optional',
        serviceId: E2E_ACCESSIBLE_ADD_ON_SERVICE_ID,
        updatedAt: new Date(),
      },
    });

  for (const technician of TECHNICIANS) {
    await db
      .insert(technicianSchema)
      .values(technician)
      .onConflictDoUpdate({
        target: technicianSchema.id,
        set: {
          avatarUrl: technician.avatarUrl,
          bio: technician.bio,
          endTime: technician.endTime,
          isActive: true,
          name: technician.name,
          rating: technician.rating,
          reviewCount: technician.reviewCount,
          salonId: technician.salonId,
          specialties: technician.specialties,
          startTime: technician.startTime,
          updatedAt: new Date(),
          weeklySchedule: technician.weeklySchedule,
          workDays: technician.workDays,
        },
      });
  }

  // A partial allow-list would silently hide services from public booking.
  for (const technician of TECHNICIANS) {
    for (const service of SERVICES) {
      await db
        .insert(technicianServicesSchema)
        .values({
          enabled: true,
          serviceId: service.id!,
          technicianId: technician.id!,
        })
        .onConflictDoUpdate({
          target: [
            technicianServicesSchema.technicianId,
            technicianServicesSchema.serviceId,
          ],
          set: { enabled: true },
        });
    }
  }
}

async function provisionLocation(db: Db) {
  await db
    .update(salonLocationSchema)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(eq(salonLocationSchema.salonId, SALON.id!));

  await db
    .insert(salonLocationSchema)
    .values({
      address: SYNTHETIC_SALON.address,
      businessHours: SYNTHETIC_SALON.businessHours,
      city: SYNTHETIC_SALON.city,
      id: E2E_PRIMARY_LOCATION_ID,
      isActive: true,
      isPrimary: true,
      name: 'Synthetic primary location',
      phone: SYNTHETIC_SALON.phone,
      salonId: SALON.id!,
      state: SYNTHETIC_SALON.state,
      zipCode: SYNTHETIC_SALON.zipCode,
    })
    .onConflictDoUpdate({
      target: salonLocationSchema.id,
      set: {
        address: SYNTHETIC_SALON.address,
        businessHours: SYNTHETIC_SALON.businessHours,
        city: SYNTHETIC_SALON.city,
        isActive: true,
        isPrimary: true,
        name: 'Synthetic primary location',
        phone: SYNTHETIC_SALON.phone,
        salonId: SALON.id!,
        state: SYNTHETIC_SALON.state,
        updatedAt: new Date(),
        zipCode: SYNTHETIC_SALON.zipCode,
      },
    });
}

async function provisionStaff(
  db: Db,
  staffPhone: string,
) {
  const [technician] = await db
    .select({ id: technicianSchema.id })
    .from(technicianSchema)
    .where(eq(technicianSchema.id, E2E_STAFF_TECHNICIAN_ID))
    .limit(1);

  if (!technician) {
    throw new Error('Synthetic E2E staff fixture could not be provisioned.');
  }

  await db
    .update(technicianSchema)
    .set({
      email: 'daniela-fixture@example.invalid',
      phone: staffPhone,
      updatedAt: new Date(),
    })
    .where(eq(technicianSchema.id, technician.id));
}

async function provisionSuperAdmin(db: Db, superAdminPhone: string) {
  const superAdminPhoneE164 = formatPhoneE164(superAdminPhone);
  const phoneDigits = superAdminPhone.replace(/\D/g, '');

  await db
    .insert(adminUserSchema)
    .values({
      email: `e2e-super-admin-${phoneDigits}@example.invalid`,
      id: `admin_e2e_super_${phoneDigits}`,
      isSuperAdmin: true,
      name: E2E_SUPER_ADMIN_NAME,
      phoneE164: superAdminPhoneE164,
    })
    .onConflictDoUpdate({
      target: adminUserSchema.phoneE164,
      set: {
        email: `e2e-super-admin-${phoneDigits}@example.invalid`,
        isSuperAdmin: true,
        name: E2E_SUPER_ADMIN_NAME,
        updatedAt: new Date(),
      },
    });
}

async function verifyFixtureReadiness(
  db: Db,
  superAdminPhone: string,
) {
  const [salon] = await db
    .select({
      freeSoloEnabled: salonSchema.freeSoloEnabled,
      isActive: salonSchema.isActive,
      publicationStatus: salonSchema.publicationStatus,
    })
    .from(salonSchema)
    .where(
      and(
        eq(salonSchema.id, SALON.id!),
        eq(salonSchema.slug, PROVISIONABLE_SLUG),
      ),
    )
    .limit(1);

  const serviceIds = SERVICES.map(service => service.id!);
  const technicianIds = TECHNICIANS.map(technician => technician.id!);
  const [serviceCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(serviceSchema)
    .where(
      and(
        eq(serviceSchema.salonId, SALON.id!),
        eq(serviceSchema.isActive, true),
        inArray(serviceSchema.id, serviceIds),
      ),
    );
  const [assignmentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(technicianServicesSchema)
    .where(
      and(
        eq(technicianServicesSchema.enabled, true),
        inArray(technicianServicesSchema.technicianId, technicianIds),
        inArray(technicianServicesSchema.serviceId, serviceIds),
      ),
    );
  const [accessibleAddOn] = await db
    .select({ id: addOnSchema.id })
    .from(addOnSchema)
    .where(
      and(
        eq(addOnSchema.id, E2E_ACCESSIBLE_ADD_ON_ID),
        eq(addOnSchema.salonId, SALON.id!),
        eq(addOnSchema.isActive, true),
      ),
    )
    .limit(1);
  const [accessibleAddOnRule] = await db
    .select({ id: serviceAddOnSchema.id })
    .from(serviceAddOnSchema)
    .where(
      and(
        eq(serviceAddOnSchema.id, E2E_ACCESSIBLE_ADD_ON_RULE_ID),
        eq(serviceAddOnSchema.salonId, SALON.id!),
        eq(serviceAddOnSchema.serviceId, E2E_ACCESSIBLE_ADD_ON_SERVICE_ID),
        eq(serviceAddOnSchema.addOnId, E2E_ACCESSIBLE_ADD_ON_ID),
        eq(serviceAddOnSchema.selectionMode, 'optional'),
      ),
    )
    .limit(1);
  const [staff] = await db
    .select({ email: technicianSchema.email, phone: technicianSchema.phone })
    .from(technicianSchema)
    .where(
      and(
        eq(technicianSchema.id, E2E_STAFF_TECHNICIAN_ID),
        eq(technicianSchema.salonId, SALON.id!),
        eq(technicianSchema.name, E2E_STAFF_TECH_NAME),
        eq(technicianSchema.isActive, true),
      ),
    )
    .limit(1);
  const [location] = await db
    .select({ id: salonLocationSchema.id })
    .from(salonLocationSchema)
    .where(
      and(
        eq(salonLocationSchema.id, E2E_PRIMARY_LOCATION_ID),
        eq(salonLocationSchema.salonId, SALON.id!),
        eq(salonLocationSchema.isPrimary, true),
        eq(salonLocationSchema.isActive, true),
      ),
    )
    .limit(1);
  const [superAdmin] = await db
    .select({ id: adminUserSchema.id })
    .from(adminUserSchema)
    .where(
      and(
        eq(adminUserSchema.phoneE164, formatPhoneE164(superAdminPhone)),
        eq(adminUserSchema.isSuperAdmin, true),
      ),
    )
    .limit(1);

  const ready = salon?.freeSoloEnabled === true
    && salon.isActive === true
    && salon.publicationStatus === 'published'
    && serviceCount?.count === SERVICES.length
    && assignmentCount?.count === SERVICES.length * TECHNICIANS.length
    && Boolean(accessibleAddOn)
    && Boolean(accessibleAddOnRule)
    && staff?.phone === E2E_STAFF_PHONE
    && staff.email === 'daniela-fixture@example.invalid'
    && Boolean(location)
    && Boolean(superAdmin);

  if (!ready) {
    throw new Error('Synthetic E2E fixture readiness verification failed.');
  }
}

function safeSeedError(error: unknown): Error {
  if (error instanceof DisposableDatabaseTargetError) {
    return error;
  }
  return new Error(
    'Synthetic E2E fixture seeding failed on the approved disposable database.',
  );
}

/**
 * Validate statically, attest the connected session, and only then mutate the
 * canonical synthetic fixture scope. There is no force or skip path.
 */
export async function seedE2EFixtures(
  environment: Environment = process.env,
): Promise<void> {
  const target = requireDisposableDatabaseTarget(environment);
  const expectedServer = resolveDisposableDatabaseServerExpectation(target);
  const fixtureInputs = requireSyntheticFixtureInputs(environment);
  const client = new Client({ connectionString: target.connectionString });
  let connected = false;

  try {
    await client.connect();
    connected = true;
    await attestDisposableDatabaseSession(client, target, expectedServer);

    const db = drizzle(client);
    await provisionSalon(db);
    await provisionLocation(db);
    await provisionStaff(
      db,
      fixtureInputs.staffPhone,
    );
    await provisionSuperAdmin(db, fixtureInputs.superAdminPhone);
    await verifyFixtureReadiness(db, fixtureInputs.superAdminPhone);
    console.log('Synthetic E2E fixtures are ready on the attested disposable database.');
  } catch (error) {
    throw safeSeedError(error);
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

const entryPath = process.argv[1];
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  seedE2EFixtures().catch((error) => {
    const message = error instanceof Error
      ? error.message
      : 'Synthetic E2E fixture seeding failed safely.';
    console.error(message);
    process.exitCode = 1;
  });
}

/* eslint-disable no-console */
/**
 * Database Seed Script
 *
 * Creates initial data for Nail Salon No.5:
 * - 1 Salon
 * - 8 Services (hands, feet, combo categories)
 * - 3 Technicians
 * - Technician-Service associations
 *
 * Run with: npm run db:seed:development
 */

import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { deriveBookingCategory } from '../src/libs/bookingCategory';
import { resolveRuntimeEnvironment } from '../src/libs/environmentIsolation';
import {
  NonProductionDatabaseGuardError,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
} from '../src/libs/nonProductionDatabaseGuard';
import * as schema from '../src/models/Schema';
import { SALON, SERVICES, TECHNICIANS } from './fixtures/nail-salon-no5';

// =============================================================================
// DATABASE CONNECTION
// =============================================================================

class DevelopmentSeedCommandError extends Error {}

async function getDatabase() {
  const { connectionString } = requireNonProductionDatabaseTarget();
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch {
    throw new DevelopmentSeedCommandError(
      'Could not connect to the approved Development PostgreSQL target.',
    );
  }

  try {
    await requireExactNonProductionDatabaseEnvironment(client, 'development');
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }

  return { db: drizzlePg(client, { schema }), client };
}

// =============================================================================
// SEED DATA
// =============================================================================

// Shared with scripts/seed-e2e-fixtures.ts so the E2E target salon and the
// seeded demo salon can never drift apart.

// =============================================================================
// SEED FUNCTION
// =============================================================================

async function seed() {
  if (process.argv.length !== 2) {
    throw new DevelopmentSeedCommandError(
      'Development seed rejected: arguments are not accepted.',
    );
  }
  if (resolveRuntimeEnvironment(process.env) !== 'development') {
    throw new DevelopmentSeedCommandError(
      'Development seed rejected: the application environment is not Development.',
    );
  }

  console.log('🌱 Starting database seed...\n');

  const { db, client } = await getDatabase();

  try {
    // 1. Insert a deterministic synthetic Development super-admin. This is the
    // FK-safe identity used by the local role switcher; no direct SQL is needed.
    const devSuperAdminId
      = process.env.DEV_SUPER_ADMIN_ID?.trim() || 'dev-super-admin';
    await db
      .insert(schema.adminUserSchema)
      .values({
        id: devSuperAdminId,
        phoneE164: '+15555550001',
        name: 'Development Super Admin',
        email: 'dev-super@example.invalid',
        isSuperAdmin: true,
      })
      .onConflictDoUpdate({
        target: schema.adminUserSchema.id,
        set: {
          phoneE164: '+15555550001',
          name: 'Development Super Admin',
          email: 'dev-super@example.invalid',
          isSuperAdmin: true,
          updatedAt: new Date(),
        },
      });

    // 2. Insert Salon
    console.log('📍 Creating salon...');
    await db
      .insert(schema.salonSchema)
      .values(SALON)
      .onConflictDoUpdate({
        target: schema.salonSchema.id,
        set: {
          name: SALON.name,
          slug: SALON.slug,
          themeKey: SALON.themeKey,
          phone: SALON.phone,
          email: SALON.email,
          address: SALON.address,
          city: SALON.city,
          state: SALON.state,
          zipCode: SALON.zipCode,
          businessHours: SALON.businessHours,
          policies: SALON.policies,
          socialLinks: SALON.socialLinks,
          isActive: SALON.isActive,
          updatedAt: new Date(),
        },
      });
    console.log(`   ✓ Salon "${SALON.name}" created/updated`);

    // 3. Insert Services
    console.log('\n💅 Creating services...');
    for (const service of SERVICES) {
      await db
        .insert(schema.serviceSchema)
        .values({ ...service, bookingCategory: deriveBookingCategory(service.category) })
        .onConflictDoUpdate({
          target: schema.serviceSchema.id,
          set: {
            name: service.name,
            description: service.description,
            price: service.price,
            durationMinutes: service.durationMinutes,
            category: service.category,
            bookingCategory: deriveBookingCategory(service.category),
            imageUrl: service.imageUrl,
            sortOrder: service.sortOrder,
            isActive: service.isActive,
            updatedAt: new Date(),
          },
        });
      console.log(`   ✓ Service "${service.name}" ($${(service.price! / 100).toFixed(0)}, ${service.durationMinutes}min)`);
    }

    // 4. Insert Technicians
    console.log('\n👩‍🎨 Creating technicians...');
    for (const tech of TECHNICIANS) {
      await db
        .insert(schema.technicianSchema)
        .values(tech)
        .onConflictDoUpdate({
          target: schema.technicianSchema.id,
          set: {
            name: tech.name,
            bio: tech.bio,
            avatarUrl: tech.avatarUrl,
            specialties: tech.specialties,
            rating: tech.rating,
            reviewCount: tech.reviewCount,
            weeklySchedule: tech.weeklySchedule,
            workDays: tech.workDays,
            startTime: tech.startTime,
            endTime: tech.endTime,
            isActive: tech.isActive,
            updatedAt: new Date(),
          },
        });
      console.log(`   ✓ Technician "${tech.name}" (${tech.specialties?.join(', ')})`);
    }

    // 5. Link Technicians to Services
    console.log('\n🔗 Creating technician-service associations...');
    const techServiceLinks: schema.NewTechnicianService[] = [];

    for (const tech of TECHNICIANS) {
      for (const service of SERVICES) {
        techServiceLinks.push({
          technicianId: tech.id!,
          serviceId: service.id!,
        });
      }
    }

    // Delete existing associations and recreate
    for (const tech of TECHNICIANS) {
      await db
        .delete(schema.technicianServicesSchema)
        .where(eq(schema.technicianServicesSchema.technicianId, tech.id!))
        .catch(() => {
          // Ignore if no rows to delete
        });
    }

    // Insert new associations
    for (const link of techServiceLinks) {
      await db
        .insert(schema.technicianServicesSchema)
        .values(link)
        .onConflictDoNothing();
    }
    console.log(`   ✓ Created ${techServiceLinks.length} technician-service links`);

    console.log('\n✅ Database seeded successfully!\n');
    console.log('Summary:');
    console.log(`   • 1 Salon: ${SALON.name}`);
    console.log(`   • ${SERVICES.length} Services`);
    console.log(`   • ${TECHNICIANS.length} Technicians`);
    console.log(`   • ${techServiceLinks.length} Technician-Service links`);
  } catch {
    throw new DevelopmentSeedCommandError(
      'Development fixture seed failed on the attested database.',
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

// Run seed
seed()
  .then(() => {
    console.log('\n🎉 Seed complete!');
  })
  .catch((error) => {
    const message = error instanceof NonProductionDatabaseGuardError
      || error instanceof DevelopmentSeedCommandError
      ? error.message
      : 'Development fixture seed failed safely.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });

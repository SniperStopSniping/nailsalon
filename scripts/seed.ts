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
 * Run with: npm run db:seed
 */

// Load environment variables from .env and .env.local
import 'dotenv/config';

import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import { deriveBookingCategory } from '../src/libs/bookingCategory';
import * as schema from '../src/models/Schema';
import { SALON, SERVICES, TECHNICIANS } from './fixtures/nail-salon-no5';

// =============================================================================
// DATABASE CONNECTION (mirrors src/libs/DB.ts logic)
// =============================================================================

function isLocalDatabase(databaseUrl: string): boolean {
  try {
    const { hostname } = new URL(databaseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    // An unparseable URL is not demonstrably local, so treat it as remote.
    return false;
  }
}

async function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // Production/real database
    console.log('🔌 Connecting to PostgreSQL database...');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const db = drizzlePg(client, { schema });

    // Seeding used to migrate first, unconditionally. dev and production share
    // one database here, so "seed the demo salon" quietly meant "apply every
    // pending migration to live data" - including 0059's ~21 foreign key
    // rewrites. Migrating is a deliberate act: `npm run db:migrate`.
    if (isLocalDatabase(databaseUrl)) {
      await migratePg(db, {
        migrationsFolder: path.join(process.cwd(), 'migrations'),
      });
    } else {
      console.log(
        '⏭️  Remote database detected - skipping migrations.\n'
        + '   Run `npm run db:migrate` explicitly if the schema is behind.',
      );
    }

    return { db, client };
  } else {
    // Development: PGlite in-memory
    console.log('🔌 Using PGlite in-memory database...');
    const client = new PGlite();
    await client.waitReady;

    const db = drizzlePglite(client, { schema }) as PgliteDatabase<typeof schema>;
    await migratePglite(db, {
      migrationsFolder: path.join(process.cwd(), 'migrations'),
    });

    return { db, client: null };
  }
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
  console.log('🌱 Starting database seed...\n');

  const { db, client } = await getDatabase();

  try {
    // 1. Insert Salon
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

    // 2. Insert Services
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

    // 3. Insert Technicians
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

    // 4. Link Technicians to Services
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
  } catch (error) {
    console.error('\n❌ Seed failed:', error);
    throw error;
  } finally {
    // Close connection if using real PostgreSQL
    if (client) {
      await client.end();
    }
  }
}

// Run seed
seed()
  .then(() => {
    console.log('\n🎉 Seed complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

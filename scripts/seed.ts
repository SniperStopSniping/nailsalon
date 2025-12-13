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

import * as schema from '../src/models/Schema';

// =============================================================================
// DATABASE CONNECTION (mirrors src/libs/DB.ts logic)
// =============================================================================

async function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // Production/real database
    console.log('🔌 Connecting to PostgreSQL database...');
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    const db = drizzlePg(client, { schema });
    await migratePg(db, {
      migrationsFolder: path.join(process.cwd(), 'migrations'),
    });

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

const SALON_ID = 'salon_nail-salon-no5';

const SALON: schema.NewSalon = {
  id: SALON_ID,
  name: 'Nail Salon No.5',
  slug: 'nail-salon-no5',
  themeKey: 'nail-salon-no5',
  phone: '555-123-4567',
  email: 'hello@nailsalonno5.com',
  address: '123 Beauty Lane',
  city: 'Los Angeles',
  state: 'CA',
  zipCode: '90001',
  businessHours: {
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '10:00', close: '17:00' },
    sunday: null,
  },
  policies: {
    cancellationHours: 24,
    noShowFee: 25,
    depositRequired: false,
    depositAmount: 0,
  },
  socialLinks: {
    instagram: 'nailsalonno5',
  },
  isActive: true,
};

// Services - prices in cents
const SERVICES: schema.NewService[] = [
  {
    id: 'svc_biab-short',
    salonId: SALON_ID,
    name: 'BIAB Short',
    description: 'Builder In A Bottle for short natural nails. Long-lasting gel overlay.',
    price: 6500, // $65
    durationMinutes: 75,
    category: 'hands',
    imageUrl: '/assets/images/biab-short.webp',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'svc_biab-medium',
    salonId: SALON_ID,
    name: 'BIAB Medium',
    description: 'Builder In A Bottle for medium length nails with shape customization.',
    price: 7500, // $75
    durationMinutes: 90,
    category: 'hands',
    imageUrl: '/assets/images/biab-medium.webp',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 'svc_gelx-extensions',
    salonId: SALON_ID,
    name: 'Gel-X Extensions',
    description: 'Full set of soft gel nail extensions with custom shape and length.',
    price: 9000, // $90
    durationMinutes: 105,
    category: 'hands',
    imageUrl: '/assets/images/gel-x-extensions.jpg',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: 'svc_biab-french',
    salonId: SALON_ID,
    name: 'BIAB French',
    description: 'Classic French tip design with BIAB overlay for a timeless look.',
    price: 7500, // $75
    durationMinutes: 90,
    category: 'hands',
    imageUrl: '/assets/images/biab-french.jpg',
    sortOrder: 4,
    isActive: true,
  },
  {
    id: 'svc_spa-pedi',
    salonId: SALON_ID,
    name: 'SPA Pedicure',
    description: 'Relaxing spa pedicure with exfoliation, massage, and regular polish.',
    price: 6000, // $60
    durationMinutes: 60,
    category: 'feet',
    imageUrl: '/assets/images/biab-short.webp',
    sortOrder: 5,
    isActive: true,
  },
  {
    id: 'svc_gel-pedi',
    salonId: SALON_ID,
    name: 'Gel Pedicure',
    description: 'Full spa pedicure with long-lasting gel polish application.',
    price: 7000, // $70
    durationMinutes: 75,
    category: 'feet',
    imageUrl: '/assets/images/biab-medium.webp',
    sortOrder: 6,
    isActive: true,
  },
  {
    id: 'svc_biab-gelx-combo',
    salonId: SALON_ID,
    name: 'BIAB + Gel-X Combo',
    description: 'BIAB overlay on natural nails plus Gel-X extensions for extra length.',
    price: 13000, // $130
    durationMinutes: 150,
    category: 'combo',
    imageUrl: '/assets/images/gel-x-extensions.jpg',
    sortOrder: 7,
    isActive: true,
  },
  {
    id: 'svc_mani-pedi',
    salonId: SALON_ID,
    name: 'Classic Mani + Pedi',
    description: 'Complete hand and foot treatment with polish of your choice.',
    price: 9500, // $95
    durationMinutes: 120,
    category: 'combo',
    imageUrl: '/assets/images/biab-french.jpg',
    sortOrder: 8,
    isActive: true,
  },
];

// Technicians with weekly schedules
const TECHNICIANS: schema.NewTechnician[] = [
  {
    id: 'tech_daniela',
    salonId: SALON_ID,
    name: 'Daniela',
    bio: '5 years of experience specializing in BIAB and Gel-X extensions. Known for intricate nail art designs.',
    avatarUrl: '/assets/images/tech-daniela.jpeg',
    specialties: ['BIAB', 'Gel-X', 'French'],
    rating: '4.8',
    reviewCount: 127,
    weeklySchedule: {
      sunday: null, // Day off
      monday: { start: '09:00', end: '18:00' },
      tuesday: { start: '09:00', end: '18:00' },
      wednesday: { start: '09:00', end: '18:00' },
      thursday: { start: '09:00', end: '18:00' },
      friday: { start: '09:00', end: '18:00' },
      saturday: null, // Day off
    },
    // Legacy fields
    workDays: [1, 2, 3, 4, 5], // Mon-Fri
    startTime: '09:00',
    endTime: '18:00',
    isActive: true,
  },
  {
    id: 'tech_tiffany',
    salonId: SALON_ID,
    name: 'Tiffany',
    bio: '3 years of experience with a focus on natural nail health and gel manicures.',
    avatarUrl: '/assets/images/tech-tiffany.jpeg',
    specialties: ['BIAB', 'Gel Manicure'],
    rating: '4.9',
    reviewCount: 203,
    weeklySchedule: {
      sunday: null, // Day off
      monday: { start: '10:00', end: '19:00' },
      tuesday: { start: '10:00', end: '19:00' },
      wednesday: { start: '10:00', end: '19:00' },
      thursday: { start: '10:00', end: '19:00' },
      friday: { start: '10:00', end: '19:00' },
      saturday: { start: '10:00', end: '17:00' },
    },
    // Legacy fields
    workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
    startTime: '10:00',
    endTime: '19:00',
    isActive: true,
  },
  {
    id: 'tech_jenny',
    salonId: SALON_ID,
    name: 'Jenny',
    bio: '4 years of experience specializing in Gel-X extensions and luxury pedicures.',
    avatarUrl: '/assets/images/tech-jenny.jpeg',
    specialties: ['Gel-X', 'Pedicure'],
    rating: '4.7',
    reviewCount: 89,
    weeklySchedule: {
      sunday: null, // Day off
      monday: null, // Day off
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: { start: '10:00', end: '16:00' },
    },
    // Legacy fields
    workDays: [2, 3, 4, 5, 6], // Tue-Sat
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  },
];

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
        .values(service)
        .onConflictDoUpdate({
          target: schema.serviceSchema.id,
          set: {
            name: service.name,
            description: service.description,
            price: service.price,
            durationMinutes: service.durationMinutes,
            category: service.category,
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

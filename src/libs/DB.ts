import 'server-only';

import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { Client } from 'pg';

import * as schema from '@/models/Schema';

import { Env } from './Env';

let client;
let drizzle;

// Initialize business configuration for PGlite in-memory database ONLY
// This sets up the salon, services, and technicians (required for the app to work)
// Note: NO appointments are created - all appointments come from real user bookings
async function initializeBusinessData(db: PgliteDatabase<typeof schema>) {
  // Check if salon already exists
  const existingSalon = await db
    .select()
    .from(schema.salonSchema)
    .where(eq(schema.salonSchema.slug, 'nail-salon-no5'))
    .limit(1);

  if (existingSalon.length > 0) {
    return; // Already initialized
  }

  // Create salon
  const [salon] = await db
    .insert(schema.salonSchema)
    .values({
      id: 'salon_nail-salon-no5',
      name: 'Nail Salon No.5',
      slug: 'nail-salon-no5',
      themeKey: 'nail-salon-no5',
    })
    .returning();

  if (!salon) return;

  // Create services
  const services = [
    { id: 'srv_biab-short', name: 'BIAB Short', price: 6500, durationMinutes: 75, category: 'hands', imageUrl: '/assets/images/biab-short.webp', sortOrder: 1 },
    { id: 'srv_biab-medium', name: 'BIAB Medium', price: 7500, durationMinutes: 90, category: 'hands', imageUrl: '/assets/images/biab-medium.webp', sortOrder: 2 },
    { id: 'srv_gelx-extensions', name: 'Gel-X Extensions', price: 9000, durationMinutes: 105, category: 'hands', imageUrl: '/assets/images/gel-x-extensions.jpg', sortOrder: 3 },
    { id: 'srv_biab-french', name: 'BIAB French', price: 7500, durationMinutes: 90, category: 'hands', imageUrl: '/assets/images/biab-french.jpg', sortOrder: 4 },
    { id: 'srv_spa-pedi', name: 'SPA Pedicure', price: 6000, durationMinutes: 60, category: 'feet', imageUrl: '/assets/images/biab-short.webp', sortOrder: 5 },
    { id: 'srv_gel-pedi', name: 'Gel Pedicure', price: 7000, durationMinutes: 75, category: 'feet', imageUrl: '/assets/images/biab-short.webp', sortOrder: 6 },
    { id: 'srv_biab-gelx-combo', name: 'BIAB + Gel-X Combo', price: 13000, durationMinutes: 150, category: 'combo', imageUrl: '/assets/images/biab-short.webp', sortOrder: 7 },
    { id: 'srv_mani-pedi', name: 'Classic Mani + Pedi', price: 9500, durationMinutes: 120, category: 'combo', imageUrl: '/assets/images/biab-short.webp', sortOrder: 8 },
  ];

  for (const service of services) {
    await db.insert(schema.serviceSchema).values({
      ...service,
      salonId: salon.id,
    });
  }

  // Create technicians
  const technicians = [
    { id: 'tech_daniela', name: 'Daniela', avatarUrl: '/assets/images/tech-daniela.jpeg', specialties: ['BIAB', 'Gel-X', 'French'], rating: '4.9', reviewCount: 127 },
    { id: 'tech_tiffany', name: 'Tiffany', avatarUrl: '/assets/images/tech-tiffany.jpeg', specialties: ['BIAB', 'Gel Manicure'], rating: '4.8', reviewCount: 98 },
    { id: 'tech_jenny', name: 'Jenny', avatarUrl: '/assets/images/tech-jenny.jpeg', specialties: ['Gel-X', 'Pedicure'], rating: '4.7', reviewCount: 85 },
  ];

  for (const tech of technicians) {
    await db.insert(schema.technicianSchema).values({
      ...tech,
      salonId: salon.id,
    });
  }

  // Create technician-service links (all techs can do all services)
  for (const tech of technicians) {
    for (const service of services) {
      await db.insert(schema.technicianServicesSchema).values({
        technicianId: tech.id,
        serviceId: service.id,
      });
    }
  }

  // No console.log - silent initialization
}

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================
// Priority: ALWAYS use real Postgres when DATABASE_URL is set.
// Only fall back to PGlite in-memory when DATABASE_URL is completely absent.
// =============================================================================

if (Env.DATABASE_URL) {
  // Use real PostgreSQL database - data persists across restarts
  client = new Client({
    connectionString: Env.DATABASE_URL,
  });
  await client.connect();

  drizzle = drizzlePg(client, { schema });
  await migratePg(drizzle, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });
} else {
  // Fallback: PGlite in-memory database (data lost on restart)
  // Only used when no DATABASE_URL is configured at all
  console.warn('[DB] No DATABASE_URL found - using PGlite in-memory database. Data will not persist across restarts.');

  const global = globalThis as unknown as { client: PGlite; drizzle: PgliteDatabase<typeof schema>; seeded?: boolean };

  if (!global.client) {
    global.client = new PGlite();
    await global.client.waitReady;

    global.drizzle = drizzlePglite(global.client, { schema });
  }

  drizzle = global.drizzle;
  await migratePglite(global.drizzle, {
    migrationsFolder: path.join(process.cwd(), 'migrations'),
  });

  // Initialize business data (salon, services, technicians) for PGlite only
  // Note: This does NOT create any demo appointments - all appointments come from real bookings
  if (!global.seeded) {
    await initializeBusinessData(global.drizzle);
    global.seeded = true;
  }
}

export const db = drizzle;

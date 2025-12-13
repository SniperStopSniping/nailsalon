/**
 * Migration Script: Populate salon_client from appointment history
 *
 * This script extracts unique clients from the appointment table and
 * creates salon_client records with computed stats.
 *
 * Run with: npx tsx scripts/migrate-clients-from-appointments.ts
 */

// Load environment variables from .env files
import path from 'node:path';

import dotenv from 'dotenv';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import * as schema from '../src/models/Schema';

// Load in order of precedence (later files override earlier)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.development.local') });

// =============================================================================
// DATABASE CONNECTION
// =============================================================================

async function getDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  console.log('🔌 Connecting to PostgreSQL database...');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const db = drizzle(client, { schema });
  return { db, client };
}

// =============================================================================
// MAIN MIGRATION
// =============================================================================

async function migrateClientsFromAppointments() {
  const { db, client } = await getDatabase();

  try {
    console.log('\n📊 Fetching unique clients from appointments...\n');

    // Query unique clients with aggregated stats from appointments
    const clientsFromAppointments = await db.execute<{
      salon_id: string;
      client_phone: string;
      client_name: string | null;
      total_visits: number;
      total_spent: number;
      last_visit_at: Date | null;
      no_show_count: number;
      first_visit_at: Date;
    }>(sql`
      SELECT 
        salon_id,
        client_phone,
        client_name,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS total_visits,
        COALESCE(SUM(total_price) FILTER (WHERE status = 'completed'), 0)::int AS total_spent,
        MAX(start_time) FILTER (WHERE status = 'completed') AS last_visit_at,
        COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show_count,
        MIN(created_at) AS first_visit_at
      FROM appointment
      WHERE client_phone IS NOT NULL AND client_phone != ''
      GROUP BY salon_id, client_phone, client_name
      ORDER BY salon_id, last_visit_at DESC NULLS LAST
    `);

    console.log(`Found ${clientsFromAppointments.rows.length} unique client(s) in appointments\n`);

    if (clientsFromAppointments.rows.length === 0) {
      console.log('No clients to migrate. Exiting.');
      return;
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of clientsFromAppointments.rows) {
      // Normalize phone (remove non-digits, keep last 10)
      const normalizedPhone = row.client_phone.replace(/\D/g, '').slice(-10);

      if (normalizedPhone.length !== 10) {
        console.log(`  ⚠️  Skipping invalid phone: ${row.client_phone}`);
        skipped++;
        continue;
      }

      // Check if client already exists for this salon
      const existing = await db
        .select({ id: schema.salonClientSchema.id })
        .from(schema.salonClientSchema)
        .where(
          and(
            eq(schema.salonClientSchema.salonId, row.salon_id),
            eq(schema.salonClientSchema.phone, normalizedPhone),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        console.log(`  ⏭️  Already exists: ${row.client_name || 'Unknown'} (${normalizedPhone})`);
        skipped++;
        continue;
      }

      // Generate a unique ID
      const id = `sc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      try {
        // Convert string dates from raw SQL to Date objects
        const lastVisitAt = row.last_visit_at ? new Date(row.last_visit_at) : null;
        const createdAt = row.first_visit_at ? new Date(row.first_visit_at) : new Date();

        await db.insert(schema.salonClientSchema).values({
          id,
          salonId: row.salon_id,
          phone: normalizedPhone,
          fullName: row.client_name || null,
          email: null,
          preferredTechnicianId: null,
          notes: null,
          lastVisitAt,
          totalVisits: row.total_visits,
          totalSpent: row.total_spent,
          noShowCount: row.no_show_count,
          loyaltyPoints: 0,
          createdAt,
          updatedAt: new Date(),
        });

        console.log(
          `  ✅ Created: ${row.client_name || 'Unknown'} (${normalizedPhone}) - `
          + `${row.total_visits} visits, $${(row.total_spent / 100).toFixed(2)} spent`,
        );
        created++;
      } catch (err) {
        console.error(`  ❌ Error creating client ${normalizedPhone}:`, err);
        errors++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('📈 Migration Summary:');
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors:  ${errors}`);
    console.log(`${'='.repeat(60)}\n`);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed.\n');
  }
}

// =============================================================================
// RUN
// =============================================================================

migrateClientsFromAppointments()
  .then(() => {
    console.log('✨ Migration complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });

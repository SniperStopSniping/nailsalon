import 'dotenv/config';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import {
  adminUserSchema,
  salonSchema,
  technicianSchema,
} from '../src/models/Schema';

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

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for E2E fixture seeding.');
  }

  const salonSlug = process.env.E2E_SALON_SLUG || 'nail-salon-no5';
  const staffTechName = process.env.E2E_STAFF_TECH_NAME || 'Daniela';
  const staffPhone = process.env.E2E_STAFF_PHONE || '4165550201';
  const superAdminPhone = process.env.E2E_SUPER_ADMIN_PHONE || '4165550101';
  const superAdminName = process.env.E2E_SUPER_ADMIN_NAME || 'E2E Super Admin';
  const superAdminEmail = process.env.E2E_SUPER_ADMIN_EMAIL || 'e2e-super-admin@nailsalon.dev';

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const db = drizzle(client);

  try {
    const [salon] = await db
      .select({
        id: salonSchema.id,
        name: salonSchema.name,
        slug: salonSchema.slug,
      })
      .from(salonSchema)
      .where(eq(salonSchema.slug, salonSlug))
      .limit(1);

    if (!salon) {
      throw new Error(`Salon ${salonSlug} was not found. Run npm run db:seed first or point E2E_SALON_SLUG at an existing salon.`);
    }

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

    await db
      .insert(adminUserSchema)
      .values({
        id: `admin_e2e_super_${superAdminPhone.replace(/\D/g, '')}`,
        phoneE164: formatPhoneE164(superAdminPhone),
        name: superAdminName,
        email: superAdminEmail,
        isSuperAdmin: true,
      })
      .onConflictDoUpdate({
        target: adminUserSchema.phoneE164,
        set: {
          name: superAdminName,
          email: superAdminEmail,
          isSuperAdmin: true,
          updatedAt: new Date(),
        },
      });

    console.log(`Seeded E2E staff fixture: ${technician.name} (${staffPhone})`);
    console.log(`Seeded E2E super-admin fixture: ${superAdminName} (${formatPhoneE164(superAdminPhone)})`);
    console.log(`Target salon: ${salon.name} (${salon.slug})`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Failed to seed E2E fixtures:', error);
  process.exit(1);
});

/* eslint-disable no-console -- guarded CLI reports its dry-run/apply status. */
/**
 * Seed the isolated Luster video-recording fixture.
 *
 * Default mode is read-only.  --apply is the only write mode, and it refuses
 * every target except the explicitly provisioned local development database.
 * This script never calls providers, never creates auth bypasses, and creates
 * no future hero booking: Sarah Morgan must be booked through the public UI.
 *
 * Usage:
 *   python3 production/luster-videos/demo/runtime.py seed-plan
 *   python3 production/luster-videos/demo/runtime.py seed-apply
 */
import process from 'node:process';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { deriveBookingCategory } from '../../../src/libs/bookingCategory';
import { resolveRuntimeEnvironment } from '../../../src/libs/environmentIsolation';
import {
  NonProductionDatabaseGuardError,
  requireExactNonProductionDatabaseEnvironment,
  requireNonProductionDatabaseTarget,
} from '../../../src/libs/nonProductionDatabaseGuard';
import * as schema from '../../../src/models/Schema';

const PREFIX = 'video-demo-';
const EXPECTED = { host: '127.0.0.1', port: '55441', database: 'luster_video_demo', user: 'luster_video_owner' } as const;
const OWNER_ENV = 'LUSTER_VIDEO_CLERK_USER_ID';
const IMAGE_URL = '/video-assets/atelier-ai-nails.png';
const HOURS = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '18:00' },
  friday: { open: '09:00', close: '18:00' },
  saturday: { open: '10:00', close: '16:00' },
  sunday: null,
};
const WEEKLY_SCHEDULE = {
  monday: { start: '09:00', end: '18:00' },
  tuesday: { start: '09:00', end: '18:00' },
  wednesday: { start: '09:00', end: '18:00' },
  thursday: { start: '09:00', end: '18:00' },
  friday: { start: '09:00', end: '18:00' },
  saturday: { start: '10:00', end: '16:00' },
  sunday: null,
};

type DemoSalon = { id: string; slug: string; configuration: 'solo' | 'team' };
const SALONS: readonly DemoSalon[] = [
  { id: `${PREFIX}salon-solo`, slug: 'atelier-nail-demo', configuration: 'solo' },
  { id: `${PREFIX}salon-team`, slug: 'atelier-nail-demo-salon', configuration: 'team' },
];
const SERVICES = [
  ['biab-overlay', 'BIAB Overlay', 'builder_gel', 6500, 75, 'A strengthening builder-gel overlay with a glossy, natural finish.'],
  ['gel-x-full-set', 'Gel-X Full Set', 'extensions', 8500, 105, 'Lightweight soft-gel extensions tailored to your preferred length and shape.'],
  ['structured-manicure', 'Structured Manicure', 'manicure', 4800, 60, 'Detailed cuticle care, gentle structure, and a polished gel finish.'],
  ['hard-gel-overlay', 'Hard Gel Overlay', 'builder_gel', 7200, 90, 'A durable hard-gel overlay for strength, shape, and lasting shine.'],
  ['gel-polish-manicure', 'Gel Polish Manicure', 'manicure', 4200, 50, 'Meticulous nail preparation finished with your choice of gel colour.'],
  ['classic-manicure', 'Classic Manicure', 'manicure', 3200, 40, 'A restorative manicure with shaping, cuticle care, and classic polish.'],
  ['gel-pedicure', 'Gel Pedicure', 'pedicure', 5500, 60, 'Relaxing foot care and a long-wearing gel pedicure finish.'],
  ['removal-and-care', 'Removal & Care', 'manicure', 2800, 35, 'Careful removal followed by conditioning treatment for healthy natural nails.'],
] as const;
const CLIENTS = [
  ['sarah-morgan', 'Sarah Morgan', '4165550101', 'sarah.morgan@example.invalid'],
  ['lena-brooks', 'Lena Brooks', '4165550102', 'lena.brooks@example.invalid'],
  ['maya-singh', 'Maya Singh', '4165550103', 'maya.singh@example.invalid'],
  ['olivia-chen', 'Olivia Chen', '4165550104', 'olivia.chen@example.invalid'],
  ['zoe-martin', 'Zoe Martin', '4165550105', 'zoe.martin@example.invalid'],
  ['nina-patel', 'Nina Patel', '4165550106', 'nina.patel@example.invalid'],
  ['ava-wilson', 'Ava Wilson', '4165550107', 'ava.wilson@example.invalid'],
  ['ella-thompson', 'Ella Thompson', '4165550108', 'ella.thompson@example.invalid'],
  ['claire-lewis', 'Claire Lewis', '4165550109', 'claire.lewis@example.invalid'],
  ['ruby-garcia', 'Ruby Garcia', '4165550110', 'ruby.garcia@example.invalid'],
] as const;
const TECHNICIANS = [
  ['marie-dupont', 'Marie Dupont'],
  ['daniela-rossi', 'Daniela Rossi'],
  ['jordan-lee', 'Jordan Lee'],
] as const;

class VideoDemoSeedError extends Error {}

function id(salon: DemoSalon, kind: string, key: string) {
  return `${PREFIX}${salon.configuration}-${kind}-${key}`;
}
function historyStarts(clientIndex: number, clientKey: string): Date[] {
  if (clientKey === 'sarah-morgan') {
    return [new Date('2026-07-08T15:00:00.000Z'), new Date('2026-08-19T16:30:00.000Z')];
  }
  return [new Date(Date.UTC(2026, 6, clientIndex + 2, 14 + (clientIndex % 3), 0, 0))];
}

function assertFixturePlan(): void {
  const phones = CLIENTS.map(([, , phone]) => phone);
  if (new Set(phones).size !== CLIENTS.length || !phones.every(phone => /^41655501(?:0[1-9]|10)$/.test(phone))) {
    throw new VideoDemoSeedError('Video demo fixture rejected: client phones must use the reserved 416-555-0101 through 416-555-0110 range.');
  }
  if (SERVICES.length !== 8 || SERVICES[0][1] !== 'BIAB Overlay' || SERVICES[0][3] !== 6500 || SERVICES[0][4] !== 75) {
    throw new VideoDemoSeedError('Video demo fixture rejected: the required BIAB Overlay service definition drifted.');
  }
  if (SALONS.some(salon => !salon.id.startsWith(PREFIX)) || !SALONS.some(salon => salon.configuration === 'solo') || !SALONS.some(salon => salon.configuration === 'team')) {
    throw new VideoDemoSeedError('Video demo fixture rejected: tenant identifiers or configurations drifted.');
  }
  const sarahVisits = historyStarts(0, 'sarah-morgan');
  if (sarahVisits.length !== 2 || sarahVisits.some(visit => visit >= new Date())) {
    throw new VideoDemoSeedError('Video demo fixture rejected: Sarah must have exactly two fixed historical visits and no seeded future booking.');
  }
}

function assertSafety(environment: NodeJS.ProcessEnv): { apply: boolean; ownerClerkUserId: string | null } {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length > 1 || (arguments_.length === 1 && arguments_[0] !== '--apply')) {
    throw new VideoDemoSeedError('Usage: seed.ts [--apply]. The default mode is read-only.');
  }
  if (environment.VERCEL || environment.VERCEL_ENV || resolveRuntimeEnvironment(environment) !== 'development') {
    throw new VideoDemoSeedError('Video demo seed refused: only a local APP_ENV=development runtime is allowed.');
  }
  const ownerClerkUserId = environment[OWNER_ENV]?.trim() || null;
  if (ownerClerkUserId && !/^user_[A-Za-z0-9]+$/.test(ownerClerkUserId)) {
    throw new VideoDemoSeedError(`${OWNER_ENV} must be a Clerk user_ identifier when set.`);
  }
  const target = requireNonProductionDatabaseTarget(environment);
  const url = new URL(target.connectionString);
  if (url.hostname !== EXPECTED.host || url.port !== EXPECTED.port || url.pathname !== `/${EXPECTED.database}` || decodeURIComponent(url.username) !== EXPECTED.user) {
    throw new VideoDemoSeedError('Video demo seed refused: DATABASE_URL is not the exact isolated local video database target.');
  }
  return { apply: arguments_[0] === '--apply', ownerClerkUserId };
}

function salonValues(salon: DemoSalon): typeof schema.salonSchema.$inferInsert {
  return {
    id: salon.id,
    name: 'Atelier Nail Studio — Demo',
    slug: salon.slug,
    themeKey: 'premium-glass',
    coverImageUrl: IMAGE_URL,
    phone: '416-555-0100',
    email: `hello+${salon.configuration}@atelier-demo.example.invalid`,
    address: '100 Demo Lane',
    city: 'Toronto',
    state: 'ON',
    zipCode: 'M5V 1A1',
    businessHours: HOURS,
    policies: { cancellationHours: 24, noShowFee: 0, depositRequired: false, depositAmount: 0 },
    plan: 'single_salon',
    status: 'active',
    publicationStatus: 'published',
    freeSoloEnabled: salon.configuration === 'solo',
    onlineBookingEnabled: true,
    smsRemindersEnabled: false,
    rewardsEnabled: false,
    reviewsEnabled: false,
    bookingFlowCustomizationEnabled: salon.configuration === 'team',
    bookingFlow: salon.configuration === 'team'
      ? ['service', 'tech', 'time', 'confirm']
      : ['service', 'time', 'confirm'],
    settings: {
      booking: { timezone: 'America/Toronto', bufferMinutes: 15, slotIntervalMinutes: 15, minimumNoticeMinutes: 60 },
      communications: { killSwitch: true, sms: { enabled: false, bookingDefault: 'disabled' }, email: { enabled: false } },
      payments: { deposit: { enabled: false } },
    },
    internalNotes: 'luster-video-demo-v1; fictional isolated recording fixture; no external integrations',
    isActive: true,
  };
}

async function seedSalon(
  db: NodePgDatabase<typeof schema>,
  salon: DemoSalon,
  ownerClerkUserId: string | null,
  setStage: (stage: string) => void,
) {
  const value = salonValues(salon);
  setStage(`${salon.configuration} salon`);
  await db.insert(schema.salonSchema).values(value).onConflictDoUpdate({ target: schema.salonSchema.id, set: { ...value, updatedAt: new Date() } });
  const locationId = id(salon, 'location', 'primary');
  setStage(`${salon.configuration} location`);
  await db.insert(schema.salonLocationSchema).values({ id: locationId, salonId: salon.id, name: 'Atelier Studio', address: '100 Demo Lane', city: 'Toronto', state: 'ON', zipCode: 'M5V 1A1', businessHours: HOURS, isPrimary: true, isActive: true }).onConflictDoUpdate({ target: schema.salonLocationSchema.id, set: { name: 'Atelier Studio', businessHours: HOURS, isPrimary: true, isActive: true, updatedAt: new Date() } });
  const techs = salon.configuration === 'solo' ? TECHNICIANS.slice(0, 1) : TECHNICIANS;
  for (const [key, name] of techs) {
    const technicianId = id(salon, 'tech', key);
    setStage(`${salon.configuration} technician`);
    await db.insert(schema.technicianSchema).values({ id: technicianId, salonId: salon.id, name, bio: 'Fictional Atelier Nail Studio demonstration technician.', specialties: ['BIAB', 'Gel-X', 'nail art'], weeklySchedule: WEEKLY_SCHEDULE, workDays: [1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00', primaryLocationId: locationId, displayOrder: techs.findIndex(([candidate]) => candidate === key), isActive: true, acceptingNewClients: true }).onConflictDoUpdate({ target: schema.technicianSchema.id, set: { name, weeklySchedule: WEEKLY_SCHEDULE, primaryLocationId: locationId, isActive: true, acceptingNewClients: true, updatedAt: new Date() } });
  }
  for (const [key, name, category, price, duration, description] of SERVICES) {
    const serviceId = id(salon, 'service', key);
    setStage(`${salon.configuration} service`);
    await db.insert(schema.serviceSchema).values({ id: serviceId, salonId: salon.id, name, slug: key, description, price, durationMinutes: duration, preparationBufferMinutes: 0, cleanupBufferMinutes: 15, category, bookingCategory: deriveBookingCategory(category), imageUrl: IMAGE_URL, sortOrder: SERVICES.findIndex(([candidate]) => candidate === key), isActive: true }).onConflictDoUpdate({ target: schema.serviceSchema.id, set: { name, description, price, durationMinutes: duration, preparationBufferMinutes: 0, cleanupBufferMinutes: 15, category, bookingCategory: deriveBookingCategory(category), imageUrl: IMAGE_URL, isActive: true, updatedAt: new Date() } });
    for (const [techKey] of techs) {
      setStage(`${salon.configuration} technician assignment`);
      await db.insert(schema.technicianServicesSchema).values({ technicianId: id(salon, 'tech', techKey), serviceId, priority: 0, enabled: true }).onConflictDoUpdate({ target: [schema.technicianServicesSchema.technicianId, schema.technicianServicesSchema.serviceId], set: { enabled: true, priority: 0 } });
    }
  }
  const addOnId = id(salon, 'addon', 'simple-nail-art');
  setStage(`${salon.configuration} add-on`);
  await db.insert(schema.addOnSchema).values({ id: addOnId, salonId: salon.id, name: 'Simple Nail Art', slug: 'simple-nail-art', category: 'nail_art', priceCents: 1000, durationMinutes: 15, pricingType: 'fixed', displayOrder: 0, isActive: true }).onConflictDoUpdate({ target: schema.addOnSchema.id, set: { name: 'Simple Nail Art', priceCents: 1000, durationMinutes: 15, isActive: true, updatedAt: new Date() } });
  const biabId = id(salon, 'service', 'biab-overlay');
  setStage(`${salon.configuration} add-on assignment`);
  await db.insert(schema.serviceAddOnSchema).values({ id: id(salon, 'service-addon', 'biab-simple-nail-art'), salonId: salon.id, serviceId: biabId, addOnId, selectionMode: 'optional', priceMode: 'catalog_priced', displayOrder: 0 }).onConflictDoUpdate({ target: schema.serviceAddOnSchema.id, set: { selectionMode: 'optional', priceMode: 'catalog_priced', displayOrder: 0, updatedAt: new Date() } });
  for (const [clientIndex, [key, fullName, phone, email]] of CLIENTS.entries()) {
    const clientId = id(salon, 'client', key);
    const isFollowUpClient = key === 'lena-brooks';
    const visits = historyStarts(clientIndex, key);
    const latestVisit = visits[visits.length - 1]!;
    const profile = {
      fullName,
      email,
      preferredTechnicianId: id(salon, 'tech', techs[0][0]),
      nailPreferences: { shape: 'short almond', length: 'short', favoriteColors: 'sheer pink and soft neutrals' },
      // Sarah begins without a note so the appointment tutorial can truthfully add one.
      notes: null,
      totalVisits: visits.length,
      totalSpent: visits.length * 6500,
      lastVisitAt: latestVisit,
      rebookIntervalDays: 28,
      // Lena is the separate, genuinely overdue follow-up client.
      nextRebookDueAt: isFollowUpClient ? new Date('2026-07-30T16:00:00.000Z') : new Date('2026-10-15T16:00:00.000Z'),
      reviewRequestsSuppressed: true,
    };
    setStage(`${salon.configuration} client profile`);
    const clientInsert = db.insert(schema.salonClientSchema).values({
      id: clientId,
      salonId: salon.id,
      phone,
      ...profile,
    });
    if (key === 'sarah-morgan') {
      // A real hero booking and tutorial note may now exist for Sarah. Re-runs
      // must never reset that client record after the first fixture creation.
      await clientInsert.onConflictDoNothing();
    } else {
      await clientInsert.onConflictDoUpdate({
        target: schema.salonClientSchema.id,
        set: { ...profile, updatedAt: new Date() },
      });
    }
    // Historical rows are fixed and distinct. The hero booking is never seeded.
    for (const [visitIndex, startedAt] of visits.entries()) {
      const historyId = id(salon, 'history', `${key}-${visitIndex + 1}`);
      const technicianId = id(salon, 'tech', techs[(clientIndex + visitIndex) % techs.length]![0]);
      const endTime = new Date(startedAt.getTime() + 75 * 60_000);
      setStage(`${salon.configuration} history appointment`);
      await db.insert(schema.appointmentSchema).values({ id: historyId, salonId: salon.id, technicianId, locationId, salonClientId: clientId, clientPhone: phone, clientName: fullName, clientEmail: email, startTime: startedAt, endTime, completedAt: endTime, status: 'completed', totalPrice: 6500, totalDurationMinutes: 75, basePriceCents: 6500, baseDurationMinutes: 75, addOnsPriceCents: 0, addOnsDurationMinutes: 0, paymentStatus: 'pending' }).onConflictDoUpdate({ target: schema.appointmentSchema.id, set: { completedAt: endTime, status: 'completed', totalPrice: 6500, totalDurationMinutes: 75, updatedAt: new Date() } });
      setStage(`${salon.configuration} history service snapshot`);
      await db.insert(schema.appointmentServicesSchema).values({ id: id(salon, 'history-service', `${key}-${visitIndex + 1}`), appointmentId: historyId, serviceId: biabId, priceAtBooking: 6500, durationAtBooking: 75, nameSnapshot: 'BIAB Overlay', categorySnapshot: 'builder_gel', priceCentsSnapshot: 6500, durationMinutesSnapshot: 75 }).onConflictDoUpdate({ target: [schema.appointmentServicesSchema.appointmentId, schema.appointmentServicesSchema.serviceId], set: { priceAtBooking: 6500, durationAtBooking: 75, nameSnapshot: 'BIAB Overlay', categorySnapshot: 'builder_gel', priceCentsSnapshot: 6500, durationMinutesSnapshot: 75 } });
    }
  }
  if (ownerClerkUserId) {
    const adminId = `${PREFIX}owner-${ownerClerkUserId}`;
    setStage(`${salon.configuration} Clerk owner`);
    await db.insert(schema.adminUserSchema).values({ id: adminId, clerkUserId: ownerClerkUserId, name: 'Video Demo Owner', email: 'video-demo-owner@example.invalid', isSuperAdmin: false }).onConflictDoUpdate({ target: schema.adminUserSchema.id, set: { clerkUserId: ownerClerkUserId, isSuperAdmin: false, updatedAt: new Date() } });
    await db.insert(schema.adminSalonMembershipSchema).values({ adminId, salonId: salon.id, role: 'owner' }).onConflictDoUpdate({ target: [schema.adminSalonMembershipSchema.adminId, schema.adminSalonMembershipSchema.salonId], set: { role: 'owner', hiddenFromChooserAt: null } });
  }
}

async function main() {
  assertFixturePlan();
  const { apply, ownerClerkUserId } = assertSafety(process.env);
  const target = requireNonProductionDatabaseTarget(process.env);
  const client = new Client({ connectionString: target.connectionString });
  let stage = 'connecting to the isolated database';
  await client.connect();
  try {
    if (!apply) {
      await client.query('BEGIN READ ONLY');
    }
    await requireExactNonProductionDatabaseEnvironment(client, 'development');
    if (!apply) {
      await client.query('ROLLBACK');
      console.log(`DRY RUN: approved target and development marker; ${SALONS.length} salons, ${SERVICES.length} services/salon, ${CLIENTS.length} clients/salon; Sarah has no future seeded booking.`);
      return;
    }
    await client.query('BEGIN');
    const db = drizzle(client, { schema });
    for (const salon of SALONS) {
      stage = `seeding ${salon.configuration} fixture`;
      await seedSalon(db, salon, ownerClerkUserId, (nextStage) => {
        stage = `seeding ${nextStage}`;
      });
    }
    stage = 'committing fixture transaction';
    await client.query('COMMIT');
    console.log('Applied only deterministic video-demo- fixture rows. No external provider was contacted.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const sqlState = typeof error === 'object' && error !== null && 'code' in error
      && typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
      ? error.code
      : null;
    if (sqlState) {
      throw new VideoDemoSeedError(`Video demo seed failed safely during ${stage} (SQLSTATE ${sqlState}).`);
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof VideoDemoSeedError || error instanceof NonProductionDatabaseGuardError
    ? error.message
    : 'Video demo seed could not safely inspect or apply the isolated database target.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

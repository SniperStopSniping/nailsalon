/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
// eslint-disable-next-line ts/ban-ts-comment -- Isolated fixture CLI; application types and runtime database guards remain authoritative.
// @ts-nocheck -- guarded local tutorial fixture CLI.
import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import { readNetworkNoShowRisk, registerNetworkBookingInTx } from '../../src/libs/networkNoShow.server';
import * as s from '../../src/models/Schema';

async function main() {
  config({
    path: '.env.development.local',
    quiet: true,
  });
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || url.port !== '55473' || url.pathname !== '/luster_mobile_library' || process.env.APP_ENV !== 'development') {
    throw new Error('Wrong disposable database');
  }
  const c = new Client({
    connectionString: url.href,
  });
  await c.connect();
  const db = drizzle(c, {
    schema: s,
  });
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60_000);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 75 * 60000);
  const created = new Date(now.getTime() - 86400000);
  const gate = new Date(now.getTime() - 172800000);
  await db.insert(s.networkNoShowPlatformControlSchema).values({
    id: 1,
    enabledAt: gate,
    prospectiveAfter: gate,
  }).onConflictDoUpdate({
    target: s.networkNoShowPlatformControlSchema.id,
    set: {
      enabledAt: gate,
      prospectiveAfter: gate,
    },
  });
  const suffix = process.argv.includes('--review-polish') ? '5' : process.argv.includes('--review-take') ? '4' : process.argv.includes('--correction-final') ? '3' : process.argv.includes('--correction-take') ? '2' : '1';
  const phone = '4165550103';
  const email = 'maya.singh@example.invalid';
  const salon = 'video-demo-salon-solo';
  const id = `video-library-confirmed-nonattendance-${suffix}`;
  const [existing] = await db.select({
    status: s.appointmentSchema.status,
  }).from(s.appointmentSchema).where(eq(s.appointmentSchema.id, id));
  if (existing && existing.status !== 'confirmed') {
    throw new Error('Existing report preserved: use a fresh disposable runtime for a new take');
  }
  await db.insert(s.appointmentSchema).values({
    id,
    salonId: salon,
    salonClientId: 'video-demo-solo-client-maya-singh',
    technicianId: 'video-demo-solo-tech-marie-dupont',
    locationId: 'video-demo-solo-location-primary',
    clientName: 'Maya Singh',
    clientPhone: phone,
    clientEmail: email,
    startTime: start,
    endTime: end,
    status: 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 75,
    createdAt: created,
  }).onConflictDoNothing();
  await db.update(s.appointmentSchema).set({
    clientName: 'Maya Singh',
    salonClientId: 'video-demo-solo-client-maya-singh',
    startTime: start,
    endTime: end,
  }).where(eq(s.appointmentSchema.id, id));
  await db.insert(s.appointmentServicesSchema).values({
    id: `video-library-noshow-service-${suffix}`,
    appointmentId: id,
    serviceId: 'video-demo-solo-service-biab-overlay',
    priceAtBooking: 6500,
    durationAtBooking: 75,
    nameSnapshot: 'BIAB Overlay',
    priceCentsSnapshot: 6500,
    durationMinutesSnapshot: 75,
  }).onConflictDoNothing();
  await db.transaction(tx => registerNetworkBookingInTx(tx as any, {
    salonId: salon,
    appointmentId: id,
    phone,
    email,
    actorRole: 'guest',
    now: created,
  }));
  const otherId = 'video-library-warning-appointment-1';
  await db.insert(s.appointmentSchema).values({
    id: otherId,
    salonId: 'video-demo-salon-team',
    salonClientId: 'video-demo-team-client-maya-singh',
    technicianId: 'video-demo-team-tech-daniela-rossi',
    locationId: 'video-demo-team-location-primary',
    clientName: 'Maya Singh',
    clientPhone: phone,
    clientEmail: email,
    startTime: new Date(start.getTime() + 86400000 + 5 * 3600000),
    endTime: new Date(end.getTime() + 86400000 + 5 * 3600000),
    status: 'confirmed',
    totalPrice: 6500,
    totalDurationMinutes: 75,
    createdAt: created,
  }).onConflictDoNothing();
  await db.insert(s.appointmentServicesSchema).values({
    id: 'video-library-warning-service-1',
    appointmentId: otherId,
    serviceId: 'video-demo-team-service-biab-overlay',
    priceAtBooking: 6500,
    durationAtBooking: 75,
    nameSnapshot: 'BIAB Overlay',
    priceCentsSnapshot: 6500,
    durationMinutesSnapshot: 75,
  }).onConflictDoNothing();
  await db.update(s.appointmentSchema).set({
    clientName: 'Maya Singh',
    salonClientId: 'video-demo-team-client-maya-singh',
  }).where(eq(s.appointmentSchema.id, otherId));
  await db.transaction(tx => registerNetworkBookingInTx(tx as any, {
    salonId: 'video-demo-salon-team',
    appointmentId: otherId,
    phone,
    email,
    actorRole: 'guest',
    now: created,
  }));
  console.log(JSON.stringify({
    id,
    scheduledStart: start.toISOString(),
    seededAt: now.toISOString(),
    minutesBefore: 30,
    baseline: await readNetworkNoShowRisk({
      salonId: salon,
      phone,
      email,
      handle: db as any,
    }),
  }));
  await c.end();
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

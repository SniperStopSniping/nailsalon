/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
// eslint-disable-next-line ts/ban-ts-comment -- Isolated fixture CLI; application types and runtime database guards remain authoritative.
// @ts-nocheck -- synthetic fixtures, exact loopback database only.
import { readFile } from 'node:fs/promises';

import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';

import * as s from '../../src/models/Schema';

async function main() {
  config({
    path: '.env.development.local',
    quiet: true,
  });
  const u = new URL(process.env.DATABASE_URL);
  const state = JSON.parse(await readFile('/Users/me/.codex/luster-video-runtime/mobile-library-20261015/state.json', 'utf8'));
  if (process.env.APP_ENV !== 'development' || u.hostname !== '127.0.0.1' || u.port !== '55473' || u.pathname !== '/luster_mobile_library' || u.username !== 'luster_library_owner' || state.database_url !== process.env.DATABASE_URL) {
    throw new Error('Exact task database required');
  }
  const c = new Client({
    connectionString: u.href,
  });
  await c.connect();
  const db = drizzle(c, {
    schema: s,
  });
  try {
    const e = JSON.parse(await readFile('docs/tutorials/verification/manual-appointment-evidence.json', 'utf8'));
    const [base] = await db.select().from(s.appointmentSchema).where(eq(s.appointmentSchema.id, e.saved.id));
    if (base.salonId !== 'video-demo-salon-solo') {
      throw new Error('Synthetic source appointment required');
    }
    const [client] = await db.select().from(s.salonClientSchema).where(and(eq(s.salonClientSchema.salonId, base.salonId), eq(s.salonClientSchema.phone, '4165550191')));
    if (!client || client.fullName !== 'Emma Taylor') {
      throw new Error('Synthetic Emma profile required');
    }
    const now = new Date();
    const id = 'video-library-checkout-emma-1';
    await db.insert(s.appointmentSchema).values({
      ...base,
      id,
      clientPhone: client.phone,
      clientEmail: client.email,
      clientName: client.fullName,
      salonClientId: client.id,
      startTime: new Date(now.getTime() - 75 * 60000),
      endTime: now,
      status: 'in_progress',
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
    const lines = await db.select().from(s.appointmentServicesSchema).where(eq(s.appointmentServicesSchema.appointmentId, base.id));
    for (const line of lines) {
      await db.insert(s.appointmentServicesSchema).values({
        ...line,
        id: `video-library-checkout-service-${line.serviceId}`,
        appointmentId: id,
      }).onConflictDoNothing();
    }
    console.log('Inserted one synthetic in-progress checkout fixture. Existing history and financial rows preserved.');
  } finally {
    await c.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

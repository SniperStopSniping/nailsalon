/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
// eslint-disable-next-line ts/ban-ts-comment -- Isolated fixture CLI; application types and runtime database guards remain authoritative.
// @ts-nocheck -- isolated CLI fixture, executed only by tsx against its guarded local database.
import { config } from 'dotenv';
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
  if (url.hostname !== '127.0.0.1' || url.port !== '55472' || url.pathname !== '/luster_mobile_noshow') {
    throw new Error('Wrong isolated database');
  }
  const c = new Client({
    connectionString: url.href,
  });
  await c.connect();
  const db = drizzle(c, {
    schema: s,
  });
  const now = new Date();
  await db.transaction(tx => registerNetworkBookingInTx(tx as any, {
    salonId: 'video-demo-salon-team',
    appointmentId: 'video-demo-warning-appointment',
    phone: '4165550101',
    email: 'sarah.morgan@example.invalid',
    actorRole: 'guest',
    now: new Date(now.getTime() - 86400000),
  }));
  console.log(JSON.stringify({
    risk: await readNetworkNoShowRisk({
      salonId: 'video-demo-salon-team',
      phone: '4165550101',
      email: 'sarah.morgan@example.invalid',
      handle: db as any,
    }),
  }));
  await c.end();
}
main();

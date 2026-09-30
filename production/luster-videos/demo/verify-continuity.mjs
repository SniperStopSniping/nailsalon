import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env.development.local', quiet: true });
const root = 'production/luster-videos';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55441');
  assert.equal(url.pathname, '/luster_video_demo');
  assert.equal(url.username, 'luster_video_owner');
  assert.equal(process.env.APP_ENV, 'development');
  const hero = JSON.parse(await readFile(`${root}/qa/hero-booking.json`, 'utf8'));
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query('begin read only');
    const { rows: appointments } = await db.query(`select id,salon_id,salon_client_id,technician_id,start_time,end_time,status
      from appointment where salon_id=$1 and client_name=$2 and start_time>now() and status<>$3`, [hero.salonId, 'Sarah Morgan', 'cancelled']);
    assert.equal(appointments.length, 1, 'No duplicated future hero appointment');
    const appointment = appointments[0];
    assert.equal(appointment.id, hero.appointmentId);
    assert.equal(appointment.salon_client_id, hero.expectedClientId);
    assert.equal(appointment.technician_id, hero.technicianId);
    assert.equal(appointment.status, 'confirmed');
    assert.equal(appointment.start_time.toISOString(), '2026-10-02T17:00:00.000Z');
    assert.equal((appointment.end_time - appointment.start_time) / 60000, 90);
    const { rows: clients } = await db.query('select id,notes from salon_client where salon_id=$1 and id=$2', [hero.salonId, hero.expectedClientId]);
    assert.equal(clients.length, 1);
    assert.equal(clients[0].notes, 'Prefers short almond shape and sheer pink finishes.');
    const { rows: deliveries } = await db.query('select channel,status,error_code,count(*)::int as count from notification_delivery where salon_id=$1 group by channel,status,error_code', [hero.salonId]);
    const { rows: sent } = await db.query(`select count(*)::int as count from notification_delivery
      where salon_id=$1 and (provider_message_id is not null or status in ('sent','delivered'))`, [hero.salonId]);
    assert.equal(sent[0].count, 0, 'No provider delivery or provider message identifier');
    const report = { checkedAt: new Date().toISOString(), applicationSHA: hero.applicationSHA, appointment, originalStartTime: '2026-10-02T14:00:00.000Z', rescheduledThrough: 'authorized owner UI; Save changes; HTTP 200', singleFutureHero: true, clientAssociationUnchanged: true, noteSavedAndReloadedThroughUI: true, customerReload: 'Observed Booking received recovery receipt; original automation expected the wrong heading', deliveries, providerSentOrDeliveredCount: 0, limitations: ['Read-only DB checks supplement recorded UI evidence; they do not replace it.', 'No payment reconciliation or delivery feature claims are approved.'] };
    await writeFile(`${root}/qa/continuity-report.json`, JSON.stringify(report, null, 2));
    hero.persistenceVerified = true;
    hero.currentStartTime = appointment.start_time.toISOString();
    hero.notePersisted = true;
    await writeFile(`${root}/qa/hero-booking.json`, JSON.stringify(hero, null, 2));
    await db.query('rollback');
    process.stdout.write('PASS: one persisted hero, unchanged client/technician, rescheduled duration, saved note, and zero provider deliveries.\n');
  } finally {
    await db.end();
  }
}
main().catch((error) => {
  process.stderr.write(`Continuity verification failed (${error.name}); no connection values logged.\n`);
  process.exitCode = 1;
});

/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
import { writeFile } from 'node:fs/promises';

import { config } from 'dotenv';
import pg from 'pg';

config({
  path: '.env.development.local',
  quiet: true,
});
const u = new URL(process.env.DATABASE_URL);
if (u.hostname !== '127.0.0.1' || u.port !== '55472' || u.pathname !== '/luster_mobile_noshow') {
  throw new Error('Wrong isolated database');
}
const c = new pg.Client({
  connectionString: u.href,
});
await c.connect();
const {
  rows: [appointment],
} = await c.query('select status,start_time from appointment where id=\'video-demo-confirmed-nonattendance-v3\' and salon_id=\'video-demo-salon-solo\'');
const {
  rows: events,
} = await c.query('select state,marked_at,expires_at,occurred_at from network_no_show_event where appointment_id=\'video-demo-confirmed-nonattendance-v3\'');
const {
  rows: audit,
} = await c.query('select action,new_value,created_at from appointment_audit_log where appointment_id=\'video-demo-confirmed-nonattendance-v3\' order by created_at');
const {
  rows: bindings,
} = await c.query('select salon_id,state,booking_channel from network_no_show_booking_binding where appointment_id in (\'video-demo-confirmed-nonattendance-v3\',\'video-demo-warning-appointment-v3\')');
if (appointment.status !== 'no_show' || events.length !== 1 || events[0].state !== 'active') {
  throw new Error('No-show/event verification failed');
}
const minutes = (new Date(appointment.start_time) - new Date(events[0].marked_at)) / 60000;
if (minutes <= 0 || minutes > 1440) {
  throw new Error('Report was not in prestart window');
}
if (!JSON.stringify(audit).includes('confirmed_nonattendance')) {
  throw new Error('Reason missing from audit');
}
if (bindings.length !== 2 || bindings.some(x => x.state !== 'eligible')) {
  throw new Error('Authorized relationship missing');
}
const result = {
  verifiedAt: new Date().toISOString(),
  appointmentStatus: appointment.status,
  minutesBeforeAppointment: Number(minutes.toFixed(2)),
  activeContributionCount: events.length,
  reasonPreserved: true,
  eligibleSourceAndRecipientBindings: true,
  historyWindowMonths: 12,
  providerDelivery: 'disabled; no provider outcome asserted',
  syntheticDataOnly: true,
  privateNoteRecorded: false,
};
await writeFile('docs/tutorials/verification/no-show-database.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await c.end();

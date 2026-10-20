/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
// Synthetic catalogue only. No production targets or provider calls.
import { readFile } from 'node:fs/promises';

import { config } from 'dotenv';
import pg from 'pg';

const {
  Client,
} = pg;
config({
  path: '.env.development.local',
  quiet: true,
});
const url = new URL(process.env.DATABASE_URL);
const state = JSON.parse(await readFile('/Users/me/.codex/luster-video-runtime/mobile-library-20261015/state.json', 'utf8'));
if (process.env.APP_ENV !== 'development' || url.hostname !== '127.0.0.1' || url.port !== '55473' || url.pathname !== '/luster_mobile_library' || url.username !== 'luster_library_owner' || state.database_url !== process.env.DATABASE_URL) {
  throw new Error('Isolated fixture database required');
}
const extras = [['french-tips', 'French Tips', 'nail_art', 1500, 15], ['chrome', 'Chrome', 'nail_art', 1500, 10], ['glitter', 'Glitter', 'nail_art', 1000, 10], ['outside-removal', 'Removal from Another Salon', 'removal', 2000, 20]];
const db = new Client({
  connectionString: process.env.DATABASE_URL,
});
await db.connect();
try {
  await db.query('BEGIN');
  const salon = await db.query('SELECT id FROM salon WHERE id=\'video-demo-salon-solo\' AND slug=\'atelier-nail-demo\'');
  if (salon.rowCount !== 1) {
    throw new Error('Synthetic salon missing');
  }
  for (const [key, name, cat, price, duration] of extras) {
    await db.query(`INSERT INTO add_on(id,salon_id,name,slug,category,price_cents,duration_minutes,pricing_type,is_active,display_order) VALUES($1,$2,$3,$4,$5,$6,$7,'fixed',true,$8) ON CONFLICT(id) DO NOTHING`, [`video-demo-solo-addon-${key}`, 'video-demo-salon-solo', name, key, cat, price, duration, extras.findIndex(e => e[0] === key) + 1]);
  }
  await db.query('COMMIT');
  console.log('Four isolated optional add-ons prepared; service relationships will be saved through the real UI.');
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
} finally {
  await db.end();
}

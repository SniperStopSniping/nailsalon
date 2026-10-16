/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
import { stat } from 'node:fs/promises';

import { config } from 'dotenv';
import pg from 'pg';
import sharp from 'sharp';

config({
  path: '.env.development.local',
  quiet: true,
});
const u = new URL(process.env.DATABASE_URL || '');
if (u.hostname !== '127.0.0.1' || u.port !== '55473' || u.pathname !== '/luster_mobile_library' || u.username !== 'luster_library_owner' || process.env.APP_ENV !== 'development') {
  throw new Error('Task-owned local database required');
}
const c = new pg.Client({
  connectionString: u.href,
});
await c.connect();
try {
  const names = ['manicure-gel-nude.webp', 'manicure-pearl-chrome.webp', 'manicure-cateye.webp'];
  for (let i = 0; i < names.length; i++) {
    const file = `public/assets/images/services/${names[i]}`;
    const m = await sharp(file).metadata();
    const s = await stat(file);
    await c.query(`INSERT INTO salon_portfolio_photo (id,public_id,salon_id,cloudinary_public_id,image_url,original_width,original_height,mime_type,file_size_bytes,sort_order,owner_visible,discover_included,service_family,nail_length,alt_text,publication_rights_confirmed_at,publication_rights_confirmed_by,publication_rights_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,false,'unspecified','unspecified',$11,now(),$12,$13) ON CONFLICT (id) DO NOTHING`, [`video-library-portfolio-${i}`, `video-library-public-portfolio-${i}`, 'video-demo-salon-solo', `isolated-example-never-uploaded-${i}`, `/assets/images/services/${names[i]}`, m.width, m.height, 'image/webp', s.size, i, `Demo nail design ${i + 1}`, 'synthetic-video-fixture', 'portfolio_publication_rights_v1']);
  }
  console.log('Three insert-only local portfolio examples prepared from existing repository service assets; no provider upload or Discover publication.');
} finally {
  await c.end();
}

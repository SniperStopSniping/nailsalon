/**
 * Portfolio slot-claim integrity under GENUINE concurrency.
 *
 * PGlite runs on a single connection, so it cannot prove that two uploads
 * racing for the last remaining slot are actually serialized — the advisory
 * lock is a no-op there and the count-then-insert would appear correct even
 * if it were not. This suite drives the real claim against a throwaway
 * PostgreSQL server over a real connection pool, which is the only place the
 * race can be observed.
 *
 * This is the specific bug the existing technician limit still has: two
 * requests both read `max - 1` and both succeed.
 *
 * Opt-in, and refuses to run against anything that is not an explicitly
 * local/CI throwaway database.
 *
 *   docker run -d --name luster-qa-pg -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=qa \
 *     -e POSTGRES_DB=luster_qa -p 55432:5432 postgres:16
 *   CONCURRENCY_TEST_DATABASE_URL=postgres://qa@127.0.0.1:55432/luster_qa \
 *     npx vitest run --no-file-parallelism src/libs/portfolioMedia.concurrency.integration.test.ts
 */
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  // The whole point of this suite: the advisory lock must be live.
  usesRuntimePostgres: true,
}));

const RAW_URL = process.env.CONCURRENCY_TEST_DATABASE_URL ?? '';
let parsedUrl: URL | null = null;

try {
  parsedUrl = RAW_URL ? new URL(RAW_URL) : null;
} catch {
  parsedUrl = null;
}

const parsedDb = parsedUrl ? decodeURIComponent(parsedUrl.pathname).replace(/^\//, '') : '';
const disposableConfirmed
  = process.env.PORTFOLIO_LIMIT_DISPOSABLE_DATABASE_CONFIRMED === 'true'
  || (parsedDb === 'luster_qa' && parsedUrl?.username === 'qa');
const isLocalThrowaway
  = parsedUrl !== null
  && ['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)
  && parsedDb.length > 0
  && disposableConfirmed
  && !RAW_URL.includes('neon.tech');

const suite = isLocalThrowaway ? describe : describe.skip;

const SALON_ID = 'portfolio-concurrency-salon';

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let media: typeof import('./portfolioMedia.server');

async function seedSalon(maxPortfolioPhotos: number) {
  await db.execute(sql`
    insert into salon (id, name, slug, theme_key, plan, max_portfolio_photos)
    values (${SALON_ID}, ${SALON_ID}, ${SALON_ID}, 'nail-salon-no5', 'free', ${maxPortfolioPhotos})
    on conflict (id) do update set max_portfolio_photos = excluded.max_portfolio_photos
  `);
}

function upload(suffix: string) {
  return media.createPortfolioPhoto({
    salonId: SALON_ID,
    locationId: null,
    technicianId: null,
    cloudinaryPublicId: `salons/${SALON_ID}/portfolio/portfolio_${suffix}_jpg`,
    imageUrl: `https://res.cloudinary.com/demo/${suffix}.jpg`,
    originalWidth: 1200,
    originalHeight: 1500,
    mimeType: 'image/jpeg',
    fileSizeBytes: 2048,
    altText: null,
    publicationRightsConfirmedBy: 'admin_concurrency_test',
  });
}

async function storedCount(): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as c from salon_portfolio_photo where salon_id = ${SALON_ID} and deleted_at is null`,
  );
  const list = (result as unknown as { rows?: { c: number }[] }).rows ?? [];

  return Number(list[0]?.c ?? 0);
}

beforeAll(async () => {
  if (!isLocalThrowaway) {
    return;
  }

  pool = new pg.Pool({ connectionString: RAW_URL, max: 12 });
  db = drizzle(pool, { schema });
  holder.db = db;
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  media = await import('./portfolioMedia.server');
}, 180_000);

beforeEach(async () => {
  if (!isLocalThrowaway) {
    return;
  }

  await db.execute(sql`delete from salon_portfolio_photo where salon_id = ${SALON_ID}`);
});

afterAll(async () => {
  await pool?.end();
});

suite('portfolio slot claim under concurrency', () => {
  it('lets exactly one of two uploads take the final slot', async () => {
    await seedSalon(1);

    const results = await Promise.allSettled([
      upload('race000000000001'),
      upload('race000000000002'),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'PORTFOLIO_PHOTO_LIMIT_REACHED',
    });
    expect(await storedCount()).toBe(1);
  });

  it('never exceeds the allowance when many uploads race for few slots', async () => {
    await seedSalon(3);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => upload(`burst00000000${String(i).padStart(3, '0')}`)),
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');

    expect(fulfilled).toHaveLength(3);
    expect(await storedCount()).toBe(3);

    for (const rejection of results.filter(r => r.status === 'rejected')) {
      expect((rejection as PromiseRejectedResult).reason).toMatchObject({
        code: 'PORTFOLIO_PHOTO_LIMIT_REACHED',
      });
    }
  });

  it('assigns every racing upload a distinct sort order', async () => {
    await seedSalon(20);

    await Promise.all(
      Array.from({ length: 8 }, (_, i) => upload(`order0000000${String(i).padStart(4, '0')}`)),
    );

    const result = await db.execute(
      sql`select sort_order from salon_portfolio_photo where salon_id = ${SALON_ID} order by sort_order`,
    );
    const list = (result as unknown as { rows?: { sort_order: number }[] }).rows ?? [];
    const orders = list.map(r => Number(r.sort_order));

    expect(new Set(orders).size).toBe(orders.length);
  });

  it('frees the slot for a waiting upload once a photo is deleted', async () => {
    await seedSalon(1);
    const first = await upload('freed00000000001');

    await expect(upload('freed00000000002')).rejects.toThrow();

    await media.deletePortfolioPhoto({ salonId: SALON_ID, photoId: first.id });

    await expect(upload('freed00000000003')).resolves.toBeDefined();
    expect(await storedCount()).toBe(1);
  });
});

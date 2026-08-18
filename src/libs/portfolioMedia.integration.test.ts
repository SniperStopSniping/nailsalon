import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
  // PGlite runs a single connection, so transactions cannot interleave and the
  // advisory lock is a no-op here — the same carve-out integrationOutbox uses.
  // The real concurrency proof lives in the Postgres suite.
  usesRuntimePostgres: false,
}));

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'migrations');

const SALON_A = 'portfolio-tenant-a';
const SALON_B = 'portfolio-tenant-b';

let db: any;
let media: typeof import('./portfolioMedia.server');
let limits: typeof import('./portfolioLimits.server');

function rows(result: unknown): any[] {
  const wrapped = result as { rows?: any[] };

  return Array.isArray(wrapped?.rows) ? wrapped.rows : (Array.isArray(result) ? result as any[] : []);
}

async function seedSalon(id: string, plan: string, maxPortfolioPhotos: number | null) {
  await db.execute(sql`
    insert into salon (id, name, slug, theme_key, plan, max_portfolio_photos)
    values (${id}, ${id}, ${id}, 'nail-salon-no5', ${plan}, ${maxPortfolioPhotos})
    on conflict (id) do update set plan = excluded.plan,
      max_portfolio_photos = excluded.max_portfolio_photos
  `);
}

async function addPhoto(salonId: string, suffix: string) {
  return media.createPortfolioPhoto({
    salonId,
    locationId: null,
    technicianId: null,
    cloudinaryPublicId: `salons/${salonId}/portfolio/portfolio_${suffix}_jpg`,
    imageUrl: `https://res.cloudinary.com/demo/${suffix}.jpg`,
    originalWidth: 1200,
    originalHeight: 1500,
    mimeType: 'image/jpeg',
    fileSizeBytes: 2048,
    altText: null,
    publicationRightsConfirmedBy: 'admin_test',
  });
}

beforeAll(async () => {
  const client = new PGlite();
  db = drizzlePglite(client);
  holder.db = db;
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });

  media = await import('./portfolioMedia.server');
  limits = await import('./portfolioLimits.server');
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from salon_portfolio_photo`);
  await seedSalon(SALON_A, 'free', null);
  await seedSalon(SALON_B, 'free', null);
});

describe('portfolio photo limit enforcement', () => {
  it('refuses an upload once the allowance is full', async () => {
    await seedSalon(SALON_A, 'free', 2);
    await addPhoto(SALON_A, 'aaaaaaaaaaaaaaa1');
    await addPhoto(SALON_A, 'aaaaaaaaaaaaaaa2');

    await expect(addPhoto(SALON_A, 'aaaaaaaaaaaaaaa3')).rejects.toMatchObject({
      code: 'PORTFOLIO_PHOTO_LIMIT_REACHED',
    });
  });

  it('leaves no row behind when a claim is refused', async () => {
    await seedSalon(SALON_A, 'free', 1);
    await addPhoto(SALON_A, 'bbbbbbbbbbbbbbb1');

    await expect(addPhoto(SALON_A, 'bbbbbbbbbbbbbbb2')).rejects.toThrow();

    const stored = await limits.countStoredPortfolioPhotos(SALON_A);

    expect(stored).toBe(1);
  });

  it('frees capacity when a photo is deleted', async () => {
    await seedSalon(SALON_A, 'free', 1);
    const first = await addPhoto(SALON_A, 'ccccccccccccccc1');

    await expect(addPhoto(SALON_A, 'ccccccccccccccc2')).rejects.toThrow();

    await media.deletePortfolioPhoto({ salonId: SALON_A, photoId: first.id });

    await expect(addPhoto(SALON_A, 'ccccccccccccccc3')).resolves.toBeDefined();
  });

  it('counts hidden and Discover-excluded photos against the allowance', async () => {
    await seedSalon(SALON_A, 'free', 2);
    const hidden = await addPhoto(SALON_A, 'ddddddddddddddd1');
    await addPhoto(SALON_A, 'ddddddddddddddd2');

    await media.updatePortfolioPhotos({
      salonId: SALON_A,
      photoIds: [hidden.id],
      patch: { ownerVisible: false, discoverIncluded: false },
    });

    // Capacity is storage, not exposure: hiding a photo must not free a slot.
    await expect(addPhoto(SALON_A, 'ddddddddddddddd3')).rejects.toThrow();
  });

  it('honours a per-salon override above the plan default', async () => {
    await seedSalon(SALON_A, 'free', 12);

    for (let i = 0; i < 11; i++) {
      await addPhoto(SALON_A, `eeeeeeeeeeeeee${String(i).padStart(2, '0')}`);
    }

    const usage = await limits.getPortfolioUsage(SALON_A);

    expect(usage.max).toBe(12);
    expect(usage.stored).toBe(11);
    expect(usage.source).toBe('override');
  });

  it('reports the over-allowance state after a downgrade without deleting anything', async () => {
    await seedSalon(SALON_A, 'free', 5);

    for (let i = 0; i < 5; i++) {
      await addPhoto(SALON_A, `fffffffffffffff${i}`);
    }

    await seedSalon(SALON_A, 'free', 2);

    const usage = await limits.getPortfolioUsage(SALON_A);

    expect(usage.stored).toBe(5);
    expect(usage.max).toBe(2);
    expect(usage.overAllowance).toBe(true);

    const remaining = rows(await db.execute(sql`select count(*)::int as c from salon_portfolio_photo where salon_id = ${SALON_A} and deleted_at is null`));

    expect(remaining[0].c).toBe(5);
  });
});

describe('tenant isolation', () => {
  it('does not let one salon patch another salon’s photo', async () => {
    const victim = await addPhoto(SALON_B, 'ggggggggggggggg1');

    const updated = await media.updatePortfolioPhotos({
      salonId: SALON_A,
      photoIds: [victim.id],
      patch: { serviceFamily: 'acrylic' },
    });

    expect(updated).toBe(0);

    const after = rows(await db.execute(sql`select service_family from salon_portfolio_photo where id = ${victim.id}`));

    expect(after[0].service_family).toBe('unspecified');
  });

  it('does not let one salon delete another salon’s photo', async () => {
    const victim = await addPhoto(SALON_B, 'hhhhhhhhhhhhhhh1');

    const deleted = await media.deletePortfolioPhoto({ salonId: SALON_A, photoId: victim.id });

    expect(deleted).toBeNull();
    expect(await limits.countStoredPortfolioPhotos(SALON_B)).toBe(1);
  });

  it('does not let one salon crop another salon’s photo', async () => {
    const victim = await addPhoto(SALON_B, 'iiiiiiiiiiiiiii1');

    const applied = await media.setPortfolioPhotoCrop({
      salonId: SALON_A,
      photoId: victim.id,
      crop: { cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, focalX: null, focalY: null },
    });

    expect(applied).toBe(false);
  });

  it('does not let one salon reorder another salon’s photos', async () => {
    const victim = await addPhoto(SALON_B, 'jjjjjjjjjjjjjjj1');

    const reordered = await media.reorderPortfolioPhotos({
      salonId: SALON_A,
      orderedPhotoIds: [victim.id],
    });

    expect(reordered).toBe(0);
  });
});

describe('ordering and reuse of a deleted photo', () => {
  it('assigns increasing sort order to new uploads', async () => {
    await seedSalon(SALON_A, 'single_salon', null);
    const first = await addPhoto(SALON_A, 'kkkkkkkkkkkkkkk1');
    const second = await addPhoto(SALON_A, 'kkkkkkkkkkkkkkk2');

    const ordered = await media.listPortfolioPhotos(SALON_A);

    expect(ordered.map(p => p.id)).toEqual([first.id, second.id]);
  });

  it('excludes soft-deleted photos from listings', async () => {
    const photo = await addPhoto(SALON_A, 'lllllllllllllll1');

    await media.deletePortfolioPhoto({ salonId: SALON_A, photoId: photo.id });

    expect(await media.listPortfolioPhotos(SALON_A)).toHaveLength(0);
  });

  it('cannot delete the same photo twice', async () => {
    const photo = await addPhoto(SALON_A, 'mmmmmmmmmmmmmmm1');

    expect(await media.deletePortfolioPhoto({ salonId: SALON_A, photoId: photo.id })).not.toBeNull();
    expect(await media.deletePortfolioPhoto({ salonId: SALON_A, photoId: photo.id })).toBeNull();
  });
});

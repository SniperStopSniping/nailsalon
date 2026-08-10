/**
 * Regression coverage for the PR3 review finding (High,
 * incomplete-authorization-wiring): checkSalonStatus() used to redirect an
 * unpublished salon to /not-found unconditionally, with zero knowledge of
 * the owner-preview authorization decision `[locale]/[slug]/layout.tsx`
 * (via `resolveDraftSalonAccess` / `resolveOwnerPreviewContext` in
 * `@/libs/ownerPreview`) had already made for the same request -- so an
 * authorized owner (or impersonating super admin) previewing their own
 * draft salon still hit the public 404 gate on every real booking-step
 * page (service/tech/time/confirm), which independently call
 * checkSalonStatus().
 *
 * This test exercises checkSalonStatus() directly against a real PGlite
 * instance (same pattern as bookingQuote.addOnGating.test.ts) to prove:
 *   - default behaviour (no options) is completely unchanged: an
 *     unpublished salon still redirects to /not-found for every other
 *     caller (API routes, other pages) that doesn't pass the new option.
 *   - passing `{ allowUnpublishedPreview: true }` (what the fixed booking
 *     pages now do, driven by `resolveDraftSalonAccess`) lets an
 *     unpublished-but-not-suspended/cancelled/deleted salon through with
 *     no redirect.
 *   - deleted/suspended/cancelled still redirect even with the bypass on --
 *     the bypass only ever affects the "not published" branch.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as schema from '@/models/Schema';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

/* eslint-disable import/first */
import { checkSalonStatus } from './salonStatus';
/* eslint-enable import/first */

const DRAFT_SALON_ID = 'salon_preview_bypass_draft';
const SUSPENDED_DRAFT_SALON_ID = 'salon_preview_bypass_suspended_draft';
const CANCELLED_DRAFT_SALON_ID = 'salon_preview_bypass_cancelled_draft';
const DELETED_DRAFT_SALON_ID = 'salon_preview_bypass_deleted_draft';
const PUBLISHED_SALON_ID = 'salon_preview_bypass_published';

let client: PGlite;
let db: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  client = new PGlite();
  await client.waitReady;
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'migrations') });
  holder.db = db;

  await db.insert(schema.salonSchema).values([
    {
      id: DRAFT_SALON_ID,
      name: 'Draft Preview Salon',
      slug: 'draft-preview-salon',
      settings: {},
      freeSoloEnabled: true,
      publicationStatus: 'draft',
      status: 'active',
    },
    {
      id: SUSPENDED_DRAFT_SALON_ID,
      name: 'Suspended Draft Salon',
      slug: 'suspended-draft-salon',
      settings: {},
      freeSoloEnabled: true,
      publicationStatus: 'draft',
      status: 'suspended',
    },
    {
      id: CANCELLED_DRAFT_SALON_ID,
      name: 'Cancelled Draft Salon',
      slug: 'cancelled-draft-salon',
      settings: {},
      freeSoloEnabled: true,
      publicationStatus: 'draft',
      status: 'cancelled',
    },
    {
      id: DELETED_DRAFT_SALON_ID,
      name: 'Deleted Draft Salon',
      slug: 'deleted-draft-salon',
      settings: {},
      freeSoloEnabled: true,
      publicationStatus: 'draft',
      status: 'active',
      deletedAt: new Date(),
    },
    {
      id: PUBLISHED_SALON_ID,
      name: 'Published Salon',
      slug: 'published-salon',
      settings: {},
      freeSoloEnabled: false,
      publicationStatus: 'published',
      status: 'active',
    },
  ]);
});

afterAll(async () => {
  await client.close();
});

describe('checkSalonStatus preview bypass', () => {
  it('redirects an unpublished salon to /not-found by default (no options passed)', async () => {
    const result = await checkSalonStatus(DRAFT_SALON_ID);

    expect(result.redirectPath).toBe('/not-found');
    expect(result.isActive).toBe(false);
    expect(result.isPublished).toBe(false);
  });

  it('redirects an unpublished salon to /not-found when the bypass is explicitly false', async () => {
    const result = await checkSalonStatus(DRAFT_SALON_ID, { allowUnpublishedPreview: false });

    expect(result.redirectPath).toBe('/not-found');
  });

  it('lets an authorized previewer through an unpublished-but-otherwise-healthy draft salon', async () => {
    const result = await checkSalonStatus(DRAFT_SALON_ID, { allowUnpublishedPreview: true });

    expect(result.redirectPath).toBeNull();
    expect(result.isActive).toBe(true);
    // isPublished still accurately reports the real DB state -- the bypass
    // only suppresses the redirect, it never lies about publication status.
    expect(result.isPublished).toBe(false);
  });

  it('still redirects a suspended draft salon to /suspended even with the bypass on', async () => {
    const result = await checkSalonStatus(SUSPENDED_DRAFT_SALON_ID, { allowUnpublishedPreview: true });

    expect(result.redirectPath).toBe('/suspended');
  });

  it('still redirects a cancelled draft salon to /cancelled even with the bypass on', async () => {
    const result = await checkSalonStatus(CANCELLED_DRAFT_SALON_ID, { allowUnpublishedPreview: true });

    expect(result.redirectPath).toBe('/cancelled');
  });

  it('still redirects a soft-deleted draft salon to /cancelled even with the bypass on', async () => {
    const result = await checkSalonStatus(DELETED_DRAFT_SALON_ID, { allowUnpublishedPreview: true });

    expect(result.redirectPath).toBe('/cancelled');
  });

  it('is a no-op for an already-published salon whether or not the bypass is passed', async () => {
    const withoutBypass = await checkSalonStatus(PUBLISHED_SALON_ID);
    const withBypass = await checkSalonStatus(PUBLISHED_SALON_ID, { allowUnpublishedPreview: true });

    expect(withoutBypass.redirectPath).toBeNull();
    expect(withBypass.redirectPath).toBeNull();
  });
});

import { expect, test } from '@playwright/test';

import { impersonateSalonAsSuperAdmin } from './support/appointment-ops';
import { appPath, authStatePaths, e2eConfig } from './support/config';

/**
 * Quick Book design system — the owner's saved information is the only input;
 * every layout is previewable and publishable without uploading a portrait
 * or a cover, defaults are supported published states, trying a layout never
 * publishes it, and the public page carries no owner instructions.
 *
 * All eight viewport/project cases share ONE fixture salon and run in
 * parallel with the hub journey, so draft writes here are confined to the
 * site-layout field and restored in `finally`.
 */
test.use({ storageState: authStatePaths.superAdmin });

test.describe.configure({ mode: 'serial' });

const REPRESENTATIVE_LAYOUTS = [
  { id: 'side_portrait', portrait: 'default', cover: false },
  { id: 'portrait_rail', portrait: 'default', cover: false },
  { id: 'hero_banner', portrait: null, cover: true },
  { id: 'profile_overlay', portrait: 'default', cover: true },
  { id: 'gallery_header', portrait: null, cover: true },
  { id: 'asymmetric_luxe', portrait: 'default', cover: true },
] as const;

const OWNER_ONLY_COPY = [
  /upload your photo/iu,
  /using a default/iu,
  /add your photo/iu,
  /replace cover/iu,
];

async function readState(page: Parameters<typeof impersonateSalonAsSuperAdmin>[0]) {
  const response = await page.request.get(`/api/admin/booking-page?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`);

  expect(response.ok(), await response.text()).toBeTruthy();

  return response.json() as Promise<{
    config: { draft: { quickBookLayout: string }; live: { quickBookLayout: string } };
    content: { draft: { heroImageUrl: string | null; galleryPhotoIds: string[] } };
    presentationPreview: { logoUrl: string | null; technicianPhotoUrl: string | null; gallery: unknown[] };
  }>;
}

test('every representative design previews and stays unpublished until the owner publishes', async ({ browser, page }, testInfo) => {
  await impersonateSalonAsSuperAdmin(page);
  const initial = await readState(page);
  const originalDraftLayout = initial.config.draft.quickBookLayout;
  const liveLayout = initial.config.live.quickBookLayout;
  const previewUrl = `${appPath(`/admin/booking-page/preview/${encodeURIComponent(e2eConfig.salonSlug)}`)}?ownerChrome=0`;
  const publicUrl = `${appPath(`/${encodeURIComponent(e2eConfig.salonSlug)}/book/service`)}`;

  try {
    for (const layout of REPRESENTATIVE_LAYOUTS) {
      const patch = await page.request.patch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`, {
        data: { config: { quickBookLayout: layout.id } },
      });

      expect(patch.ok(), await patch.text()).toBeTruthy();

      await page.goto(previewUrl, { waitUntil: 'domcontentloaded' });
      const profile = page.getByTestId('quick-book-profile');

      await expect(profile).toHaveAttribute('data-layout-presentation', layout.id);

      const composition = profile.locator(`[data-qb-layout="${layout.id}"]`);

      await expect(composition).toBeVisible();

      // Composition-essential areas keep their image with the built-in
      // default; the fixture salon has no cover and (as a team) no sole
      // public technician, so nothing here depends on an upload.
      if (layout.portrait) {
        await expect(composition.locator('[data-qb-block="portrait"]')).toHaveAttribute('data-qb-image', 'default');
      }
      if (layout.cover) {
        await expect(composition.locator('[data-qb-block="cover"]').first()).toHaveAttribute('data-qb-image', initial.content.draft.heroImageUrl ? 'custom' : 'default');
      } else {
        await expect(composition.locator('[data-qb-block="cover"]')).toHaveCount(0);
      }

      // A team salon never implies every booking is with one featured person.
      await expect(composition.getByTestId('quick-book-technician-name')).toHaveCount(0);

      // Gallery strips depend on real eligible portfolio content — never fake tiles.
      if (layout.id === 'gallery_header' && initial.content.draft.galleryPhotoIds.length === 0) {
        await expect(composition.getByTestId('quick-book-gallery')).toHaveCount(0);
      }

      // The booking button targets the existing booking entry, not a new flow.
      await expect(composition.getByTestId('quick-book-book-button')).toHaveAttribute('href', '#quick-book-booking');
      await expect(page.locator('#quick-book-booking')).toBeVisible();

      // No owner-only wording ever reaches a customer-facing render.
      const text = (await profile.textContent()) ?? '';
      for (const pattern of OWNER_ONLY_COPY) {
        expect(text).not.toMatch(pattern);
      }

      // No horizontal overflow at this viewport.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBeTruthy();

      await testInfo.attach(`${layout.id}-${testInfo.project.name}-${page.viewportSize()?.width ?? 0}`, {
        body: await profile.screenshot(),
        contentType: 'image/png',
      });
    }

    // Trying a design is a DRAFT change: the live side is untouched and an
    // anonymous client (an authorized admin is shown their own draft on the
    // public URL) still gets the published layout until the owner publishes.
    const after = await readState(page);

    expect(after.config.live.quickBookLayout).toBe(liveLayout);
    expect(after.config.draft.quickBookLayout).toBe(REPRESENTATIVE_LAYOUTS.at(-1)!.id);

    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(publicUrl, { waitUntil: 'domcontentloaded' });

      await expect(visitor.getByTestId('quick-book-profile')).toHaveAttribute('data-layout-presentation', liveLayout);
    } finally {
      await anonymous.close();
    }
  } finally {
    const restore = await page.request.patch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`, {
      data: { config: { quickBookLayout: originalDraftLayout } },
    });

    expect(restore.ok(), await restore.text()).toBeTruthy();
  }
});

test('the Layouts panel offers every family with truthful default-image guidance', async ({ page }, testInfo) => {
  await impersonateSalonAsSuperAdmin(page);
  const state = await readState(page);
  const originalDraftLayout = state.config.draft.quickBookLayout;

  await page.goto(`${appPath('/admin/booking-page')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&panel=layouts`, { waitUntil: 'domcontentloaded' });

  const chooser = page.getByTestId('quick-book-layout-chooser');

  await expect(chooser).toBeVisible();

  for (const family of ['simple', 'profile', 'cover']) {
    await expect(page.getByTestId(`quick-book-layout-family-${family}`)).toBeVisible();
  }

  await expect(chooser.locator('[data-testid^="quick-book-layout-option-"]')).toHaveCount(22);

  try {
    // Choosing a profile-led layout immediately explains the default illustration
    // (the fixture is a team salon with no sole public portrait).
    await page.getByTestId('quick-book-layout-option-side_portrait').click();

    await expect(page.getByTestId('quick-book-layout-option-side_portrait')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('quick-book-portrait-default-note')).toContainText(/default profile illustration/iu);

    // A saved-but-unused cover is described, never silently dropped.
    if (state.content.draft.heroImageUrl) {
      await expect(page.getByTestId('quick-book-cover-unused-note')).toBeVisible();
    }

    await page.getByTestId('quick-book-layout-option-hero_banner').click();

    await expect(page.getByTestId('quick-book-layout-option-hero_banner')).toHaveAttribute('aria-pressed', 'true');

    if (!state.content.draft.heroImageUrl) {
      await expect(page.getByTestId('quick-book-cover-default-note')).toContainText(/default cover/iu);
    }

    await expect(page.getByTestId('quick-book-cover-upload')).toBeAttached();
    await expect(page.getByTestId('quick-book-layout-cover-text')).toBeVisible();

    await testInfo.attach(`layouts-panel-${testInfo.project.name}-${page.viewportSize()?.width ?? 0}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  } finally {
    const restore = await page.request.patch(`/api/admin/booking-page?salonSlug=${encodeURIComponent(e2eConfig.salonSlug)}`, {
      data: { config: { quickBookLayout: originalDraftLayout } },
    });

    expect(restore.ok(), await restore.text()).toBeTruthy();
  }
});

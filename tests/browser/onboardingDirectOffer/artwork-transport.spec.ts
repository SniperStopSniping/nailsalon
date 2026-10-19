import path from 'node:path';

import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const root = path.resolve(__dirname, '../../..');
const documentStorageKey = 'luster:site-builder-v2-booking-integration-lab:document:v1';

const artwork = async (name: string, width: number, height: number) => {
  // An uncompressed export exercises the real browser preparation, without
  // authoring a website or depending on another business's protected artwork.
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = y % 40 === 10 ? 138 : 253;
      pixels[i + 1] = y % 40 === 10 ? 56 : 231;
      pixels[i + 2] = y % 40 === 10 ? 89 : 239;
      pixels[i + 3] = x < 6 ? 0 : 255;
    }
  }
  // RGB keeps the largest fixture within the existing 15 MiB local limit;
  // the other fixtures separately exercise transparent PNG behaviour.
  const pipeline = sharp(pixels, { raw: { width, height, channels: 4 } });
  return await (name === 'tall' ? pipeline.removeAlpha() : pipeline).png({ compressionLevel: 0 }).toBuffer();
};

const visiblePixels = async (buffer: Buffer) => {
  const pixels = await sharp(buffer).ensureAlpha().raw().toBuffer();
  // Canvas may clear invisible RGB values in fully transparent pixels. Compare
  // visible colour and exact alpha, rather than those unobservable values.
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) {
      pixels.fill(0, i, i + 3);
    }
  }
  return pixels;
};

for (const [name, width, height, displayMode, displayLabel] of [
  ['tall', 1200, 4000, 'full_width', 'Full width'],
  ['wide', 1600, 800, 'contained', 'Wide & centred'],
  ['small', 279, 1280, 'full_width', 'Full width'],
] as const) {
  test(`manual ${name} artwork retains pixels, links and background through reload and transport`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    const buffer = await artwork(name, width, height);
    await page.goto('/?startup=1');
    await page.getByRole('button', { name: /Start with Your Design/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload a Canva design', exact: true });

    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Choose images', { exact: true }).setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer });
    await dialog.getByRole('button', { name: 'Add clickable links', exact: true }).click();
    await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    await page.getByRole('textbox', { name: 'Instagram username' }).fill('@manual.test.studio');
    await page.getByRole('button', { name: 'Place button on design' }).click();
    await page.getByRole('button', { name: 'Place in centre' }).click();
    await page.getByRole('dialog', { name: 'Make your design clickable', exact: true }).getByRole('button', { name: 'Done', exact: true }).click();

    await expect(dialog.getByRole('heading', { name: '1 link added' })).toBeVisible();

    await dialog.getByText('Size & background', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Use cream background' }).click();
    await dialog.getByRole('radio', { name: displayLabel, exact: true }).check();

    await expect.poll(() => page.evaluate((key) => {
      const document = JSON.parse(localStorage.getItem(key)!);
      const design = document?.pages.flatMap((p: { sections: { sectionType: string; settings: { background: { mode: string }; displayMode: string; images: { interactiveAreas: unknown[] }[] } }[] }) => p.sections)
        .find((s: { sectionType: string }) => s.sectionType === 'custom_design');
      return { background: design?.settings.background.mode, displayMode: design?.settings.displayMode, links: design?.settings.images[0].interactiveAreas.length };
    }, documentStorageKey)).toEqual({ background: 'custom', displayMode, links: 1 });

    const documentBefore = await page.evaluate(key => localStorage.getItem(key), documentStorageKey);

    expect(documentBefore).not.toBeNull();

    // Import the shipped claim client in the browser. Only the receiving
    // account API is a deterministic double; this is not Clerk/signup proof.
    const result = await page.evaluate(async ({ root, width, height }) => {
      const { claimOnboardingMedia } = await import(/* @vite-ignore */ `${root}/src/features/onboarding-v1-integration/media-claim-client.ts`);
      const { IndexedDbAssetRepository } = await import(/* @vite-ignore */ `${root}/prototypes/site-builder-v2-booking-integration-lab/src/custom-design/assets/IndexedDbAssetRepository.ts`);
      const { SITE_BUILDER_STORAGE_KEY } = await import(/* @vite-ignore */ `${root}/prototypes/site-builder-v2-booking-integration-lab/src/model/validation.ts`);
      const state = JSON.parse(localStorage.getItem('luster:onboarding-v1-lab')!);
      const document = JSON.parse(localStorage.getItem(SITE_BUILDER_STORAGE_KEY)!);
      const repository = new IndexedDbAssetRepository();
      let encoded: number[] = [];
      let originalBytes = 0;
      const claimed = await claimOnboardingMedia({
        state,
        document,
        repository,
        draftId: 'browser-artwork',
        siteId: 'browser-site',
        siteRevision: 1,
        idempotencyKey: 'browser-artwork-claim',
        fetcher: async (url: string, init?: RequestInit) => {
          if (String(url).endsWith('/verify')) {
            return Response.json({ data: { revision: 2 } });
          }
          const form = init!.body as FormData;
          if (form.get('role') !== 'custom_design') {
            throw new Error('Unexpected media role');
          }
          const image = document.pages.flatMap((p: { sections: { sectionType: string; settings: { images?: { assetId: string }[] } }[] }) => p.sections)
            .find((s: { sectionType: string }) => s.sectionType === 'custom_design').settings.images[0];
          originalBytes = (await repository.getOriginal(image.assetId)).size;
          encoded = Array.from(new Uint8Array(await (form.get('file') as File).arrayBuffer()));
          return Response.json({ data: { media: { id: 'browser-artwork', url: '/media/browser-artwork', width, height } } });
        },
      });
      return { claimed, encoded, originalBytes, document };
    }, { root: `/@fs${root}`, width, height });

    expect(result.claimed.failures).toEqual([]);
    expect(result.claimed.uploaded).toHaveLength(1);
    expect(result.originalBytes).toBe(buffer.length);

    const prepared = Buffer.from(result.encoded);

    expect(prepared.length).toBeLessThanOrEqual(3_750_000);
    expect(await sharp(prepared).metadata()).toMatchObject({ width, height });
    expect((await visiblePixels(prepared)).equals(await visiblePixels(buffer))).toBe(true);

    const design = result.document.pages.flatMap((p: { sections: { sectionType: string; settings: unknown }[] }) => p.sections).find((s: { sectionType: string }) => s.sectionType === 'custom_design');

    expect(design.settings).toMatchObject({ background: { mode: 'custom' }, images: [{ width, height, interactiveAreas: [expect.objectContaining({ action: { type: 'instagram', destination: { username: 'manual.test.studio' } } })] }] });

    await dialog.getByText('Size & background', { exact: true }).click();
    await dialog.getByRole('heading', { name: '1 link added' }).scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: testInfo.outputPath(`${name}-manual-links.png`) });
    await dialog.getByRole('button', { name: 'Preview website', exact: true }).click();
    const preview = page.getByRole('dialog', { name: 'Preview your design & links', exact: true });
    const instagram = preview.getByRole('link', { name: 'Instagram @manual.test.studio', exact: true });

    await expect(instagram).toHaveAttribute('href', 'https://www.instagram.com/manual.test.studio/');
    await expect(instagram).toHaveAttribute('target', '_blank');

    await instagram.scrollIntoViewIfNeeded();

    await expect(instagram).toBeVisible();

    await preview.screenshot({ path: testInfo.outputPath(`${name}-customer-preview.png`) });
    await page.reload();

    expect(await page.evaluate(key => localStorage.getItem(key), documentStorageKey)).toBe(documentBefore);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await testInfo.attach('artwork-transport', { body: JSON.stringify({ width, height, originalBytes: buffer.length, preparedBytes: prepared.length, visiblePixelsIdentical: true }), contentType: 'application/json' });
  });
}

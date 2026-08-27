import { readFile } from 'node:fs/promises';

import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  CUSTOM_DESIGN_ASSET_DB_NAME,
  LAB_STORAGE_KEY,
  chooseStarter,
  clearCustomDesignAssets,
  openFreshLab,
  openPagesAndStructure,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

const ASSET_SUMMARY_STORE = 'image-asset-summaries-v1';

type TestArtworkOptions = {
  fileName: string;
  format: 'jpeg' | 'png' | 'webp';
  height: number;
  hue: number;
  title: string;
  width: number;
};

type TestArtwork = {
  buffer: Buffer;
  mimeType: string;
  name: string;
};

async function createTestArtwork(
  page: Page,
  options: TestArtworkOptions,
): Promise<TestArtwork> {
  const mimeType = options.format === 'png'
    ? 'image/png'
    : options.format === 'jpeg'
      ? 'image/jpeg'
      : 'image/webp';
  const bytes = await page.evaluate(async ({ height, hue, mime, title, width }) => {
    const canvas = document.createElement('canvas');
    canvas.height = height;
    canvas.width = width;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${hue} 78% 88%)`);
    gradient.addColorStop(1, `hsl(${(hue + 55) % 360} 62% 58%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    context.fillRect(width * 0.08, height * 0.07, width * 0.84, height * 0.16);
    context.fillStyle = '#281f28';
    context.font = `700 ${Math.max(22, Math.round(width * 0.07))}px system-ui`;
    context.textAlign = 'center';
    context.fillText(title, width / 2, height * 0.16, width * 0.72);

    for (let index = 0; index < 5; index += 1) {
      const top = height * (0.3 + index * 0.115);
      context.fillStyle = index % 2 === 0
        ? 'rgba(255, 255, 255, 0.78)'
        : 'rgba(54, 33, 58, 0.62)';
      context.beginPath();
      context.roundRect(width * 0.12, top, width * 0.76, height * 0.07, 16);
      context.fill();
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (candidate) => candidate ? resolve(candidate) : reject(new Error('Image encoding failed.')),
        mime,
        0.9,
      );
    });
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, {
    height: options.height,
    hue: options.hue,
    mime: mimeType,
    title: options.title,
    width: options.width,
  });

  return {
    buffer: Buffer.from(bytes),
    mimeType,
    name: options.fileName,
  };
}

function customDesignCard(page: Page): Locator {
  return page.locator('[data-section-type="custom_design"][data-section-instance-id]');
}

function customDesignSettings(page: Page): Locator {
  return page
    .getByRole('dialog', { name: 'Custom Design settings' })
    .or(page.getByRole('dialog', { name: 'Custom Design', exact: true }));
}

async function selectCustomDesignCard(card: Locator): Promise<void> {
  if (await card.getAttribute('data-selected') !== 'true') {
    await card.locator('.section-card__select-surface').click();
  }
  await expect(card).toHaveAttribute('data-selected', 'true');
}

async function customDesignActions(page: Page, card: Locator): Promise<Locator> {
  await selectCustomDesignCard(card);
  const returnButton = page.getByRole('button', { name: 'Back to Custom Design' });
  if (await returnButton.isVisible()) {
    await returnButton.click();
  }
  const actions = page.getByRole('group', { name: 'Custom Design actions' });
  await expect(actions).toBeVisible();
  return actions;
}

async function editorSectionOrder(page: Page): Promise<string[]> {
  return page
    .locator('.final-sections-list [data-section-instance-id]')
    .evaluateAll((elements) => elements.map((element) => (
      element.querySelector('.section-card__title')?.textContent?.trim() ?? ''
    )));
}

async function runHistoryAction(
  page: Page,
  action: 'Redo' | 'Undo',
): Promise<void> {
  const topbarAction = page
    .getByRole('banner', { name: 'Site builder toolbar' })
    .getByRole('button', { name: action, exact: true });
  if (await topbarAction.isVisible()) {
    await topbarAction.click();
    return;
  }
  await page.getByRole('button', { name: 'More site options' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await more.getByRole('button', { name: action, exact: true }).click();
  await more.getByRole('button', { name: 'Close More' }).click();
  await expect(more).toHaveCount(0);
}

async function addCustomDesign(page: Page): Promise<Locator> {
  const visibleInsertion = page.locator('button.final-insertion:visible').last();
  if (await visibleInsertion.isVisible()) {
    await visibleInsertion.click();
  } else {
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
  }
  const library = page.getByRole('dialog', { name: 'Add section' });
  await expect(library).toBeVisible();
  const search = library.getByRole('searchbox', { name: 'Search sections' });
  await expect(search).toHaveAttribute(
    'placeholder',
    'Search Canva, policies, booking…',
  );
  await search.fill('Canva');
  await expect(library.getByText(
    'Upload a Canva design, flyer, policy page, or branded image.',
  )).toBeVisible();
  await expect(library.getByText('Best for designs you already made.')).toBeVisible();
  await library.getByRole('button', { name: 'Add Custom Design' }).click();
  await expect(library).toHaveCount(0);

  const card = customDesignCard(page);
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Upload your design' })).toBeVisible();
  await expect(card).toContainText('PNG, JPG, or WebP');
  return card;
}

async function uploadToCard(
  card: Locator,
  files: readonly TestArtwork[],
): Promise<void> {
  await card.locator('input[type="file"][multiple]').setInputFiles([...files]);
  await expect(card.locator('.custom-design-image-frame')).toHaveCount(
    files.length,
    { timeout: 20_000 },
  );
  await expect(card.locator('.custom-design-image-frame[data-image-render-state="loaded"]').first())
    .toBeVisible({ timeout: 20_000 });
}

async function storedAssetCount(page: Page): Promise<number> {
  return page.evaluate(async ({ databaseName, storeName }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).count();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    } finally {
      database.close();
    }
  }, {
    databaseName: CUSTOM_DESIGN_ASSET_DB_NAME,
    storeName: ASSET_SUMMARY_STORE,
  });
}

async function enterPreview(page: Page): Promise<Locator> {
  const mobileSettings = page.getByRole('dialog', {
    name: 'Custom Design',
    exact: true,
  });
  if (await mobileSettings.isVisible()) {
    await mobileSettings.getByRole('button', { name: 'Close Custom Design' }).click();
    await expect(mobileSettings).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
  return page.locator('[data-section-type="custom_design"]');
}

test.describe.configure({ mode: 'serial' });

test('searches, uploads PNG/JPEG/WebP, persists assets, and exports a truthful manifest', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const files = await Promise.all([
    createTestArtwork(page, {
      fileName: 'about-page.png',
      format: 'png',
      height: 1_600,
      hue: 330,
      title: 'ABOUT LUSTER',
      width: 540,
    }),
    createTestArtwork(page, {
      fileName: 'policy-page.jpg',
      format: 'jpeg',
      height: 1_200,
      hue: 20,
      title: 'BOOKING POLICIES',
      width: 600,
    }),
    createTestArtwork(page, {
      fileName: 'contact-page.webp',
      format: 'webp',
      height: 900,
      hue: 275,
      title: 'CONTACT',
      width: 700,
    }),
  ]);

  let card = await addCustomDesign(page);
  await uploadToCard(card, files);
  await waitForSaved(page);
  await expect.poll(() => storedAssetCount(page)).toBe(3);

  const storedJson = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    LAB_STORAGE_KEY,
  );
  expect(storedJson).not.toBeNull();
  expect(storedJson).not.toMatch(/data:image|blob:|base64/i);
  const storedDocument = JSON.parse(storedJson ?? '{}') as {
    pages: Array<{
      sections: Array<{
        hidden?: boolean;
        sectionType: string;
        settings?: { images?: unknown[] };
        visible: boolean;
      }>;
    }>;
  };
  const storedSection = storedDocument.pages
    .flatMap((candidate) => candidate.sections)
    .find((section) => section.sectionType === 'custom_design');
  expect(storedSection?.visible).toBe(true);
  expect(storedSection).not.toHaveProperty('hidden');
  expect(storedSection?.settings?.images).toHaveLength(3);

  await page.reload();
  card = customDesignCard(page);
  await expect(card).toHaveCount(1);
  await expect(card.locator('.custom-design-image-frame')).toHaveCount(3);
  await expect(card.locator('.custom-design-image-frame[data-image-render-state="loaded"]').first())
    .toBeVisible();
  await expect.poll(() => storedAssetCount(page)).toBe(3);

  await page.getByRole('button', { name: 'More site options' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await expect(more.getByTestId('custom-design-json-warning')).toHaveText(
    'Uploaded design files are stored in this browser and aren’t included in the JSON backup.',
  );
  const downloadPromise = page.waitForEvent('download');
  await more.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exportJson = await readFile(downloadPath ?? '', 'utf8');
  expect(exportJson).not.toMatch(/data:image|blob:|base64/i);
  const backup = JSON.parse(exportJson) as {
    customDesignAssets: {
      assets: unknown[];
      assetsIncluded: boolean;
    };
    document: unknown;
    kind: string;
    version: number;
  };
  expect(backup.kind).toBe('luster_site_builder_backup');
  expect(backup.version).toBe(1);
  expect(backup.customDesignAssets.assetsIncluded).toBe(false);
  expect(backup.customDesignAssets.assets).toHaveLength(3);
  expect(backup.document).toBeTruthy();
  monitor.assertClean();
  monitor.stop();
});

test('manages image order/removal, accessibility, display, spacing, background, and native CTA', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const files = await Promise.all([
    createTestArtwork(page, {
      fileName: 'page-a.png', format: 'png', height: 1_500, hue: 330,
      title: 'PAGE A', width: 540,
    }),
    createTestArtwork(page, {
      fileName: 'page-b.jpg', format: 'jpeg', height: 1_350, hue: 25,
      title: 'PAGE B', width: 540,
    }),
    createTestArtwork(page, {
      fileName: 'page-c.webp', format: 'webp', height: 1_100, hue: 270,
      title: 'PAGE C', width: 600,
    }),
  ]);
  const card = await addCustomDesign(page);
  await uploadToCard(card, files);

  const settings = customDesignSettings(page);
  await expect(settings).toBeVisible();
  let rows = settings.locator('[data-image-item-id]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('page-a.png');
  await rows.nth(0).getByRole('button', { name: 'Move page 1 down' }).click();
  await settings.getByRole('button', { name: 'Save order' }).click();
  rows = settings.locator('[data-image-item-id]');
  await expect(rows.nth(1)).toContainText('page-a.png');

  const pageC = rows.filter({ hasText: 'page-c.webp' });
  await pageC.getByRole('button', { name: 'Remove' }).click();
  await expect(settings.locator('[data-image-item-id]')).toHaveCount(2);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(settings.locator('[data-image-item-id]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(settings.locator('[data-image-item-id]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(settings.locator('[data-image-item-id]')).toHaveCount(3);

  await settings.locator('[data-image-item-id]').first()
    .getByRole('button', { name: 'Accessibility' })
    .click();
  const accessibility = page.getByRole('dialog', { name: 'Accessibility' });
  await accessibility.getByLabel('Alt text').fill('A branded Luster about page.');
  await accessibility.getByLabel('Accessible text version').fill(
    'Appointments are available Tuesday through Saturday. A deposit is required.',
  );
  await accessibility.getByRole('button', { name: 'Save accessibility' }).click();
  await expect(accessibility).toHaveCount(0);

  await settings.locator('input[name="custom-design-display"][value="contained"]').check();
  await settings.locator('input[name="custom-design-display"][value="full_width"]').check();
  await settings.locator('input[name="custom-design-gap"][value="seamless"]').check();
  await settings.locator('input[name="custom-design-gap"][value="comfortable"]').check();
  await settings.getByLabel('Custom background hex').fill('#F4E6F0');
  await settings.getByRole('button', { name: 'Apply' }).click();

  await settings.getByLabel('Button type').selectOption('book');
  await expect(settings.getByLabel('Button label')).toHaveValue('Book now');
  await settings.getByLabel('Placement').selectOption({ index: 0 });
  await settings.getByRole('button', { name: 'Save button' }).click();
  await waitForSaved(page);

  const previewSection = await enterPreview(page);
  await expect(previewSection).toHaveCount(1);
  const renderer = previewSection.getByTestId('custom-design-customer-renderer');
  await expect(renderer).toHaveAttribute('data-display-mode', 'full_width');
  await expect(renderer).toHaveAttribute('data-gap', 'comfortable');
  await expect(renderer).toHaveAttribute('data-background-mode', 'custom');
  await expect(renderer).toHaveCSS('background-color', 'rgb(244, 230, 240)');
  await expect(previewSection.getByRole('button', { name: 'Book now' })).toBeVisible();
  const textVersion = previewSection.locator('details.custom-design-accessible-summary');
  await expect(textVersion.locator('summary')).toContainText('Text version of');
  await textVersion.locator('summary').click();
  await expect(previewSection.getByText('Appointments are available Tuesday through Saturday.'))
    .toBeVisible();
  await expect(previewSection.locator('.custom-design-customer-image')).toHaveCount(3);
  monitor.assertClean();
  monitor.stop();
});

test('renders a semantic booking hotspot, cancels activation after a swipe, and suppresses missing assets', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const poster = await createTestArtwork(page, {
    fileName: 'tap-safe-poster.png',
    format: 'png',
    height: 1_500,
    hue: 325,
    title: 'BOOK YOUR APPOINTMENT',
    width: 540,
  });
  const card = await addCustomDesign(page);
  await uploadToCard(card, [poster]);

  const settings = customDesignSettings(page);
  const row = settings.locator('[data-image-item-id]').first();
  await row.getByRole('button', { name: 'Link areas' }).click();
  const hotspot = page.getByRole('dialog', { name: 'Link areas' });
  await hotspot.getByRole('button', { name: 'Add link area' }).click();
  await hotspot.getByLabel('Accessible label').fill('Start booking from artwork');
  await hotspot.getByLabel('I confirm this label explains the action').check();
  await expect(hotspot.getByLabel('What should happen?')).toHaveValue('start_booking');
  await expect(hotspot.getByRole('button', { name: 'Done' })).toBeEnabled();
  await hotspot.getByRole('button', { name: 'Done' }).click();
  await expect(hotspot).toHaveCount(0);

  const previewSection = await enterPreview(page);
  const area = previewSection.getByRole('button', {
    name: 'Start booking from artwork',
  });
  await expect(area).toBeVisible();
  await expect(area).toHaveCSS('touch-action', 'pan-y pinch-zoom');
  await expect(area).toHaveCSS('position', 'absolute');

  await page.evaluate(() => {
    const scope = window as typeof window & {
      __customDesignScrollCalls?: string[];
      __customDesignScrollIntoView?: typeof Element.prototype.scrollIntoView;
    };
    scope.__customDesignScrollCalls = [];
    scope.__customDesignScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function customDesignScrollProbe() {
      scope.__customDesignScrollCalls?.push(
        (this as HTMLElement).dataset.sectionType
          ?? (this as HTMLElement).dataset.sectionId
          ?? this.tagName,
      );
    };
  });

  await area.evaluate((element) => {
    const pointer = (type: string, x: number, y: number) => element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: x,
        clientY: y,
        isPrimary: true,
        pointerId: 12,
      }),
    );
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 100, 132);
    pointer('pointerup', 100, 132);
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 1,
    }));
  });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __customDesignScrollCalls?: string[] }
  ).__customDesignScrollCalls?.length ?? 0)).toBe(0);

  await area.evaluate((element) => {
    const pointer = (type: string) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 100,
      clientY: 100,
      isPrimary: true,
      pointerId: 13,
    }));
    pointer('pointerdown');
    pointer('pointerup');
    element.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      detail: 1,
    }));
  });
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __customDesignScrollCalls?: string[] }
  ).__customDesignScrollCalls?.length ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __customDesignScrollCalls?: string[] }
  ).__customDesignScrollCalls?.[0])).toMatch(/booking|section_/i);

  await page.evaluate(() => {
    const scope = window as typeof window & {
      __customDesignScrollCalls?: string[];
      __customDesignScrollIntoView?: typeof Element.prototype.scrollIntoView;
    };
    if (scope.__customDesignScrollIntoView) {
      Element.prototype.scrollIntoView = scope.__customDesignScrollIntoView;
    }
    delete scope.__customDesignScrollCalls;
    delete scope.__customDesignScrollIntoView;
  });

  await page.getByRole('button', { name: 'Back to editor' }).click();
  await clearCustomDesignAssets(page);
  await page.reload();
  await expect(customDesignCard(page)).toContainText(
    'This design file isn’t available in this browser.',
  );
  await expect(customDesignCard(page)).toContainText(
    'Your labels, links, and settings are still saved.',
  );
  const missingPreview = await enterPreview(page);
  await expect(missingPreview.getByRole('button', {
    name: 'Start booking from artwork',
  })).toHaveCount(0);
  await expect(missingPreview.locator('img')).toHaveCount(0);
  await expect(missingPreview.locator('img[src=""], img:not([src])')).toHaveCount(0);
  monitor.assertClean();
  monitor.stop();
});

test('keeps poster and normalized hotspot geometry safe across the required viewport matrix', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const poster = await createTestArtwork(page, {
    fileName: 'responsive-link-poster.png',
    format: 'png',
    height: 1_200,
    hue: 320,
    title: 'RESPONSIVE BOOKING',
    width: 600,
  });
  const card = await addCustomDesign(page);
  await uploadToCard(card, [poster]);

  const settings = customDesignSettings(page);
  await settings.locator('[data-image-item-id]').first()
    .getByRole('button', { name: 'Link areas' })
    .click();
  const hotspot = page.getByRole('dialog', { name: 'Link areas' });
  await hotspot.getByRole('button', { name: 'Add link area' }).click();
  await hotspot.getByLabel('Accessible label').fill('Responsive booking area');
  await hotspot.getByLabel('I confirm this label explains the action').check();
  await hotspot.getByRole('button', { name: 'Done' }).click();
  await settings.getByRole('button', { name: 'Close Custom Design settings' }).click();
  await waitForSaved(page);

  const geometry = await page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
      pages?: Array<{
        sections?: Array<{
          sectionType?: string;
          settings?: {
            images?: Array<{
              interactiveAreas?: Array<{
                geometry?: { height: number; width: number; x: number; y: number };
              }>;
            }>;
          };
        }>;
      }>;
    };
    return document.pages
      ?.flatMap(candidate => candidate.sections ?? [])
      .find(section => section.sectionType === 'custom_design')
      ?.settings?.images?.[0]?.interactiveAreas?.[0]?.geometry ?? null;
  }, LAB_STORAGE_KEY);
  expect(geometry).not.toBeNull();

  const viewports = [
    { width: 320, height: 568 },
    { width: 320, height: 600 },
    { width: 375, height: 500 },
    { width: 375, height: 600 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
    { width: 920, height: 800 },
    { width: 1180, height: 800 },
    { width: 1440, height: 900 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const ownerFrame = customDesignCard(page).locator('.custom-design-image-frame').first();
    await ownerFrame.scrollIntoViewIfNeeded();
    await expect(ownerFrame).toBeVisible();
    const ownerBox = await ownerFrame.boundingBox();
    expect(ownerBox).not.toBeNull();
    expect((ownerBox?.width ?? 0) / (ownerBox?.height ?? 1)).toBeCloseTo(0.5, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true);

    const previewSection = await enterPreview(page);
    const previewFrame = previewSection.locator('.custom-design-image-frame').first();
    await previewFrame.scrollIntoViewIfNeeded();
    await expect(previewFrame).toBeVisible();
    const previewBox = await previewFrame.boundingBox();
    const area = previewSection.getByRole('button', { name: 'Responsive booking area' });
    await expect(area).toBeVisible();
    const areaBox = await area.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(areaBox).not.toBeNull();
    if (!previewBox || !areaBox || !geometry) {
      throw new Error('Responsive Custom Design geometry was not measurable.');
    }
    expect(previewBox.width / previewBox.height).toBeCloseTo(0.5, 2);
    expect((areaBox.x - previewBox.x) / previewBox.width).toBeCloseTo(geometry.x / 100, 2);
    expect((areaBox.y - previewBox.y) / previewBox.height).toBeCloseTo(geometry.y / 100, 2);
    expect(areaBox.width / previewBox.width).toBeCloseTo(geometry.width / 100, 2);
    expect(areaBox.height / previewBox.height).toBeCloseTo(geometry.height / 100, 2);
    await expect(area).toHaveCSS('touch-action', 'pan-y pinch-zoom');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      .toBe(true);
    await expect(previewSection.locator('input[type="file"], [data-hotspot-area-id]'))
      .toHaveCount(0);
    await page.getByRole('button', { name: 'Back to editor' }).click();
    await expect(customDesignCard(page)).toBeVisible();
  }

  monitor.assertClean();
  monitor.stop();
});

test('uses universal hide/show, Move, cross-page Move, remove, restore, Undo, and Redo', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  let card = await addCustomDesign(page);

  const mobileSettings = page.getByRole('dialog', { name: 'Custom Design', exact: true });
  await mobileSettings.getByRole('button', { name: 'Close Custom Design' }).click();
  const dock = await customDesignActions(page, card);
  await dock.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(card).toHaveClass(/is-hidden/);
  await expect(dock.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
  await waitForSaved(page);
  let stored = JSON.parse(await page.evaluate(
    (key) => window.localStorage.getItem(key) ?? '{}',
    LAB_STORAGE_KEY,
  )) as { pages: Array<{ sections: Array<{ sectionType: string; visible: boolean }> }> };
  expect(stored.pages.flatMap((candidate) => candidate.sections)
    .find((section) => section.sectionType === 'custom_design')?.visible).toBe(false);
  await dock.getByRole('button', { name: 'Show', exact: true }).click();
  await expect(card).not.toHaveClass(/is-hidden/);

  const initialOrder = await editorSectionOrder(page);
  const initialCustomIndex = initialOrder.indexOf('Custom Design');
  expect(initialCustomIndex).toBeGreaterThan(0);
  await dock.getByRole('button', { name: 'Move', exact: true }).click();
  let move = page.getByRole('dialog', { name: 'Move Custom Design' });
  await move.getByRole('button', { name: 'Move Custom Design up' }).click();
  await move.getByRole('button', { name: 'Done', exact: true }).click();
  const movedOrder = [...initialOrder];
  movedOrder.splice(initialCustomIndex, 1);
  movedOrder.splice(initialCustomIndex - 1, 0, 'Custom Design');
  await expect(editorSectionOrder(page)).resolves.toEqual(movedOrder);
  await runHistoryAction(page, 'Undo');
  await expect(editorSectionOrder(page)).resolves.toEqual(initialOrder);
  await runHistoryAction(page, 'Redo');
  await expect(editorSectionOrder(page)).resolves.toEqual(movedOrder);

  card = customDesignCard(page);
  await (await customDesignActions(page, card))
    .getByRole('button', { name: 'Move', exact: true }).click();
  move = page.getByRole('dialog', { name: 'Move Custom Design' });
  await move.getByRole('button', { name: 'Move Custom Design to another page' }).click();
  await move.getByPlaceholder('Page name').fill('Portfolio');
  await move.getByRole('button', { name: 'Create page and move' }).click();
  await move.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio' })).toBeVisible();
  await expect(editorSectionOrder(page)).resolves.toEqual(['Custom Design']);
  const navigationPrompt = page.getByRole('dialog', { name: 'Add a menu?' });
  if (await navigationPrompt.isVisible()) {
    await navigationPrompt.getByRole('button', { name: 'Not now' }).click();
    await expect(navigationPrompt).toHaveCount(0);
  }

  card = customDesignCard(page);
  await (await customDesignActions(page, card))
    .getByRole('button', { name: 'More', exact: true }).click();
  const actions = page.getByRole('dialog', { name: 'Custom Design actions' });
  await actions.getByRole('button', { name: 'Remove from page' }).click();
  await expect(customDesignCard(page)).toHaveCount(0);

  const structure = await openPagesAndStructure(page);
  await structure.getByRole('button', { name: /Removed sections/ }).click();
  await structure.getByRole('button', {
    name: 'Restore Custom Design to the current page',
  }).click();
  await expect(customDesignCard(page)).toHaveCount(1);
  stored = JSON.parse(await page.evaluate(
    (key) => window.localStorage.getItem(key) ?? '{}',
    LAB_STORAGE_KEY,
  )) as { pages: Array<{ sections: Array<{ sectionType: string; visible: boolean }> }> };
  expect(stored.pages.flatMap((candidate) => candidate.sections)
    .filter((section) => section.sectionType === 'custom_design')).toHaveLength(1);
  monitor.assertClean();
  monitor.stop();
});

import {
  expect,
  test,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  chooseStarter,
  openFreshLab,
  readCustomDesignAssetRecordCounts,
  startRuntimeMonitor,
  waitForSaved,
} from './helpers';

type TestArtwork = {
  buffer: Buffer;
  mimeType: 'image/png';
  name: string;
};

type StoredCustomDesign = {
  id: string;
  label: string;
  order: number;
  sectionType: 'custom_design';
  settings: {
    displayMode: 'contained' | 'full_width' | 'poster';
    images: Array<{
      assetId: string;
      fileName: string;
      id: string;
      interactiveAreas: Array<{
        geometry: { height: number; width: number; x: number; y: number };
        id: string;
      }>;
    }>;
  };
  visible: boolean;
};

async function createArtwork(
  page: Page,
  name: string,
  title: string,
  hue: number,
  width = 1_200,
  height = 1_600,
): Promise<TestArtwork> {
  const bytes = await page.evaluate(async ({ height, hue, title, width }) => {
    const canvas = document.createElement('canvas');
    canvas.height = height;
    canvas.width = width;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');

    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${hue} 72% 89%)`);
    gradient.addColorStop(1, `hsl(${(hue + 42) % 360} 58% 62%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillRect(width * 0.08, height * 0.08, width * 0.84, height * 0.16);
    context.fillStyle = '#281f28';
    context.font = `700 ${Math.round(width * 0.07)}px system-ui`;
    context.textAlign = 'center';
    context.fillText(title, width / 2, height * 0.17, width * 0.72);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        candidate => candidate ? resolve(candidate) : reject(new Error('Encoding failed.')),
        'image/png',
      );
    });
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { height, hue, title, width });

  return {
    buffer: Buffer.from(bytes),
    mimeType: 'image/png',
    name,
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

async function addCustomDesign(page: Page): Promise<Locator> {
  const library = await openSectionLibrary(page);
  await library.getByRole('searchbox', { name: 'Search sections' }).fill('Canva');
  await library.getByRole('button', { name: 'Add Custom Design' }).click();
  const card = customDesignCard(page);
  await expect(card).toHaveCount(1);
  await expect(customDesignSettings(page)).toBeVisible();
  return card;
}

async function openSectionLibrary(page: Page): Promise<Locator> {
  const insertion = page.locator('button.final-insertion:visible').first();
  if (await insertion.isVisible()) {
    await insertion.focus();
    await page.keyboard.press('Enter');
  } else {
    const addSection = page.getByRole('button', { name: 'Add section', exact: true });
    await addSection.focus();
    await page.keyboard.press('Enter');
  }
  const library = page.getByRole('dialog', { name: 'Add section' });
  await expect(library).toBeVisible();
  return library;
}

async function uploadArtwork(
  card: Locator,
  files: readonly TestArtwork[],
): Promise<void> {
  await card.locator('input[type="file"][multiple]').setInputFiles([...files]);
  await expect(card.locator('.custom-design-image-frame')).toHaveCount(files.length, {
    timeout: 20_000,
  });
  await expect(
    card.locator('.custom-design-image-frame[data-image-render-state="loaded"]').first(),
  ).toBeVisible({ timeout: 20_000 });
}

async function openCustomDesignSettings(page: Page): Promise<Locator> {
  const card = customDesignCard(page);
  if (await card.getAttribute('data-selected') !== 'true') {
    await card.locator('.section-card__select-surface').click();
  }
  const returnButton = page.getByRole('button', { name: 'Back to Custom Design' });
  if (await returnButton.isVisible()) await returnButton.click();
  const edit = page.locator('[data-custom-design-settings-trigger-for]:visible');
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(customDesignSettings(page)).toBeVisible();
  return customDesignSettings(page);
}

async function closeSettings(page: Page): Promise<void> {
  const settings = customDesignSettings(page);
  const close = settings.getByRole('button', {
    name: /Close Custom Design(?: settings)?/,
  });
  await close.click();
  await expect(settings).toHaveCount(0);
}

async function readStoredCustomDesign(page: Page): Promise<StoredCustomDesign> {
  const section = await page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
      pages?: Array<{ sections?: unknown[] }>;
    };
    return document.pages
      ?.flatMap(candidate => candidate.sections ?? [])
      .find((candidate) => (
        candidate as { sectionType?: string }
      ).sectionType === 'custom_design') ?? null;
  }, LAB_STORAGE_KEY);
  if (!section) throw new Error('Stored Custom Design section was not found.');
  return section as StoredCustomDesign;
}

async function rowFileNames(settings: Locator): Promise<string[]> {
  return settings.locator('[data-image-item-id]').evaluateAll(rows => rows.map(row => (
    row.querySelector('.custom-design-owner-image-row__details [title]')?.textContent?.trim()
      ?? row.textContent?.trim()
      ?? ''
  )));
}

test.describe.configure({ mode: 'serial' });

test('warns before discarding dirty image order and returns focus to the visible new section', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const files = await Promise.all([
    createArtwork(page, 'page-a.png', 'PAGE A', 326),
    createArtwork(page, 'page-b.png', 'PAGE B', 20),
  ]);
  const card = await addCustomDesign(page);
  await uploadArtwork(card, files);

  let settings = customDesignSettings(page);
  await settings.getByRole('button', { name: 'Move page 1 down' }).click();
  await expect.poll(() => rowFileNames(settings)).toEqual(['page-b.png', 'page-a.png']);
  await settings.getByRole('button', { name: 'Close Custom Design settings' }).click();

  let warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await expect(warning.getByText('UNSAVED IMAGE ORDER')).toBeVisible();
  await warning.getByRole('button', { name: 'Keep editing' }).click();
  await expect(warning).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect.poll(() => rowFileNames(settings)).toEqual(['page-b.png', 'page-a.png']);

  await page.setViewportSize({ width: 390, height: 844 });
  warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Keep editing' }).click();
  settings = customDesignSettings(page);
  await expect(settings).toBeVisible();
  await expect.poll(() => rowFileNames(settings)).toEqual(['page-b.png', 'page-a.png']);

  await page.setViewportSize({ width: 1440, height: 900 });
  warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Keep editing' }).click();
  settings = customDesignSettings(page);
  await expect(settings).toBeVisible();

  await page.keyboard.press('Escape');
  warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await warning.getByRole('button', { name: 'Discard changes' }).click();
  await expect(settings).toHaveCount(0);
  await expect(card).toHaveAttribute('data-selected', 'true');
  await expect(card).toBeInViewport();
  const edit = page.locator('[data-custom-design-settings-trigger-for]:visible');
  await expect(edit).toBeFocused();

  settings = await openCustomDesignSettings(page);
  await expect.poll(() => rowFileNames(settings)).toEqual(['page-a.png', 'page-b.png']);
  await settings.getByRole('button', { name: 'Move page 1 down' }).click();
  await settings.getByRole('button', { name: 'Close Custom Design settings' }).click();
  warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await warning.getByRole('button', { name: 'Save order' }).click();
  await waitForSaved(page);
  expect((await readStoredCustomDesign(page)).settings.images.map(image => image.fileName))
    .toEqual(['page-b.png', 'page-a.png']);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitForSaved(page);
  expect((await readStoredCustomDesign(page)).settings.images.map(image => image.fileName))
    .toEqual(['page-a.png', 'page-b.png']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await waitForSaved(page);
  expect((await readStoredCustomDesign(page)).settings.images.map(image => image.fileName))
    .toEqual(['page-b.png', 'page-a.png']);

  monitor.assertClean();
  monitor.stop();
});

test('uses the same dirty-order warning for mobile Escape and backdrop dismissal', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const files = await Promise.all([
    createArtwork(page, 'mobile-a.png', 'MOBILE A', 300, 600, 900),
    createArtwork(page, 'mobile-b.png', 'MOBILE B', 40, 600, 900),
  ]);
  const card = await addCustomDesign(page);
  await uploadArtwork(card, files);
  let settings = customDesignSettings(page);

  await settings.getByRole('button', { name: 'Move page 1 down' }).click();
  await page.keyboard.press('Escape');
  let warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Keep editing' }).click();
  await expect(settings).toBeVisible();

  await page.reload();
  expect((await readStoredCustomDesign(page)).settings.images.map(image => image.fileName))
    .toEqual(['mobile-a.png', 'mobile-b.png']);
  settings = await openCustomDesignSettings(page);
  await settings.getByRole('button', { name: 'Move page 1 down' }).click();

  const settingsBackdrop = settings.locator('xpath=ancestor::div[contains(@class,"dialog-backdrop")]');
  const backdropBox = await settingsBackdrop.boundingBox();
  if (!backdropBox) throw new Error('The mobile settings backdrop is not measurable.');
  const backdropPoint = {
    x: backdropBox.x + 8,
    y: backdropBox.y + 8,
  };
  expect(await page.evaluate(({ x, y }) => (
    document.elementFromPoint(x, y)?.classList.contains('dialog-backdrop') ?? false
  ), backdropPoint)).toBe(true);
  await page.mouse.click(backdropPoint.x, backdropPoint.y);
  warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: 'Discard changes' }).click();
  await expect(settings).toHaveCount(0);

  settings = await openCustomDesignSettings(page);
  await expect.poll(() => rowFileNames(settings)).toEqual(['mobile-a.png', 'mobile-b.png']);
  await settings.getByRole('button', { name: 'Move page 1 down' }).click();
  await settings.getByRole('button', { name: 'Close Custom Design' }).click();
  warning = page.getByRole('dialog', { name: 'Save this page order?' });
  await warning.getByRole('button', { name: 'Save order' }).click();
  await waitForSaved(page);
  await page.reload();
  expect((await readStoredCustomDesign(page)).settings.images.map(image => image.fileName))
    .toEqual(['mobile-b.png', 'mobile-a.png']);

  monitor.assertClean();
  monitor.stop();
});

test('restores the exact removed Custom Design after reload without duplicating assets', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const artwork = await createArtwork(page, 'restore-me.png', 'RESTORE ME', 280);
  const card = await addCustomDesign(page);
  await uploadArtwork(card, [artwork]);

  const settings = customDesignSettings(page);
  const row = settings.locator('[data-image-item-id]').first();
  await row.getByRole('button', { name: 'Link areas' }).click();
  const hotspotEditor = page.getByRole('dialog', { name: 'Link areas' });
  await hotspotEditor.getByRole('button', { name: 'Add link area' }).click();
  await hotspotEditor.getByLabel('Accessible label').fill('Restore booking link');
  await hotspotEditor.getByLabel('I confirm this label explains the action').check();
  await hotspotEditor.getByRole('button', { name: 'Done' }).click();
  await row.getByRole('button', { name: 'Accessibility' }).click();
  const accessibility = page.getByRole('dialog', { name: 'Accessibility' });
  await accessibility.getByLabel('Alt text').fill('Original restore test artwork.');
  await accessibility.getByRole('button', { name: 'Save accessibility' }).click();
  await settings.getByLabel('Button type').selectOption('book');
  await settings.getByRole('button', { name: 'Save button' }).click();
  await closeSettings(page);
  await waitForSaved(page);

  const before = await readStoredCustomDesign(page);
  const beforeCounts = await readCustomDesignAssetRecordCounts(page);
  const actionsToolbar = page.getByLabel('Custom Design owner controls');
  await actionsToolbar.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('dialog', { name: 'Custom Design actions' })
    .getByRole('button', { name: 'Remove from page' })
    .click();
  await expect(customDesignCard(page)).toHaveCount(0);
  await waitForSaved(page);
  await page.reload();
  await expect(customDesignCard(page)).toHaveCount(0);

  const library = await openSectionLibrary(page);
  await library.getByRole('searchbox', { name: 'Search sections' }).fill('Custom Design');
  await expect(library.getByText('1 removed')).toBeVisible();
  await expect(library.getByRole('button', { name: 'Add another Custom Design' })).toBeVisible();
  await library.getByRole('button', { name: 'Restore removed Custom Design' }).click();
  await expect(customDesignCard(page)).toHaveCount(1);
  await waitForSaved(page);

  const after = await readStoredCustomDesign(page);
  expect(after).toEqual(before);
  expect(await readCustomDesignAssetRecordCounts(page)).toEqual(beforeCounts);
  await expect(customDesignCard(page).locator('.custom-design-image-frame[data-image-render-state="loaded"]'))
    .toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const restoredPreview = page.locator('[data-section-type="custom_design"]');
  await expect(restoredPreview.locator('.custom-design-image-frame[data-image-render-state="loaded"]'))
    .toBeVisible();
  await expect(restoredPreview.getByRole('button', { name: 'Restore booking link' }))
    .toBeVisible();
  await expect(restoredPreview.getByRole('button', { name: 'Book now' })).toBeVisible();

  monitor.assertClean();
  monitor.stop();
});

test('lists two removed Custom Designs separately and restores the selected instance', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');

  await addCustomDesign(page);
  await closeSettings(page);
  const firstId = await customDesignCard(page).getAttribute('data-section-instance-id');
  await page.getByLabel('Custom Design owner controls')
    .getByRole('button', { name: 'More', exact: true })
    .click();
  await page.getByRole('dialog', { name: 'Custom Design actions' })
    .getByRole('button', { name: 'Remove from page' })
    .click();

  let library = await openSectionLibrary(page);
  await library.getByRole('searchbox', { name: 'Search sections' }).fill('Custom Design');
  await library.getByRole('button', { name: 'Add another Custom Design' }).click();
  await expect(customDesignSettings(page)).toBeVisible();
  await closeSettings(page);
  const secondId = await customDesignCard(page).getAttribute('data-section-instance-id');
  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();
  expect(secondId).not.toBe(firstId);
  await page.getByLabel('Custom Design owner controls')
    .getByRole('button', { name: 'More', exact: true })
    .click();
  await page.getByRole('dialog', { name: 'Custom Design actions' })
    .getByRole('button', { name: 'Remove from page' })
    .click();
  await waitForSaved(page);
  await page.reload();

  const removedIds = await page.evaluate((key) => {
    const document = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
      unusedSections?: Array<{ id: string; sectionType: string }>;
    };
    return (document.unusedSections ?? [])
      .filter(section => section.sectionType === 'custom_design')
      .map(section => section.id);
  }, LAB_STORAGE_KEY);
  expect(new Set(removedIds)).toEqual(new Set([firstId, secondId]));

  library = await openSectionLibrary(page);
  await library.getByRole('searchbox', { name: 'Search sections' }).fill('Custom Design');
  const restoreButtons = library.getByRole('button', {
    name: /Restore removed Custom Design \d of 2/,
  });
  await expect(restoreButtons).toHaveCount(2);
  await restoreButtons.nth(1).click();
  await expect(customDesignCard(page)).toHaveAttribute(
    'data-section-instance-id',
    removedIds[1] ?? '',
  );

  library = await openSectionLibrary(page);
  await library.getByRole('searchbox', { name: 'Search sections' }).fill('Custom Design');
  await library.getByRole('button', { name: 'Restore removed Custom Design' }).click();
  expect(new Set(await customDesignCard(page).evaluateAll(cards => cards.map(card => (
    card.getAttribute('data-section-instance-id')
  ))))).toEqual(new Set([firstId, secondId]));

  monitor.assertClean();
  monitor.stop();
});

test('gives every radio an explicit value and renders Poster, Contained, and Full width distinctly', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const artwork = await createArtwork(page, 'display.png', 'DISPLAY MODES', 330);
  const card = await addCustomDesign(page);
  await uploadArtwork(card, [artwork]);
  let settings = customDesignSettings(page);

  await settings.locator('[data-image-item-id]').first()
    .getByRole('button', { name: 'Link areas' })
    .click();
  const hotspotEditor = page.getByRole('dialog', { name: 'Link areas' });
  await hotspotEditor.getByRole('button', { name: 'Add link area' }).click();
  await hotspotEditor.getByLabel('Accessible label').fill('Measured link area');
  await hotspotEditor.getByLabel('I confirm this label explains the action').check();
  await hotspotEditor.getByRole('button', { name: 'Done' }).click();
  await waitForSaved(page);
  await expect.poll(async () => (
    (await readStoredCustomDesign(page)).settings.images[0]?.interactiveAreas.length ?? 0
  )).toBe(1);
  const hotspotGeometry = (await readStoredCustomDesign(page))
    .settings.images[0]?.interactiveAreas[0]?.geometry;
  if (!hotspotGeometry) throw new Error('Measured hotspot geometry was not stored.');

  const expectedRadioValues = {
    'custom-design-background': ['site', 'transparent', 'custom'],
    'custom-design-display': ['poster', 'contained', 'full_width'],
    'custom-design-gap': ['seamless', 'small', 'comfortable'],
  };
  for (const [name, values] of Object.entries(expectedRadioValues)) {
    const radios = settings.locator(`input[type="radio"][name="${name}"]`);
    await expect(radios).toHaveCount(values.length);
    expect(await radios.evaluateAll(inputs => inputs.map(input => (
      input as HTMLInputElement
    ).value))).toEqual(values);
    for (const radio of await radios.all()) {
      await expect(radio).toHaveCSS('accent-color', 'rgb(155, 36, 84)');
    }
  }
  await settings.getByLabel('Button type').selectOption('book');
  await settings.getByRole('button', { name: 'Save button' }).click();
  await closeSettings(page);

  type DisplayMeasurement = {
    contentWidth: number;
    ctaAfterImage: boolean;
    ctaLeftMargin: number;
    ctaRightMargin: number;
    hotspotHeightRatio: number;
    hotspotWidthRatio: number;
    hotspotXRatio: number;
    hotspotYRatio: number;
    imageLeftMargin: number;
    imageRightMargin: number;
    imageWidth: number;
    siteWidth: number;
  };
  type DisplayMode = 'contained' | 'full_width' | 'poster';
  const measurements: Record<DisplayMode, Record<string, DisplayMeasurement>> = {
    contained: {},
    full_width: {},
    poster: {},
  };
  const browserViewports = [
    { height: 568, width: 320 },
    { height: 600, width: 375 },
    { height: 844, width: 390 },
    { height: 932, width: 430 },
    { height: 1024, width: 768 },
    { height: 390, width: 844 },
    { height: 800, width: 920 },
    { height: 800, width: 1180 },
    { height: 900, width: 1440 },
  ] as const;

  const measurePreview = async (): Promise<DisplayMeasurement> => {
    const previewSection = page.locator('[data-section-type="custom_design"]');
    const image = previewSection.locator('.custom-design-image-frame').first();
    const hotspot = previewSection.getByRole('button', { name: 'Measured link area' });
    const cta = previewSection.getByRole('button', { name: 'Book now' });
    await expect(image).toBeVisible();
    await expect(hotspot).toBeVisible();
    await expect(cta).toBeVisible();
    return page.evaluate(() => {
      const site = document.querySelector<HTMLElement>('.client-site');
      const content = document.querySelector<HTMLElement>('.client-page');
      const image = document.querySelector<HTMLElement>(
        '[data-section-type="custom_design"] .custom-design-image-frame',
      );
      const hotspot = document.querySelector<HTMLElement>(
        '[data-section-type="custom_design"] .custom-design-area-link',
      );
      const cta = document.querySelector<HTMLElement>(
        '[data-section-type="custom_design"] .custom-design-native-cta',
      );
      if (!site || !content || !image || !hotspot || !cta) {
        throw new Error('Display geometry is unavailable.');
      }
      const siteRect = site.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      const hotspotRect = hotspot.getBoundingClientRect();
      const ctaRect = cta.getBoundingClientRect();
      const contentStyle = getComputedStyle(content);
      return {
        contentWidth: contentRect.width
          - parseFloat(contentStyle.paddingLeft)
          - parseFloat(contentStyle.paddingRight),
        ctaAfterImage: Boolean(
          image.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
        ctaLeftMargin: ctaRect.left - siteRect.left,
        ctaRightMargin: siteRect.right - ctaRect.right,
        hotspotHeightRatio: hotspotRect.height / imageRect.height,
        hotspotWidthRatio: hotspotRect.width / imageRect.width,
        hotspotXRatio: (hotspotRect.x - imageRect.x) / imageRect.width,
        hotspotYRatio: (hotspotRect.y - imageRect.y) / imageRect.height,
        imageLeftMargin: imageRect.left - siteRect.left,
        imageRightMargin: siteRect.right - imageRect.right,
        imageWidth: imageRect.width,
        siteWidth: siteRect.width,
      };
    });
  };

  for (const mode of ['poster', 'contained', 'full_width'] as const satisfies readonly DisplayMode[]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    settings = await openCustomDesignSettings(page);
    await settings.locator(`input[name="custom-design-display"][value="${mode}"]`).check();
    await closeSettings(page);
    await waitForSaved(page);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();

    for (const viewport of browserViewports) {
      const simulatedDevice = viewport.width <= 430
        ? 'Phone'
        : viewport.width === 768
          ? 'Tablet'
          : 'Desktop';
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: simulatedDevice, exact: true }).click();
      await page.setViewportSize(viewport);
      const key = `viewport-${viewport.width}x${viewport.height}`;
      measurements[mode][key] = await measurePreview();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
        .toBe(true);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    for (const simulatedDevice of ['Phone', 'Tablet', 'Desktop'] as const) {
      await page.getByRole('button', { name: simulatedDevice, exact: true }).click();
      measurements[mode][`simulated-${simulatedDevice.toLowerCase()}`] = await measurePreview();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
        .toBe(true);
    }
    await page.getByRole('button', { name: 'Back to editor' }).click();
  }

  for (const key of Object.keys(measurements.poster)) {
    const poster = measurements.poster[key];
    const contained = measurements.contained[key];
    const fullWidth = measurements.full_width[key];
    if (!poster || !contained || !fullWidth) {
      throw new Error(`${key} did not measure every display mode.`);
    }
    expect(poster.imageWidth, `${key} Poster cap`).toBeLessThanOrEqual(781);
    expect(contained.imageWidth, `${key} Contained content bound`)
      .toBeLessThanOrEqual(contained.contentWidth + 1);
    expect(contained.imageLeftMargin, `${key} Contained left margin`).toBeGreaterThan(8);
    expect(contained.imageRightMargin, `${key} Contained right margin`).toBeGreaterThan(8);
    expect(fullWidth.imageWidth, `${key} Full width distinction`)
      .toBeGreaterThan(contained.imageWidth + 16);
    expect(fullWidth.imageWidth, `${key} Full width site edge`)
      .toBeCloseTo(fullWidth.siteWidth, 0);
    expect(Math.abs(fullWidth.imageLeftMargin), `${key} Full width left edge`)
      .toBeLessThanOrEqual(1);
    expect(Math.abs(fullWidth.imageRightMargin), `${key} Full width right edge`)
      .toBeLessThanOrEqual(1);

    for (const [mode, measurement] of Object.entries({ poster, contained, fullWidth })) {
      expect(measurement.ctaAfterImage, `${key} ${mode} CTA placement`).toBe(true);
      expect(measurement.ctaLeftMargin, `${key} ${mode} CTA left safe area`)
        .toBeGreaterThanOrEqual(15);
      expect(measurement.ctaRightMargin, `${key} ${mode} CTA right safe area`)
        .toBeGreaterThanOrEqual(15);
      expect(measurement.hotspotXRatio, `${key} ${mode} hotspot x`)
        .toBeCloseTo(hotspotGeometry.x / 100, 2);
      expect(measurement.hotspotYRatio, `${key} ${mode} hotspot y`)
        .toBeCloseTo(hotspotGeometry.y / 100, 2);
      expect(measurement.hotspotWidthRatio, `${key} ${mode} hotspot width`)
        .toBeCloseTo(hotspotGeometry.width / 100, 2);
      expect(measurement.hotspotHeightRatio, `${key} ${mode} hotspot height`)
        .toBeCloseTo(hotspotGeometry.height / 100, 2);
    }
  }

  monitor.assertClean();
  monitor.stop();
});

test('explains the ten-image capacity when only part of a multi-file upload fits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const firstNine = await Promise.all(Array.from({ length: 9 }, (_, index) => (
    createArtwork(
      page,
      `capacity-${index + 1}.png`,
      `PAGE ${index + 1}`,
      300 + index * 4,
      240,
      240,
    )
  )));
  const overflow = await Promise.all(Array.from({ length: 3 }, (_, index) => (
    createArtwork(
      page,
      `overflow-${index + 1}.png`,
      `EXTRA ${index + 1}`,
      20 + index * 8,
      240,
      240,
    )
  )));
  const card = await addCustomDesign(page);
  await uploadArtwork(card, firstNine);
  const settings = customDesignSettings(page);
  await settings.locator('input[type="file"][multiple]').setInputFiles(overflow);
  await expect(settings.locator('[data-image-item-id]')).toHaveCount(10, {
    timeout: 20_000,
  });
  await expect(settings.getByRole('status').filter({
    hasText: 'This section can contain up to 10 images.',
  })).toContainText(
    '1 image was added and 2 were skipped because the section is full.',
  );
  await expect.poll(async () => (
    (await readStoredCustomDesign(page)).settings.images.length
  )).toBe(10);

  monitor.assertClean();
  monitor.stop();
});

test('blocks near-full and overlapping clickable areas until geometry is fixed or cancelled', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const monitor = startRuntimeMonitor(page);
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const artwork = await createArtwork(page, 'area-safety.png', 'SAFE LINKS', 315, 800, 800);
  const card = await addCustomDesign(page);
  await uploadArtwork(card, [artwork]);
  const settings = customDesignSettings(page);
  await settings.locator('[data-image-item-id]').first()
    .getByRole('button', { name: 'Link areas' })
    .click();
  let editor = page.getByRole('dialog', { name: 'Link areas' });
  await editor.getByRole('button', { name: 'Add link area' }).click();
  await editor.getByLabel('Accessible label').fill('Primary safe area');
  await editor.getByLabel('I confirm this label explains the action').check();

  const stage = editor.locator('.custom-design-owner-hotspot-stage');
  await stage.scrollIntoViewIfNeeded();
  const move = editor.getByRole('button', { name: 'Move clickable area: Primary safe area' });
  await move.scrollIntoViewIfNeeded();
  const stageBox = await stage.boundingBox();
  const moveBox = await move.boundingBox();
  if (!stageBox || !moveBox) throw new Error('Hotspot stage was not measurable.');
  await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + 1, stageBox.y + 1);
  await page.mouse.up();

  let resize = editor.getByRole('button', {
    name: 'Resize Primary safe area from south east',
  });
  await resize.scrollIntoViewIfNeeded();
  const expandedStageBox = await stage.boundingBox();
  let resizeBox = await resize.boundingBox();
  if (!resizeBox || !expandedStageBox) throw new Error('Hotspot resize handle was not measurable.');
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    expandedStageBox.x + expandedStageBox.width - 1,
    expandedStageBox.y + expandedStageBox.height - 1,
  );
  await page.mouse.up();
  await expect(editor.getByText(/cannot cover nearly the whole image/i).first()).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Done' })).toBeDisabled();

  resize = editor.getByRole('button', { name: 'Resize Primary safe area from south east' });
  await resize.scrollIntoViewIfNeeded();
  const fixedStageBox = await stage.boundingBox();
  resizeBox = await resize.boundingBox();
  if (!resizeBox || !fixedStageBox) {
    throw new Error('Hotspot resize handle was not measurable after rejection.');
  }
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    fixedStageBox.x + fixedStageBox.width * 0.55,
    fixedStageBox.y + fixedStageBox.height * 0.45,
  );
  await page.mouse.up();
  await expect(editor.getByRole('button', { name: 'Done' })).toBeEnabled();
  await editor.getByRole('button', { name: 'Done' }).click();

  await settings.locator('[data-image-item-id]').first()
    .getByRole('button', { name: 'Link areas' })
    .click();
  editor = page.getByRole('dialog', { name: 'Link areas' });
  await editor.getByRole('button', { name: 'Add link area' }).click();
  await editor.getByLabel('Accessible label').fill('Second safe area');
  await editor.getByLabel('I confirm this label explains the action').check();
  const secondMove = editor.getByRole('button', { name: 'Move clickable area: Second safe area' });
  await secondMove.focus();
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Shift+ArrowUp');
  }
  await expect(editor.getByText(/Primary safe area overlaps Second safe area|Second safe area overlaps Primary safe area/).first())
    .toBeVisible();
  await expect(editor.getByRole('button', { name: 'Done' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveCount(0);
  expect((await readStoredCustomDesign(page)).settings.images[0]?.interactiveAreas).toHaveLength(1);

  monitor.assertClean();
  monitor.stop();
});

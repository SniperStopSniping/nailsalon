import { expect, test } from '@playwright/test';

import {
  addSectionAtBottom,
  chooseStarter,
  enterReorder,
  expectNoDocumentOverflow,
  openFreshLab,
  reorderLabels,
  requireProject,
  sectionLabels,
} from './helpers';

test('keyboard reorder commits DOM order and a truthful announcement', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await enterReorder(page);

  const handle = page.getByRole('button', {
    name: 'Drag Section 02. Use arrow keys after lifting with Space.',
  });
  await handle.focus();
  await expect(handle).toBeFocused();
  await handle.press('Space');
  await handle.press('ArrowUp');
  await expect
    .poll(() => handle.locator('..').getAttribute('style'))
    .toContain('translate3d(0px, -');
  await handle.press('Space');

  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 02',
    'Section 01',
    'Booking access',
  ]);
  await expect(page.getByTestId('reorder-live-region')).toHaveText(
    'Section 02 moved to position 1 of 3.',
  );
  await expect(
    page.getByRole('button', {
      name: 'Drag Section 02. Use arrow keys after lifting with Space.',
    }),
  ).toBeFocused();
});

test('Cancel restores the reorder baseline without erasing earlier history', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await addSectionAtBottom(page, 'Home', 11);

  await enterReorder(page);
  await page.getByRole('button', { name: 'Move Section 11 up' }).click();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Section 11',
    'Booking access',
  ]);

  await page
    .locator('.final-reorder-desktop-actions')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking access',
    'Section 11',
  ]);

  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking access',
  ]);
});

test('mobile touch drag activates only from the deliberate handle', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'mobile-chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await enterReorder(page);

  const source = page.getByRole('button', {
    name: 'Drag Section 02. Use arrow keys after lifting with Space.',
  });
  const target = page.getByRole('button', {
    name: 'Drag Section 01. Use arrow keys after lifting with Space.',
  });
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  expect(sourceBox?.width).toBeGreaterThanOrEqual(44);
  expect(sourceBox?.height).toBeGreaterThanOrEqual(44);

  const session = await page.context().newCDPSession(page);
  const sourcePoint = {
    x: (sourceBox?.x ?? 0) + (sourceBox?.width ?? 0) / 2,
    y: (sourceBox?.y ?? 0) + (sourceBox?.height ?? 0) / 2,
  };
  const targetPoint = {
    x: (targetBox?.x ?? 0) + (targetBox?.width ?? 0) / 2,
    y: (targetBox?.y ?? 0) + (targetBox?.height ?? 0) / 2,
  };
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [sourcePoint],
    type: 'touchStart',
  });
  await page.waitForTimeout(220);
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [targetPoint],
    type: 'touchMove',
  });
  await page.waitForTimeout(80);
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  });

  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 02',
    'Section 01',
    'Booking access',
  ]);
  await expect(page.getByTestId('reorder-live-region')).toHaveText(
    'Section 02 moved to position 1 of 3.',
  );
});

test('320px, 375x600, and 200% zoom layouts avoid document overflow and retain preview controls', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');

  const scenarios = [
    { height: 700, label: '320px', width: 320, zoom: '1' },
    { height: 600, label: '375x600', width: 375, zoom: '1' },
    { height: 900, label: '200% zoom', width: 750, zoom: '2' },
  ] as const;

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await openFreshLab(page);
    await page.evaluate((zoom) => {
      document.documentElement.style.zoom = zoom;
    }, scenario.zoom);
    await chooseStarter(page, 'Quick Book');
    await expectNoDocumentOverflow(page);

    if (scenario.zoom === '1') {
      const pagesTrigger = page.getByRole('button', {
        name: 'Open Pages & Structure for Home',
      });
      await expect(pagesTrigger).toBeVisible();
      await pagesTrigger.click();
      const pagesDialog = page.getByRole('dialog', { name: 'Pages & Structure' });
      await expect(pagesDialog).toBeVisible();
      await expect(pagesDialog.getByRole('list', { name: 'Site pages' })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await page.keyboard.press('Escape');
    }

    await page.getByRole('button', { name: 'Preview' }).click();
    await page
      .getByRole('group', { name: 'Preview viewport' })
      .getByRole('button', { name: 'Phone' })
      .click();
    await expect(page.getByTestId('preview-stage')).toHaveClass(/preview-stage--mobile/);
    await expectNoDocumentOverflow(page);
  }
});

test('Reset Lab returns to the chooser where an exported document can be imported', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const savedDocument = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    'luster.site-builder-v2-lab.schema-1',
  );
  expect(savedDocument).toBeTruthy();

  await page.getByRole('button', { name: 'More site options' }).click();
  await page
    .getByRole('dialog', { name: 'More' })
    .getByRole('button', { name: 'Reset Lab' })
    .click();
  await page
    .getByRole('dialog', { name: 'Reset the entire Lab?' })
    .getByRole('button', { name: 'Reset Lab' })
    .click();

  await expect(
    page.getByRole('heading', { name: 'Choose your starting point' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import JSON' })).toBeVisible();
  await page.getByLabel('Import site JSON file').setInputFiles({
    buffer: Buffer.from(savedDocument as string),
    mimeType: 'application/json',
    name: 'quick-book-lab.json',
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Site restored from imported JSON.' }),
  ).toBeVisible();
});

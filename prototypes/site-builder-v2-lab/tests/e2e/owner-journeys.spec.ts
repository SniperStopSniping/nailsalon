import { readFile } from 'node:fs/promises';

import { expect, test, type Locator } from '@playwright/test';

import {
  LAB_STORAGE_KEY,
  addPage,
  addSectionAtBottom,
  chooseStarter,
  openFreshLab,
  pageNames,
  removePage,
  reorderLabels,
  requireProject,
  sectionLabels,
  sectionsList,
  selectPage,
  startAgain,
} from './helpers';

async function openSectionMoreActions(
  sectionCard: Locator,
  sectionLabel: string,
): Promise<void> {
  const selectSurface = sectionCard.locator('.section-card__select-surface');
  await selectSurface.focus();
  await selectSurface.press('Enter');
  const more = sectionCard.getByRole('button', { name: `More actions for ${sectionLabel}` });
  await more.focus();
  await more.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
}

test.describe('starter kits share the universal editor', () => {
  const starters = [
    {
      name: 'Quick Book' as const,
      navigation: false,
      pages: ['Home'],
      sections: ['Section 01', 'Section 02', 'Booking access'],
    },
    {
      name: 'One-page website' as const,
      navigation: true,
      pages: ['Home'],
      sections: [
        'Section 01',
        'Section 02',
        'Section 03',
        'Section 04',
        'Section 05',
        'Booking access',
      ],
    },
    {
      name: 'Multi-page website' as const,
      navigation: true,
      pages: ['Home', 'Services / Book', 'Gallery', 'About', 'Contact'],
      sections: ['Section 01', 'Section 02'],
    },
  ];

  for (const starter of starters) {
    test(`${starter.name} has its defaults and the same editor capabilities`, async ({
      page,
    }, testInfo) => {
      requireProject(testInfo, 'chromium');
      await openFreshLab(page);
      await chooseStarter(page, starter.name);

      await expect(pageNames(page)).resolves.toEqual(starter.pages);
      await expect(sectionLabels(page, 'Home')).resolves.toEqual(starter.sections);
      await expect(page.getByRole('switch', { name: 'Navigation menu' })).toHaveAttribute(
        'aria-checked',
        String(starter.navigation),
      );

      const modes = page.getByRole('group', { name: 'Editor modes' });
      await expect(modes.getByRole('button', { name: 'Edit' })).toBeVisible();
      await expect(modes.getByRole('button', { name: 'Reorder' })).toBeVisible();
      await expect(modes.getByRole('button', { name: 'Preview' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add page', exact: true })).toBeEnabled();
      await expect(
        page.getByRole('button', { name: 'Add section at top of Home' }),
      ).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    });
  }
});

test('Quick Book completes the core owner composition, recovery, persistence, export, import, and preview journey', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  test.slow();

  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking access',
  ]);

  for (const number of [11, 12, 13, 14, 15]) {
    await addSectionAtBottom(page, 'Home', number);
  }
  await expect(sectionLabels(page, 'Home')).resolves.toEqual([
    'Section 01',
    'Section 02',
    'Booking access',
    'Section 11',
    'Section 12',
    'Section 13',
    'Section 14',
    'Section 15',
  ]);

  const section11 = sectionsList(page, 'Home').getByRole('listitem', {
    name: 'Section 11 on Home',
  });
  const section11Id = await section11.getAttribute('data-section-instance-id');
  expect(section11Id).toBeTruthy();

  await page
    .getByRole('group', { name: 'Editor modes' })
    .getByRole('button', { name: 'Reorder' })
    .click();
  await page
    .getByRole('button', {
      name: 'Move Section 11 by number, current position 4',
    })
    .click();
  const positionDialog = page.getByRole('dialog', { name: 'Move Section 11' });
  await expect(positionDialog).toContainText(/Current position:\s*4/);
  await positionDialog.getByLabel('Move to position').fill('2');
  await positionDialog
    .getByRole('button', { name: 'Move section', exact: true })
    .click();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 01',
    'Section 11',
    'Section 02',
    'Booking access',
    'Section 12',
    'Section 13',
    'Section 14',
    'Section 15',
  ]);
  await expect(page.getByTestId('reorder-live-region')).toHaveText(
    'Section 11 moved to position 2 of 8.',
  );

  await page.getByRole('button', { name: 'Move Section 12 up' }).click();
  await expect(reorderLabels(page)).resolves.toEqual([
    'Section 01',
    'Section 11',
    'Section 02',
    'Section 12',
    'Booking access',
    'Section 13',
    'Section 14',
    'Section 15',
  ]);
  await expect(page.getByTestId('reorder-live-region')).toHaveText(
    'Section 12 moved to position 4 of 8.',
  );
  await page
    .locator('.canvas-frame > .dialog-actions')
    .getByRole('button', { name: 'Done' })
    .click();

  const section02 = sectionsList(page, 'Home').getByRole('listitem', {
    name: 'Section 02 on Home',
  });
  const section02Id = await section02.getAttribute('data-section-instance-id');
  await openSectionMoreActions(section02, 'Section 02');
  await section02.locator('.section-more-menu').getByRole('button', { name: 'Remove from this page' }).click({ force: true });
  const removalToast = page
    .getByRole('status')
    .filter({ hasText: 'Section removed · Undo' });
  await expect(removalToast).toBeVisible();
  await expect(section02).toHaveCount(0);
  await removalToast.getByRole('button', { name: 'Undo' }).click();
  const restoredSection02 = sectionsList(page, 'Home').getByRole('listitem', {
    name: 'Section 02 on Home',
  });
  await expect(restoredSection02).toHaveAttribute(
    'data-section-instance-id',
    section02Id ?? '',
  );

  // The five additions above bring Quick Book from 3 to 8 sections. Add
  // three more here so the browser proof genuinely crosses ten sections.
  for (const number of [16, 17, 18]) {
    await addSectionAtBottom(page, 'Home', number);
  }
  await expect(sectionLabels(page, 'Home')).resolves.toHaveLength(11);

  await addPage(page, 'Gallery');
  const navigationPrompt = page.getByRole('dialog', {
    name: 'Add navigation menu?',
  });
  await expect(
    navigationPrompt.getByText(
      'You now have more than one page. Add a navigation menu?',
    ),
  ).toBeVisible();
  await navigationPrompt
    .getByRole('button', { name: 'Add navigation', exact: true })
    .click();
  await expect(page.getByRole('switch', { name: 'Navigation menu' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  await selectPage(page, 'Home');
  const section11OnHome = sectionsList(page, 'Home').getByRole('listitem', {
    name: 'Section 11 on Home',
  });
  await openSectionMoreActions(section11OnHome, 'Section 11');
  await section11OnHome.locator('.section-more-menu').getByRole('button', { name: 'Move', exact: true }).click({ force: true });
  await page
    .getByRole('dialog', { name: 'Move Section 11 to another page' })
    .getByRole('button', { name: 'Gallery', exact: true })
    .click();
  await expect(
    sectionsList(page, 'Gallery').getByRole('listitem', {
      name: 'Section 11 on Gallery',
    }),
  ).toHaveAttribute('data-section-instance-id', section11Id ?? '');

  await addPage(page, 'Contact');
  await page.getByRole('button', { name: 'Open navigation settings' }).click();
  const navigationSettings = page.getByRole('dialog', {
    name: 'Navigation settings',
  });
  await navigationSettings
    .getByRole('button', { name: 'Move Contact up in navigation' })
    .click();
  await expect(
    navigationSettings
      .getByRole('list', { name: 'Navigation items' })
      .locator(':scope > li .form-field > span'),
  ).toHaveText(['1. Home', '2. Contact', '3. Gallery']);
  await navigationSettings.getByRole('button', { name: 'Done' }).click();

  await removePage(page, 'Gallery');
  await expect(pageNames(page)).resolves.toEqual(['Home', 'Contact']);
  await expect(
    page
      .getByRole('list', { name: 'Unused sections' })
      .locator(`[data-section-id="${section11Id}"]`),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Restore Gallery page' }).click();
  const restoredSection11 = sectionsList(page, 'Gallery').getByRole('listitem', {
    name: 'Section 11 on Gallery',
  });
  await expect(restoredSection11).toHaveAttribute(
    'data-section-instance-id',
    section11Id ?? '',
  );
  await expect(
    page
      .getByRole('list', { name: 'Unused sections' })
      .locator(`[data-section-id="${section11Id}"]`),
  ).toHaveCount(0);

  await page
    .getByRole('group', { name: 'Editor modes' })
    .getByRole('button', { name: 'Preview' })
    .click();
  await expect(page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Preview viewport' })
    .getByRole('button', { name: 'Mobile' })
    .click();
  await expect(page.getByTestId('preview-stage')).toHaveClass(/preview-stage--mobile/);
  await page
    .getByRole('group', { name: 'Preview viewport' })
    .getByRole('button', { name: 'Desktop' })
    .click();
  await expect(page.getByTestId('preview-stage')).toHaveClass(/preview-stage--desktop/);
  await page
    .getByRole('navigation', { name: 'Preview site navigation' })
    .getByRole('button', { name: 'Home' })
    .click();
  await expect(page.getByRole('main', { name: 'Home preview' })).toContainText(
    'Booking access',
  );
  await page.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved');
  const persistedBeforeReload = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    LAB_STORAGE_KEY,
  );
  expect(persistedBeforeReload).toBeTruthy();
  await page.reload();
  await expect(pageNames(page)).resolves.toEqual(['Home', 'Gallery', 'Contact']);
  await expect(
    page
      .getByRole('list', { name: 'Navigation order' })
      .locator(':scope > li strong')
      .allTextContents(),
  ).resolves.toEqual(['Home', 'Contact', 'Gallery']);
  await selectPage(page, 'Gallery');
  await expect(
    sectionsList(page, 'Gallery').getByRole('listitem', {
      name: 'Section 11 on Gallery',
    }),
  ).toHaveAttribute('data-section-instance-id', section11Id ?? '');

  await page.getByRole('button', { name: 'Lab options' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Lab options' })
    .getByRole('button', { name: 'Export JSON' })
    .click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const exported = await readFile(downloadPath as string, 'utf8');
  const exportedDocument = JSON.parse(exported) as {
    originStarter: string;
    pages: Array<{ name: string }>;
    schemaVersion: number;
  };
  expect(exportedDocument.schemaVersion).toBe(1);
  expect(exportedDocument.originStarter).toBe('quick_book');
  expect(exportedDocument.pages.map((candidate) => candidate.name)).toEqual([
    'Home',
    'Gallery',
    'Contact',
  ]);

  await page.getByRole('button', { name: 'Lab options' }).click();
  await page
    .getByRole('dialog', { name: 'Lab options' })
    .getByRole('button', { name: 'Reset Lab' })
    .click();
  await page
    .getByRole('dialog', { name: 'Reset the entire Lab?' })
    .getByRole('button', { name: 'Reset Lab' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Choose your starting point' }),
  ).toBeVisible();
  await page.getByLabel('Import site JSON file').setInputFiles(downloadPath as string);
  await expect(
    page.getByRole('status').filter({ hasText: 'Site restored from imported JSON.' }),
  ).toBeVisible();
  await expect(pageNames(page)).resolves.toEqual(['Home', 'Gallery', 'Contact']);
  await selectPage(page, 'Gallery');
  await expect(
    sectionsList(page, 'Gallery').getByRole('listitem', {
      name: 'Section 11 on Gallery',
    }),
  ).toHaveAttribute('data-section-instance-id', section11Id ?? '');
});

test('One-page can add pages and Multi-page can simplify to one page without losing booking', async ({
  page,
}, testInfo) => {
  requireProject(testInfo, 'chromium');
  test.slow();

  await openFreshLab(page);
  await chooseStarter(page, 'One-page website');
  await expect(sectionLabels(page, 'Home')).resolves.toHaveLength(6);
  await expect(page.getByRole('switch', { name: 'Navigation menu' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await addPage(page, 'Gallery');
  await expect(page.getByRole('dialog', { name: 'Add navigation menu?' })).toHaveCount(0);
  await addSectionAtBottom(page, 'Gallery', 11);
  await expect(sectionLabels(page, 'Gallery')).resolves.toEqual(['Section 11']);

  await startAgain(page, 'Multi-page website');
  await expect(pageNames(page)).resolves.toEqual([
    'Home',
    'Services / Book',
    'Gallery',
    'About',
    'Contact',
  ]);

  for (const pageName of ['Gallery', 'About', 'Contact']) {
    await removePage(page, pageName);
  }
  await expect(pageNames(page)).resolves.toEqual(['Home', 'Services / Book']);

  await page.getByRole('button', { name: 'Remove Services / Book page' }).click();
  await page
    .getByRole('dialog', { name: 'Remove this page?' })
    .getByRole('button', { name: 'Remove page' })
    .click();
  const protectedDialog = page.getByRole('dialog', {
    name: 'Booking access is protected',
  });
  await expect(protectedDialog).toContainText(
    'Your site needs at least one way for clients to book.',
  );
  await expect(protectedDialog).toContainText(
    'Add another Booking access section or Book page before removing this one.',
  );
  await protectedDialog.getByRole('button', { name: 'Keep booking access' }).click();
  await expect(page.getByRole('dialog', { name: 'Remove this page?' })).toHaveCount(0);

  await selectPage(page, 'Services / Book');
  const bookingOnServices = sectionsList(page, 'Services / Book').getByRole('listitem', {
    name: 'Booking access on Services / Book',
  });
  await openSectionMoreActions(bookingOnServices, 'Booking access');
  await bookingOnServices.locator('.section-more-menu').getByRole('button', { name: 'Move', exact: true }).click({ force: true });
  await page
    .getByRole('dialog', { name: 'Move Booking access to another page' })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await removePage(page, 'Services / Book');
  await expect(pageNames(page)).resolves.toEqual(['Home']);
  await expect(
    sectionsList(page, 'Home').getByRole('listitem', {
      name: 'Booking access on Home',
    }),
  ).toBeVisible();

  const bookingOnHome = sectionsList(page, 'Home').getByRole('listitem', {
    name: 'Booking access on Home',
  });
  await openSectionMoreActions(bookingOnHome, 'Booking access');
  await bookingOnHome.locator('.section-more-menu').getByRole('button', { name: 'Remove from this page' }).click({ force: true });
  await expect(
    page.getByRole('dialog', { name: 'Booking access is protected' }),
  ).toContainText('Your site needs at least one way for clients to book.');
});

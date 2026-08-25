import { chromium } from '@playwright/test';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const baseUrl = process.env.LUSTER_FINAL_HYBRID_URL ?? 'http://127.0.0.1:4180';
const outputRoot = resolve('artifacts/final-hybrid');
const documentKey = 'luster.site-builder-v2-lab.schema-1';

const desktopViewport = { height: 1000, width: 1440 };
const mobileViewport = { height: 812, width: 375 };

const paths = {
  desktopDefault: join(outputRoot, '12-desktop-default-editor.png'),
  desktopPreview: join(outputRoot, '17-desktop-preview.png'),
  mobileDefault: join(outputRoot, '02-mobile-default-editor.png'),
  mobilePreview: join(outputRoot, '09-mobile-preview.png'),
  mobileReorder: join(outputRoot, '08-mobile-reorder.png'),
};

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(180);
}

async function capture(page, filename, { fullPage = false } = {}) {
  const path = join(outputRoot, filename);
  // Keep incidental mouse/focus position from manufacturing a hover state in
  // otherwise-clean editor evidence. Selected-state styling is document UI
  // state and remains visible after this neutral reset.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(60);
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage,
    path,
  });
  return path;
}

async function firstVisible(locator, description) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) {
      return candidate;
    }
  }
  throw new Error(`Could not find a visible ${description}.`);
}

async function showStarterChooser(page) {
  await page.goto(baseUrl);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.getByRole('heading', { name: 'Choose your starting point' }).waitFor();
  await settle(page);
}

async function chooseCanonicalQuickBook(page) {
  await page.getByRole('button', { name: /^Quick Book/ }).click();
  await page.getByRole('button', { name: 'Open Pages & Structure for Home' }).waitFor();
  await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, documentKey);
  await settle(page);

  const serialized = await page.evaluate((key) => window.localStorage.getItem(key), documentKey);
  if (!serialized) {
    throw new Error('Could not create the canonical Quick Book document.');
  }
  return serialized;
}

async function installCanonicalDocument(page, serializedDocument) {
  await page.goto(baseUrl);
  await page.evaluate(
    ({ key, serialized }) => {
      window.localStorage.clear();
      window.localStorage.setItem(key, serialized);
    },
    { key: documentKey, serialized: serializedDocument },
  );
  await page.reload();
  await page.getByRole('button', { name: 'Open Pages & Structure for Home' }).waitFor();
  await settle(page);
}

async function assertCanonicalDocument(page, serializedDocument, stateName) {
  const actual = await page.evaluate((key) => window.localStorage.getItem(key), documentKey);
  if (!actual || JSON.stringify(JSON.parse(actual)) !== JSON.stringify(JSON.parse(serializedDocument))) {
    throw new Error(`${stateName} changed the canonical Quick Book document.`);
  }
}

function firstSection(page) {
  return page.locator('[data-section-label="Section 01"]').first();
}

async function selectSection01(page) {
  const section = firstSection(page);
  await section.waitFor();
  const selectSurface = section.locator('.section-card__select-surface');
  if (await selectSurface.count()) {
    await selectSurface.click();
  } else {
    await section.getByRole('button', { name: /Section 01/ }).first().click();
  }
  await section.evaluate((element) => {
    if (!element.matches('.is-selected, [aria-selected="true"], [data-selected="true"]')) {
      throw new Error('Section 01 did not expose an accessible/visible selected state.');
    }
  });
  await settle(page);
}

async function clickSelectedAction(page, name) {
  const labelledActionBar = page.locator(
    '[aria-label*="Section 01"][aria-label*="action" i], .mobile-section-action-bar, .section-context-toolbar',
  );
  const actions = labelledActionBar.getByRole('button', { exact: true, name });
  const actionCount = await actions.count();
  for (let index = 0; index < actionCount; index += 1) {
    const action = actions.nth(index);
    if (await action.isVisible()) {
      await action.click();
      return;
    }
  }
  const fallback = await firstVisible(
    page.getByRole('button', { exact: true, name }),
    `${name} action for the selected section`,
  );
  await fallback.click();
}

async function openEditSurface(page) {
  await selectSection01(page);
  await clickSelectedAction(page, 'Edit');
  await page.getByRole('dialog', { name: /^Edit Section 01$/i }).waitFor();
  await settle(page);
}

async function openMoveSheet(page) {
  await selectSection01(page);
  await clickSelectedAction(page, 'Move');
  await page.getByRole('dialog', { name: /^Move Section 01/i }).waitFor();
  await settle(page);
}

async function openSectionLibrary(page) {
  const addSection = await firstVisible(
    page.getByRole('button', { exact: true, name: 'Add section' }),
    'primary Add section button',
  );
  await addSection.click();
  await page.getByRole('dialog', { name: 'Add section' }).waitFor();
  await settle(page);
}

async function openPagesAndStructure(page) {
  await page.getByRole('button', { name: 'Open Pages & Structure for Home' }).click();
  await page.getByRole('dialog', { name: 'Pages & Structure' }).waitFor();
  await settle(page);
}

async function enterReorder(page) {
  const reorderButtons = page.getByRole('button', { name: 'Reorder sections' });
  let directlyVisible = null;
  for (let index = 0; index < await reorderButtons.count(); index += 1) {
    if (await reorderButtons.nth(index).isVisible()) {
      directlyVisible = reorderButtons.nth(index);
      break;
    }
  }
  if (directlyVisible) {
    await directlyVisible.click();
  } else {
    await openPagesAndStructure(page);
    await page.getByRole('dialog', { name: 'Pages & Structure' })
      .getByRole('button', { name: 'Reorder sections' })
      .click();
  }
  await page.getByTestId('reorder-list').waitFor();
  await firstVisible(page.getByRole('button', { exact: true, name: 'Cancel' }), 'Reorder Cancel button');
  await firstVisible(page.getByRole('button', { exact: true, name: 'Done' }), 'Reorder Done button');
  await settle(page);
}

async function enterPreview(page, viewport) {
  const preview = await firstVisible(
    page.getByRole('button', { exact: true, name: 'Preview' }),
    'Preview button',
  );
  await preview.click();
  const deviceControl = page.getByRole('group', { name: 'Preview viewport' });
  await deviceControl.waitFor();
  await deviceControl.getByRole('button', { exact: true, name: viewport }).click();
  await page.getByRole('button', { name: 'Back to editor' }).waitFor();
  await settle(page);
}

async function enableRealHeightSimulation(page) {
  await page.getByRole('button', { name: 'More site options' }).click();
  const control = page.getByLabel('Simulate real section heights');
  await control.waitFor();
  const checked = await control.getAttribute('aria-checked');
  const pressed = await control.getAttribute('aria-pressed');
  if (checked !== 'true' && pressed !== 'true') {
    await control.click();
  }
  await page.keyboard.press('Escape');
  await settle(page);
}

async function composeComparison(browser) {
  const context = await browser.newContext({ viewport: { height: 860, width: 2420 } });
  const page = await context.newPage();
  const items = await Promise.all([
    { label: 'Mobile Edit', path: paths.mobileDefault, type: 'mobile' },
    { label: 'Mobile Reorder', path: paths.mobileReorder, type: 'mobile' },
    { label: 'Mobile Preview', path: paths.mobilePreview, type: 'mobile' },
    { label: 'Desktop Edit', path: paths.desktopDefault, type: 'desktop' },
    { label: 'Desktop Preview', path: paths.desktopPreview, type: 'desktop' },
  ].map(async (item) => ({
    ...item,
    data: (await readFile(item.path)).toString('base64'),
  })));

  await page.setContent(`<!doctype html>
    <html><head><style>
      *{box-sizing:border-box}
      body{margin:0;padding:34px;background:#1f1b1d;color:#fff;font-family:Inter,Arial,sans-serif}
      h1{margin:0 0 24px;font-family:Georgia,serif;font-size:36px;font-weight:500;letter-spacing:-.02em}
      .grid{display:grid;grid-template-columns:repeat(3,330px) repeat(2,660px);gap:20px;align-items:start}
      figure{margin:0;padding:10px;border:1px solid #494044;border-radius:18px;background:#2c2729;box-shadow:0 20px 48px #0005}
      figcaption{height:42px;padding:7px 4px 11px;color:#f7e9ee;font-size:17px;font-weight:800}
      img{display:block;width:100%;height:690px;object-fit:contain;object-position:top;border-radius:10px;background:#f8f5f0}
      figure.desktop img{height:458px}
    </style></head><body>
      <h1>Final hybrid editor — same Quick Book document</h1>
      <div class="grid">${items.map((item) => `
        <figure class="${item.type}">
          <figcaption>${item.label}</figcaption>
          <img alt="" src="data:image/png;base64,${item.data}">
        </figure>`).join('')}
      </div>
    </body></html>`);
  await page.screenshot({ fullPage: true, path: join(outputRoot, 'final-hybrid-five-state-comparison.png') });
  await context.close();
}

async function recordMobileTour(browser, serializedDocument) {
  const videoDirectory = join(outputRoot, 'recording-raw');
  await mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: videoDirectory, size: { height: 844, width: 390 } },
    reducedMotion: 'reduce',
    viewport: { height: 844, width: 390 },
  });
  const page = await context.newPage();
  await installCanonicalDocument(page, serializedDocument);
  await page.waitForTimeout(500);

  await selectSection01(page);
  await page.waitForTimeout(450);
  await clickSelectedAction(page, 'Edit');
  await page.getByRole('dialog', { name: /^Edit Section 01$/i }).waitFor();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);

  await openPagesAndStructure(page);
  await page.waitForTimeout(650);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);

  await enterReorder(page);
  await page.waitForTimeout(700);
  const reorderDone = await firstVisible(
    page.getByRole('button', { exact: true, name: 'Done' }),
    'Reorder Done button',
  );
  await reorderDone.click();
  await page.waitForTimeout(400);

  await enterPreview(page, 'Phone');
  await page.waitForTimeout(850);
  await page.getByRole('button', { name: 'Back to editor' }).click();
  await page.waitForTimeout(450);

  const video = page.video();
  await page.close();
  const rawVideoPath = await video.path();
  await context.close();
  await rename(rawVideoPath, join(outputRoot, 'final-hybrid-mobile-tour.webm'));
}

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch();

const desktopContext = await browser.newContext({
  reducedMotion: 'reduce',
  viewport: desktopViewport,
});
const desktopPage = await desktopContext.newPage();

// The first chooser interaction creates the one canonical Quick Book document.
// Every editor state below installs that exact serialization and therefore uses
// the same stable page and section instance IDs.
await desktopPage.setViewportSize({ height: 1100, width: 1440 });
await showStarterChooser(desktopPage);
await capture(desktopPage, '11-desktop-starter-chooser.png', { fullPage: true });
const canonicalDocument = await chooseCanonicalQuickBook(desktopPage);

const mobileContext = await browser.newContext({
  hasTouch: true,
  isMobile: true,
  reducedMotion: 'reduce',
  viewport: mobileViewport,
});
const mobilePage = await mobileContext.newPage();

// 1–10: primary 375px evidence.
await showStarterChooser(mobilePage);
await capture(mobilePage, '01-mobile-starter-chooser.png', { fullPage: true });

await installCanonicalDocument(mobilePage, canonicalDocument);
await capture(mobilePage, '02-mobile-default-editor.png');

await installCanonicalDocument(mobilePage, canonicalDocument);
await selectSection01(mobilePage);
await capture(mobilePage, '03-mobile-selected-section.png');
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile section selection');

await installCanonicalDocument(mobilePage, canonicalDocument);
await openEditSurface(mobilePage);
await capture(mobilePage, '04-mobile-edit-sheet.png');
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile Edit Sheet');

await installCanonicalDocument(mobilePage, canonicalDocument);
await openSectionLibrary(mobilePage);
await capture(mobilePage, '05-mobile-add-section-sheet.png');
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile Add Section Sheet');

await installCanonicalDocument(mobilePage, canonicalDocument);
await openPagesAndStructure(mobilePage);
await capture(mobilePage, '06-mobile-pages-and-structure-sheet.png');
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile Pages & Structure Sheet');

await installCanonicalDocument(mobilePage, canonicalDocument);
await openMoveSheet(mobilePage);
await capture(mobilePage, '07-mobile-move-sheet.png');
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile Move Sheet');

await installCanonicalDocument(mobilePage, canonicalDocument);
await enterReorder(mobilePage);
await capture(mobilePage, '08-mobile-reorder.png');
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile Reorder presentation');

await installCanonicalDocument(mobilePage, canonicalDocument);
await enterPreview(mobilePage, 'Phone');
await capture(mobilePage, '09-mobile-preview.png');
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile Preview');

await installCanonicalDocument(mobilePage, canonicalDocument);
await enableRealHeightSimulation(mobilePage);
await capture(mobilePage, '10-mobile-real-height-simulation.png', { fullPage: true });
await assertCanonicalDocument(mobilePage, canonicalDocument, 'Mobile real-height simulation');

// 12–20: desktop expansion and Preview device framing.
await desktopPage.setViewportSize(desktopViewport);
await installCanonicalDocument(desktopPage, canonicalDocument);
await capture(desktopPage, '12-desktop-default-editor.png');

await installCanonicalDocument(desktopPage, canonicalDocument);
await selectSection01(desktopPage);
await capture(desktopPage, '13-desktop-selected-section.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Desktop section selection');

await installCanonicalDocument(desktopPage, canonicalDocument);
await openEditSurface(desktopPage);
await capture(desktopPage, '14-desktop-edit-drawer.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Desktop Edit drawer');

await installCanonicalDocument(desktopPage, canonicalDocument);
await openPagesAndStructure(desktopPage);
await capture(desktopPage, '15-desktop-pages-and-structure-drawer.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Desktop Pages & Structure drawer');

await installCanonicalDocument(desktopPage, canonicalDocument);
await enterReorder(desktopPage);
await capture(desktopPage, '16-desktop-reorder.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Desktop Reorder presentation');

await installCanonicalDocument(desktopPage, canonicalDocument);
await enterPreview(desktopPage, 'Desktop');
await capture(desktopPage, '17-desktop-preview.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Desktop Preview');

await installCanonicalDocument(desktopPage, canonicalDocument);
await enterPreview(desktopPage, 'Tablet');
await capture(desktopPage, '18-tablet-preview.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Tablet Preview');

await installCanonicalDocument(desktopPage, canonicalDocument);
await enterPreview(desktopPage, 'Phone');
await capture(desktopPage, '19-phone-preview-on-desktop.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Phone Preview on desktop');

await installCanonicalDocument(desktopPage, canonicalDocument);
await enableRealHeightSimulation(desktopPage);
await capture(desktopPage, '20-desktop-real-height-simulation.png', { fullPage: true });
await assertCanonicalDocument(desktopPage, canonicalDocument, 'Desktop real-height simulation');

// 21–23: requested edge widths and browser-level 200% zoom approximation.
await mobilePage.setViewportSize({ height: 700, width: 320 });
await installCanonicalDocument(mobilePage, canonicalDocument);
await capture(mobilePage, '21-editor-320px.png');

await mobilePage.setViewportSize({ height: 600, width: 375 });
await installCanonicalDocument(mobilePage, canonicalDocument);
await capture(mobilePage, '22-editor-375x600.png');

await desktopPage.setViewportSize({ height: 900, width: 750 });
await installCanonicalDocument(desktopPage, canonicalDocument);
await desktopPage.evaluate(() => {
  document.documentElement.style.zoom = '2';
});
await settle(desktopPage);
await capture(desktopPage, '23-editor-200-percent-zoom-approximation.png');
await assertCanonicalDocument(desktopPage, canonicalDocument, '200% zoom approximation');

await composeComparison(browser);
await recordMobileTour(browser, canonicalDocument);

await mobileContext.close();
await desktopContext.close();
await browser.close();

process.stdout.write(`Captured 23 final-hybrid states, one five-state comparison, and one mobile tour in ${outputRoot}\n`);

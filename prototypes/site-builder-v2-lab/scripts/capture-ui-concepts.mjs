import { chromium } from '@playwright/test';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const baseUrl = process.env.LUSTER_CONCEPT_LAB_URL ?? 'http://127.0.0.1:4178';
const outputRoot = resolve('artifacts/ui-concepts');
const documentKey = 'luster.site-builder-v2-lab.schema-1';
const conceptKey = 'luster.site-builder-v2-lab.ui-concept.schema-1';
const concepts = [
  { id: 'canvas_first', number: 1, name: 'Canvas First' },
  { id: 'dark_studio', number: 2, name: 'Dark Studio' },
  { id: 'mobile_first', number: 3, name: 'Mobile First' },
  { id: 'split_workspace', number: 4, name: 'Split Workspace' },
  { id: 'inline_editor', number: 5, name: 'Inline Editor' },
];

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(240);
}

async function installState(page, conceptId, serializedDocument = null) {
  await page.goto(baseUrl);
  await page.evaluate(
    ({ conceptId: id, conceptStorageKey, documentStorageKey, serialized }) => {
      window.localStorage.clear();
      window.localStorage.setItem(conceptStorageKey, id);
      if (serialized) {
        window.localStorage.setItem(documentStorageKey, serialized);
      }
    },
    {
      conceptId,
      conceptStorageKey: conceptKey,
      documentStorageKey: documentKey,
      serialized: serializedDocument,
    },
  );
  await page.reload();
  await settle(page);
}

async function capture(page, path, fullPage = false) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage,
    path,
  });
}

async function visibleButton(page, name) {
  return page.locator('button:visible').filter({ hasText: new RegExp(`^${name}$`) }).first();
}

async function chooseQuickBook(page) {
  await page.getByRole('button', { name: /^Quick Book/ }).click();
  await page.waitForSelector('.editor-app');
  await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, documentKey);
  await settle(page);
}

async function selectFirstSection(page) {
  const surface = page.locator('.section-card__select-surface').first();
  await surface.focus();
  await surface.press('Enter');
  await page.waitForSelector('.section-card.is-selected');
  await page.waitForTimeout(220);
}

async function openMode(page, name) {
  await page
    .getByRole('group', { name: 'Editor modes' })
    .getByRole('button', { exact: true, name })
    .click();
  await page.waitForTimeout(260);
}

async function closeAnySectionActions(page) {
  const dialog = page.getByRole('dialog', { name: /Section 01 actions/ });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /Close Section 01 actions/ }).click();
  }
}

async function openSectionLibrary(page) {
  await page.evaluate(() => {
    const addButton = [...document.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.startsWith('Add section at top'),
    );
    addButton?.click();
  });
  await page.waitForSelector('[role="dialog"][aria-labelledby]');
  await page.getByRole('dialog', { name: 'Section library' }).waitFor();
  await page.waitForTimeout(260);
}

async function composeSheet(browser, files, title, output, kind) {
  const context = await browser.newContext({
    viewport: kind === 'mobile'
      ? { width: 2050, height: 1100 }
      : { width: 3400, height: kind === 'desktop' ? 650 : 700 },
  });
  const page = await context.newPage();
  const images = await Promise.all(files.map(async (file) => ({
    data: (await readFile(file.path)).toString('base64'),
    label: file.label,
  })));
  const cardWidth = kind === 'mobile' ? 360 : 640;
  const imageHeight = kind === 'starter' ? 489 : kind === 'mobile' ? 812 : 444;
  const imageFit = kind === 'mobile' ? 'cover' : 'contain';
  await page.setContent(`<!doctype html>
    <html><head><style>
      *{box-sizing:border-box} body{margin:0;padding:44px;background:#17151a;color:#fff;font-family:Arial,sans-serif}
      h1{margin:0 0 30px;font-family:Georgia,serif;font-size:46px;font-weight:500}
      .grid{display:grid;grid-template-columns:repeat(5,${cardWidth}px);gap:22px;align-items:start}
      figure{margin:0;padding:12px;border:1px solid #3d3842;border-radius:18px;background:#242128;box-shadow:0 20px 55px #0006}
      figcaption{height:48px;padding:8px 5px 13px;color:#f5dce7;font-size:18px;font-weight:800}
      img{display:block;width:100%;height:${imageHeight}px;object-fit:${imageFit};object-position:top;border-radius:10px;background:#fff}
    </style></head><body><h1>${title}</h1><div class="grid">${images.map((image) =>
      `<figure><figcaption>${image.label}</figcaption><img src="data:image/png;base64,${image.data}"></figure>`,
    ).join('')}</div></body></html>`);
  await page.screenshot({ fullPage: true, path: output });
  await context.close();
}

async function recordTour(browser, baseline) {
  const videoDir = join(outputRoot, 'recording-raw');
  await mkdir(videoDir, { recursive: true });
  const context = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await installState(page, concepts[0].id, baseline);
  await page.getByRole('button', { name: 'Open UI concept gallery' }).click();
  await page.waitForTimeout(700);
  for (const concept of concepts) {
    const card = page.getByRole('article').filter({
      has: page.getByRole('heading', { name: `Concept ${concept.number} — ${concept.name}` }),
    });
    await card.getByRole('button', { name: 'Use same site state' }).click();
    await page.waitForTimeout(700);
    if (concept.number < concepts.length) {
      await page.getByRole('button', { name: 'Open UI concept gallery' }).click();
      await page.waitForTimeout(500);
    }
  }
  const video = page.video();
  await page.close();
  const rawPath = await video.path();
  await context.close();
  await rename(rawPath, join(outputRoot, 'concept-switcher-tour.webm'));
}

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch();
const mainContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await mainContext.newPage();

// Create one canonical Quick Book document. Every editor capture below reloads
// this exact serialized document, including the same stable instance IDs.
await installState(page, concepts[0].id);
await chooseQuickBook(page);
const baseline = await page.evaluate((key) => window.localStorage.getItem(key), documentKey);
if (!baseline) {
  throw new Error('Could not create the canonical Quick Book comparison document.');
}

for (const concept of concepts) {
  const directory = join(outputRoot, `concept-${concept.number}`);
  await mkdir(directory, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await installState(page, concept.id);
  await capture(page, join(directory, 'a-starter-desktop.png'));

  await page.setViewportSize({ width: 1440, height: 1000 });
  await installState(page, concept.id, baseline);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, join(directory, 'b-editor-desktop.png'));

  await selectFirstSection(page);
  await capture(page, join(directory, 'c-selected-desktop.png'));

  await openMode(page, 'Reorder');
  await capture(page, join(directory, 'j-reorder-desktop.png'));
  await page.locator('.reorder-inline-actions').getByRole('button', { name: 'Done' }).click();

  await openMode(page, 'Preview');
  await page.getByRole('group', { name: 'Preview viewport' }).getByRole('button', { name: 'Desktop' }).click();
  await capture(page, join(directory, 'd-preview-desktop.png'));
  await visibleButton(page, 'Done').then((button) => button.click());

  await page.setViewportSize({ width: 375, height: 812 });
  await installState(page, concept.id, baseline);
  await capture(page, join(directory, 'e-editor-mobile.png'));

  await openMode(page, 'Reorder');
  await capture(page, join(directory, 'f-reorder-mobile.png'));
  await visibleButton(page, 'Done').then((button) => button.click());

  await selectFirstSection(page);
  await capture(page, join(directory, 'g-selected-actions-mobile.png'));
  await closeAnySectionActions(page);

  await openMode(page, 'Preview');
  await page.getByRole('group', { name: 'Preview viewport' }).getByRole('button', { name: 'Mobile' }).click();
  await capture(page, join(directory, 'h-preview-mobile.png'));
  await visibleButton(page, 'Done').then((button) => button.click());

  await openSectionLibrary(page);
  await capture(page, join(directory, 'i-add-section-mobile.png'));
}

await page.setViewportSize({ width: 1440, height: 1000 });
await installState(page, concepts[0].id, baseline);
await page.getByRole('button', { name: 'Open UI concept gallery' }).click();
await settle(page);
await capture(page, join(outputRoot, 'ui-concept-gallery-desktop.png'), true);

await page.setViewportSize({ width: 375, height: 812 });
await capture(page, join(outputRoot, 'ui-concept-gallery-mobile.png'), true);

await composeSheet(
  browser,
  concepts.map((concept) => ({
    label: `Concept ${concept.number} — ${concept.name}`,
    path: join(outputRoot, `concept-${concept.number}`, 'b-editor-desktop.png'),
  })),
  'Five desktop editor shells — same Quick Book document',
  join(outputRoot, 'comparison-five-desktop-editors.png'),
  'desktop',
);
await composeSheet(
  browser,
  concepts.map((concept) => ({
    label: `Concept ${concept.number} — ${concept.name}`,
    path: join(outputRoot, `concept-${concept.number}`, 'j-reorder-desktop.png'),
  })),
  'Five desktop Reorder modes — same Quick Book document',
  join(outputRoot, 'comparison-five-desktop-reorder.png'),
  'desktop',
);
await composeSheet(
  browser,
  concepts.map((concept) => ({
    label: `Concept ${concept.number} — ${concept.name}`,
    path: join(outputRoot, `concept-${concept.number}`, 'e-editor-mobile.png'),
  })),
  'Five mobile editor shells — same Quick Book document',
  join(outputRoot, 'comparison-five-mobile-editors.png'),
  'mobile',
);
await composeSheet(
  browser,
  concepts.map((concept) => ({
    label: `Concept ${concept.number} — ${concept.name}`,
    path: join(outputRoot, `concept-${concept.number}`, 'a-starter-desktop.png'),
  })),
  'Five starting-point chooser directions',
  join(outputRoot, 'comparison-five-starter-choosers.png'),
  'starter',
);

await recordTour(browser, baseline);
await mainContext.close();
await browser.close();

console.log(`Captured 50 required concept states, two gallery views, four comparison sheets, and one tour video in ${outputRoot}`);

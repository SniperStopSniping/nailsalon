import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.LUSTER_LAB_URL ?? 'http://127.0.0.1:4188';
const evidenceRoot = '/tmp/luster-onboarding-v1-ux-lab';
const screenshotDir = join(evidenceRoot, 'screenshots');
const videoDir = join(evidenceRoot, 'videos');
const rawVideoDir = join(videoDir, '.raw');
const portraitPath = new URL('../src/onboarding/fixtures/assets/daniela-placeholder.jpg', import.meta.url).pathname;
const requiredScreenshotNames = [
  '01-welcome-mobile.png',
  '02-business-mobile.png',
  '03-photo-social-mobile.png',
  '04-location-contact-mobile.png',
  '05-booking-preferences-mobile.png',
  '06-starter-chooser-mobile.png',
  '07-starting-site-ready.png',
  '08-full-starting-preview.png',
  '09-about-on.png',
  '10-about-off.png',
  '11-photo-right-preset.png',
  '12-editorial-preset.png',
  '13-profile-quick-facts.png',
  '14-about-before-booking.png',
  '15-policies-questions.png',
  '16-policy-copy-preview.png',
  '17-choose-look-mobile.png',
  '18-choose-look-desktop.png',
  '19-gallery-extra.png',
  '20-canva-extra.png',
  '21-final-phone-preview.png',
  '22-final-tablet-preview.png',
  '23-final-desktop-preview.png',
  '24-readiness-drawer.png',
  '25-plan-offer-lifetime.png',
  '26-plan-offer-monthly.png',
  '27-continue-free.png',
  '28-resume-state.png',
  '29-small-phone-keyboard-state.png',
  '30-final-builder-handoff.png',
];
const requiredVideoNames = [
  '01-complete-fast-path.webm',
  '02-about-off-on-preservation.webm',
  '03-style-live-preview.webm',
  '04-canva-and-gallery-path.webm',
  '05-final-preview-plan-offer.webm',
  '06-resume-after-reload.webm',
];

await mkdir(screenshotDir, { recursive: true });
await mkdir(rawVideoDir, { recursive: true });
for (const fileName of await readdir(screenshotDir)) {
  if (fileName.startsWith('failure-')) {
    await rm(join(screenshotDir, fileName), { force: true });
  }
}

const browser = await chromium.launch({ headless: false });
const results = [];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const heading = (page, name) => page.getByRole('heading', { level: 1, name });

const openFresh = async (page) => {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await heading(page, 'Let’s build your website').waitFor();
};

const openFixture = async (page, label) => {
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('button', { name: 'Lab review options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Lab review options' });
  await dialog.getByRole('button', { exact: true, name: label }).click();
  await dialog.waitFor({ state: 'hidden' });
  const moreMenu = page.locator('details.onboarding-shell__more');
  if (await moreMenu.getAttribute('open') !== null) {
    await page.getByLabel('More onboarding options').click();
  }
  await page.getByLabel('Autosave status').filter({ hasText: 'Saved' }).waitFor();
  await page.waitForFunction(() => window.history.state?.lusterOnboardingGuard === true);
};

const startAndOpenFixture = async (page, label) => {
  await openFresh(page);
  await page.getByRole('button', { name: 'Build my website' }).click();
  await heading(page, 'Tell us about your business').waitFor();
  await openFixture(page, label);
};

const clickSticky = (page, className) => page.locator(`.sticky-onboarding-actions__${className}`).click();

const recordScenario = async (name, viewport, scenario) => {
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];
  const context = await browser.newContext({
    recordVideo: { dir: rawVideoDir, size: viewport },
    viewport,
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    error: request.failure()?.errorText ?? 'unknown',
    url: request.url(),
  }));

  let video;
  let status = 'passed';
  let scenarioError = null;
  try {
    await scenario(page);
    video = page.video();
  } catch (error) {
    status = 'failed';
    scenarioError = error instanceof Error ? error.message : String(error);
    await page.screenshot({
      fullPage: true,
      path: join(screenshotDir, `failure-${name}.png`),
    });
    video = page.video();
  } finally {
    await context.close();
  }

  if (video) {
    const rawPath = await video.path();
    const target = join(videoDir, `${name}.webm`);
    await rm(target, { force: true });
    await rename(rawPath, target);
  }

  const result = {
    consoleErrors,
    consoleWarnings,
    failedRequests,
    name,
    pageErrors,
    scenarioError,
    status,
    viewport,
  };
  results.push(result);
  if (status === 'failed') throw new Error(`${name}: ${scenarioError}`);
};

await recordScenario('01-complete-fast-path', { height: 844, width: 390 }, async (page) => {
  await openFresh(page);
  await page.screenshot({ path: join(screenshotDir, '01-welcome-mobile.png') });
  await page.getByRole('button', { name: 'Build my website' }).click();
  await heading(page, 'Tell us about your business').waitFor();
  await page.screenshot({ path: join(screenshotDir, '02-business-mobile.png') });
  await page.getByLabel('Business or salon name').fill('Isla Nail Studio');
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('radio', { name: 'Home studio' }).check();
  await page.getByRole('button', { exact: true, name: 'Continue' }).click();
  await heading(page, 'Add your photo and social presence').waitFor();
  await page.screenshot({ path: join(screenshotDir, '03-photo-social-mobile.png') });
  await page.getByRole('button', { name: 'Skip photo for now' }).click();
  await heading(page, 'Where can clients find you?').waitFor();
  await page.screenshot({ path: join(screenshotDir, '04-location-contact-mobile.png') });
  await page.getByLabel('City or general service area').fill('Scarborough, Ontario');
  await page.locator('[aria-controls="onboarding-contact-card-panel"]').click();
  await page.getByRole('switch', { name: 'Clients should use Booking only' }).check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await heading(page, 'How can clients book with you?').waitFor();
  await page.screenshot({ path: join(screenshotDir, '05-booking-preferences-mobile.png') });
  await page.getByRole('radio', { name: 'Appointment only' }).check();
  await page.getByRole('group', { name: 'Accepting new clients' }).getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('button', { name: 'Save booking information' }).click();
  await heading(page, 'Choose your starting point').waitFor();
  await page.screenshot({ path: join(screenshotDir, '06-starter-chooser-mobile.png') });
  await page.getByRole('button', { name: /^One-page website/ }).click();
  await heading(page, 'Your starting site is ready').waitFor();
  await page.screenshot({ path: join(screenshotDir, '07-starting-site-ready.png') });
  await page.getByRole('button', { name: 'Preview my site' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview your starting site' });
  await preview.waitFor();
  await page.screenshot({ path: join(screenshotDir, '08-full-starting-preview.png') });
  assert(await preview.getByRole('button', { name: 'Open my Builder' }).count() === 0, 'Screen 7 preview exposed Builder.');
  await preview.getByRole('button', { name: 'Continue setup' }).click();
  await heading(page, 'Would you like an About section?').waitFor();
  await page.screenshot({ path: join(screenshotDir, '09-about-on.png') });
  await page.getByLabel('Short bio').fill('I create thoughtful, detailed nail appointments in a calm private studio.');
  await page.getByRole('button', { name: 'Choose an About design' }).click();
  await page.getByRole('button', { name: /^Photo Right/ }).click();
  await page.getByRole('button', { name: 'Use this design' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: /^Editorial/ }).click();
  await page.screenshot({ path: join(screenshotDir, '17-choose-look-mobile.png') });
  await page.getByRole('button', { name: 'Use this style' }).click();
  await page.getByRole('button', { name: 'Skip extras' }).click();
  await heading(page, 'Review your site').waitFor();
  await page.screenshot({ path: join(screenshotDir, '21-final-phone-preview.png') });
  await page.locator('.onboarding-readiness__mobile-trigger').click();
  await page.screenshot({ path: join(screenshotDir, '24-readiness-drawer.png') });
  await page.locator('.onboarding-readiness__mobile-trigger').click();
  await page.getByRole('button', { name: 'Open my Builder' }).click();
  const offer = page.getByRole('dialog', { name: 'Your site is saved' });
  await offer.getByRole('button', { name: 'Continue free' }).click();
  await page.getByTestId('final-hybrid-editor').waitFor();
  await page.screenshot({ path: join(screenshotDir, '30-final-builder-handoff.png') });
});

await recordScenario('02-about-off-on-preservation', { height: 844, width: 390 }, async (page) => {
  await startAndOpenFixture(page, 'About Off');
  await heading(page, 'Set clear expectations').waitFor();
  await page.waitForFunction(() => window.history.state?.screen === 'policies');
  await page.getByRole('button', { exact: true, name: 'Back' }).click();
  await heading(page, 'Would you like an About section?').waitFor();
  await page.screenshot({ path: join(screenshotDir, '10-about-off.png') });
  const originalBio = await page.getByLabel('Short bio').inputValue();
  assert(originalBio.length > 0, 'The About Off fixture lost its bio.');
  await page.getByLabel('Autosave status').filter({ hasText: 'Saved' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await heading(page, 'Would you like an About section?').waitFor();
  assert(await page.getByLabel('Short bio').inputValue() === originalBio, 'Reload lost the hidden About bio.');
  await page.getByRole('switch', { name: 'Include an About section' }).check();
  await page.getByRole('button', { name: 'Choose an About design' }).click();
  await page.screenshot({ path: join(screenshotDir, '11-photo-right-preset.png') });
  await page.getByRole('button', { name: /^Editorial Portrait/ }).click();
  await page.screenshot({ path: join(screenshotDir, '12-editorial-preset.png') });
  await page.getByRole('button', { name: /^Profile \+ Quick Facts/ }).click();
  await page.screenshot({ path: join(screenshotDir, '13-profile-quick-facts.png') });
  await page.getByRole('button', { name: /^About \+ Before You Book/ }).click();
  await page.screenshot({ path: join(screenshotDir, '14-about-before-booking.png') });
  await page.getByRole('button', { name: 'Use this design' }).click();
  await heading(page, 'Set clear expectations').waitFor();
  await page.screenshot({ path: join(screenshotDir, '15-policies-questions.png') });
  await page.locator('.onboarding-policy-copy-list').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(screenshotDir, '16-policy-copy-preview.png') });
});

await recordScenario('03-style-live-preview', { height: 800, width: 1180 }, async (page) => {
  await startAndOpenFixture(page, 'One essential missing');
  await page.getByRole('button', { name: 'Finish 1 essential' }).click();
  await heading(page, 'Choose your look').waitFor();
  for (const preset of ['Editorial', 'Soft', 'Minimal', 'Bold', 'Luxury', 'Modern']) {
    await page.getByRole('button', { name: new RegExp(`^${preset}`) }).click();
    await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: /^Luxury/ }).click();
  await page.screenshot({ path: join(screenshotDir, '18-choose-look-desktop.png') });
  await page.getByRole('button', { name: 'View full preview' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview your look' });
  await preview.getByRole('button', { name: 'Tablet' }).click();
  await preview.getByRole('button', { name: 'Desktop' }).click();
  await preview.getByRole('button', { name: 'Return to setup' }).click();
});

await recordScenario('04-canva-and-gallery-path', { height: 932, width: 430 }, async (page) => {
  await startAndOpenFixture(page, 'Gallery selected');
  await heading(page, 'Add something extra').waitFor();
  await page.screenshot({ path: join(screenshotDir, '19-gallery-extra.png') });
  await page.getByRole('button', { name: 'Upload Canva design' }).click();
  const canvaDialog = page.getByRole('dialog', { name: 'Upload a Canva design' });
  await canvaDialog.locator('input[type="file"]').setInputFiles(portraitPath);
  await canvaDialog.getByRole('radio', { name: 'Poster' }).check();
  await canvaDialog.getByRole('radio', { name: 'Before Booking' }).check();
  await page.screenshot({ path: join(screenshotDir, '20-canva-extra.png') });
  await canvaDialog.getByRole('button', { name: 'Add Canva design' }).click();
  await canvaDialog.waitFor({ state: 'hidden', timeout: 20_000 });
  await page.getByRole('button', { name: 'Continue to review' }).click();
  await heading(page, 'Review your site').waitFor();
  await page.getByRole('button', { name: 'Open my Builder' }).click();
  await page.getByRole('dialog', { name: 'Your site is saved' }).getByRole('button', { name: 'Choose monthly' }).click();
  await page.getByTestId('final-hybrid-editor').waitFor();
});

await recordScenario('05-final-preview-plan-offer', { height: 1024, width: 768 }, async (page) => {
  await startAndOpenFixture(page, 'All essentials complete');
  await heading(page, 'Review your site').waitFor();
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.getByRole('button', { name: 'Tablet' }).click();
  await page.screenshot({ path: join(screenshotDir, '22-final-tablet-preview.png') });
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.screenshot({ path: join(screenshotDir, '23-final-desktop-preview.png') });
  await page.getByRole('button', { name: 'Open my Builder' }).click();
  const offer = page.getByRole('dialog', { name: 'Your site is saved' });
  assert(await offer.getByRole('button', { name: 'Continue free' }).isVisible(), 'Continue free is not visible.');
  await offer.getByText('Founding Nail Tech Lifetime Access').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(screenshotDir, '25-plan-offer-lifetime.png') });
  await offer.getByText('Monthly plan', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(screenshotDir, '26-plan-offer-monthly.png') });
  await offer.getByText('Continue free', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(screenshotDir, '27-continue-free.png') });
  await offer.getByRole('button', { name: 'Choose monthly' }).click();
  await page.getByTestId('final-hybrid-editor').waitFor();
});

await recordScenario('06-resume-after-reload', { height: 568, width: 320 }, async (page) => {
  await openFresh(page);
  await page.getByRole('button', { name: 'Build my website' }).click();
  await page.getByLabel('Business or salon name').focus();
  await page.setViewportSize({ height: 360, width: 320 });
  await page.screenshot({ path: join(screenshotDir, '29-small-phone-keyboard-state.png') });
  const primary = page.getByRole('button', { exact: true, name: 'Continue' });
  const primaryBox = await primary.boundingBox();
  assert(primaryBox && primaryBox.height >= 44 && primaryBox.y + primaryBox.height <= 361, 'Keyboard simulation stranded Continue.');
  await page.setViewportSize({ height: 568, width: 320 });
  await page.getByLabel('Business or salon name').fill('Isla Nail Studio');
  await page.getByLabel('Your name').fill('Daniela');
  await page.getByRole('radio', { name: 'Solo nail tech' }).check();
  await primary.click();
  await page.getByLabel('Instagram handle (optional)').fill('@islanail.studio');
  await page.waitForTimeout(350);
  await page.getByLabel('More onboarding options').click();
  await page.getByRole('button', { name: 'Save and finish later' }).click();
  await heading(page, 'Setup saved').waitFor();
  await page.screenshot({ path: join(screenshotDir, '28-resume-state.png') });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume setup' }).click();
  await heading(page, 'Add your photo and social presence').waitFor();
  assert(await page.getByLabel('Instagram handle (optional)').inputValue() === '@islanail.studio', 'Resume lost Instagram.');
});

const finalStateContext = await browser.newContext({ viewport: { height: 844, width: 390 } });
const finalStatePage = await finalStateContext.newPage();
await openFresh(finalStatePage);
await finalStatePage.evaluate(() => window.localStorage.setItem('luster:unrelated-reset-sentinel', 'preserve'));
await finalStatePage.getByRole('button', { name: 'Build my website' }).click();
await heading(finalStatePage, 'Tell us about your business').waitFor();
await openFixture(finalStatePage, 'Daniela / Isla Nail Studio');
await heading(finalStatePage, 'Review your site').waitFor();
assert(await finalStatePage.getByText('Isla Nail Studio').first().isVisible(), 'The Daniela fixture did not render.');
await openFixture(finalStatePage, 'Gallery selected');
await heading(finalStatePage, 'Add something extra').waitFor();
await finalStatePage.getByRole('button', { name: 'Upload Canva design' }).click();
const finalStateCanvaDialog = finalStatePage.getByRole('dialog', { name: 'Upload a Canva design' });
await finalStateCanvaDialog.locator('input[type="file"]').setInputFiles(portraitPath);
await finalStateCanvaDialog.getByRole('button', { name: 'Add Canva design' }).click();
await finalStateCanvaDialog.waitFor({ state: 'hidden', timeout: 20_000 });
assert(await finalStatePage.getByText('Added: Gallery and Canva').isVisible(), 'The final reset fixture did not create its test asset.');
await finalStatePage.getByLabel('More onboarding options').click();
await finalStatePage.getByRole('button', { name: 'Restart onboarding' }).click();
const resetDialog = finalStatePage.getByRole('dialog', { name: 'Restart onboarding?' });
await resetDialog.getByRole('button', { exact: true, name: 'Restart onboarding' }).click();
await heading(finalStatePage, 'Let’s build your website').waitFor();
const beforeReload = await finalStatePage.evaluate(async () => {
  const countAssetRecords = () => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('luster-custom-design-assets');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const stores = Array.from(database.objectStoreNames);
      if (stores.length === 0) {
        database.close();
        resolve(0);
        return;
      }
      const transaction = database.transaction(stores, 'readonly');
      let total = 0;
      for (const store of stores) {
        const countRequest = transaction.objectStore(store).count();
        countRequest.onsuccess = () => { total += countRequest.result; };
      }
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve(total);
      };
    };
  });
  return {
    assetRecords: await countAssetRecords(),
    builderDocument: window.localStorage.getItem('luster:site-builder-v2-booking-integration-lab:document:v1'),
    modalClass: document.documentElement.classList.contains('onboarding-modal-open'),
    onboardingState: window.localStorage.getItem('luster:onboarding-v1-lab'),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    unrelatedSentinel: window.localStorage.getItem('luster:unrelated-reset-sentinel'),
  };
});
assert(beforeReload.onboardingState === null, 'Final reset left onboarding storage behind.');
assert(beforeReload.builderDocument === null, 'Final reset left the starter document behind.');
assert(beforeReload.assetRecords === 0, 'Final reset left onboarding Custom Design assets behind.');
assert(beforeReload.modalClass === false, 'Final reset leaked the modal scroll lock.');
assert(beforeReload.overflowX <= 1, 'Final Welcome has horizontal overflow.');
assert(beforeReload.unrelatedSentinel === 'preserve', 'Final reset removed unrelated browser storage.');
await finalStatePage.evaluate(() => window.localStorage.removeItem('luster:unrelated-reset-sentinel'));
const reloadResponse = await finalStatePage.reload({ waitUntil: 'networkidle' });
await heading(finalStatePage, 'Let’s build your website').waitFor();
await finalStatePage.goto(`${baseUrl}/?surface=builder`, { waitUntil: 'networkidle' });
await heading(finalStatePage, 'Let’s build your website').waitFor();
const finalStateResult = {
  ...beforeReload,
  builderQueryBlockedInNormalDev: true,
  httpStatus: reloadResponse?.status() ?? null,
  reloadedAtWelcome: true,
  unrelatedSentinelPreserved: beforeReload.unrelatedSentinel === 'preserve',
};
await writeFile(
  join(evidenceRoot, 'final-lab-state.json'),
  JSON.stringify(finalStateResult, null, 2),
  'utf8',
);
await finalStateContext.close();

await browser.close();

await rm(rawVideoDir, { force: true, recursive: true });
await writeFile(
  join(evidenceRoot, 'headed-video-results.json'),
  JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2),
  'utf8',
);

const failures = results.flatMap((result) => [
  ...result.consoleErrors.map((message) => `${result.name} console: ${message}`),
  ...result.pageErrors.map((message) => `${result.name} page: ${message}`),
  ...result.failedRequests.map((request) => `${result.name} request: ${request.url} (${request.error})`),
]);

if (failures.length > 0) {
  throw new Error(`Browser evidence captured with failures:\n${failures.join('\n')}`);
}

const buildEvidenceEntries = async (directory, names, kind) => Promise.all(
  names.map(async (name) => {
    const filePath = join(directory, name);
    const fileStat = await stat(filePath);
    return {
      bytes: fileStat.size,
      file: filePath.slice(evidenceRoot.length + 1),
      kind,
    };
  }),
);
const evidenceEntries = [
  ...await buildEvidenceEntries(screenshotDir, requiredScreenshotNames, 'screenshot'),
  ...await buildEvidenceEntries(videoDir, requiredVideoNames, 'video'),
];
await writeFile(
  join(evidenceRoot, 'evidence-index.json'),
  JSON.stringify({ capturedAt: new Date().toISOString(), entries: evidenceEntries }, null, 2),
  'utf8',
);

console.log(JSON.stringify({
  evidenceRoot,
  scenarios: results.length,
  screenshots: requiredScreenshotNames.length,
  videos: requiredVideoNames.length,
}, null, 2));

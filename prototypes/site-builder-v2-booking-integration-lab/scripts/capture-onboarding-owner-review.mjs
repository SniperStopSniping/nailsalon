import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const evidenceDirectory = '/tmp/luster-onboarding-owner-review-corrections';
const videosDirectory = join(evidenceDirectory, 'videos');
const labUrl = 'http://127.0.0.1:4188';
const portraitPath = fileURLToPath(new URL(
  '../src/onboarding/fixtures/assets/daniela-placeholder.jpg',
  import.meta.url,
));
await mkdir(evidenceDirectory, { recursive: true });
await mkdir(videosDirectory, { recursive: true });

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'playwright',
    'test',
    '--config=playwright.onboarding-owner-review.config.ts',
    '--project=chromium-owner-review',
    '--headed',
  ],
  {
    env: {
      ...process.env,
      LUSTER_CAPTURE_EVIDENCE: '1',
      LUSTER_EVIDENCE_DIRECTORY: evidenceDirectory,
    },
    stdio: 'inherit',
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  const heading = (page, name) => page.getByRole('heading', { level: 1, name });
  const settle = (page, milliseconds = 250) => page.waitForTimeout(milliseconds);

  const openFresh = async (page) => {
    await page.goto(labUrl);
    await heading(page, 'Let’s build your website').waitFor();
  };

  const capture = async (page, fileName) => {
    await settle(page);
    await page.screenshot({
      animations: 'disabled',
      fullPage: true,
      path: join(evidenceDirectory, `${fileName}.png`),
    });
  };

  const applyFixture = async (page, fixtureLabel, destinationHeading) => {
    if (await heading(page, 'Let’s build your website').isVisible()) {
      await page.getByRole('button', { name: 'Build my website' }).click();
    }
    await page.getByLabel('More onboarding options').click();
    await page.getByRole('menuitem', { name: 'Lab review options' }).click();
    const dialog = page.getByRole('dialog', { name: 'Lab review options' });
    await dialog.getByRole('button', { exact: true, name: fixtureLabel }).click();
    await heading(page, destinationHeading).waitFor();
    await settle(page);
  };

  const navigateBackTo = async (page, destinationHeading) => {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      if (await heading(page, destinationHeading).isVisible()) {
        return;
      }
      const backButtons = page.getByRole('button', { name: /^Back(?: to edit About)?$/u });
      let back = null;
      for (let index = (await backButtons.count()) - 1; index >= 0; index -= 1) {
        const candidate = backButtons.nth(index);
        if (await candidate.isVisible()) {
          back = candidate;
          break;
        }
      }
      if (!back) {
        throw new Error(`Could not navigate back to “${destinationHeading}”.`);
      }
      await back.click();
      await settle(page, 120);
    }
    throw new Error(`Navigation guard reached before “${destinationHeading}”.`);
  };

  const captureSupplementalScreens = async (browser) => {
    const basicsContext = await browser.newContext({ viewport: { height: 844, width: 390 } });
    const basics = await basicsContext.newPage();
    await openFresh(basics);
    await basics.getByRole('button', { name: 'Build my website' }).click();
    await heading(basics, 'Tell us about your nail business').waitFor();
    await capture(basics, '02-updated-nail-business-screen');
    await basics.getByLabel('Salon or studio name').fill('Mia’s Nail Studio');
    await basics.getByLabel('Your name').fill('Mia Torres');
    await basics.getByRole('group', { name: 'Who are you setting Luster up for?' })
      .getByRole('radio', { name: 'Solo nail tech' }).check();
    await basics.getByRole('button', { exact: true, name: 'Continue' }).click();
    await basics.getByLabel('Instagram handle (optional)').fill('@mias_nails');
    await basics.getByRole('button', { exact: true, name: 'Continue' }).click();
    await basics.getByLabel('City or general service area').fill('Hamilton, Ontario');
    await basics.getByRole('group', { name: 'Where do you see clients?' })
      .getByRole('radio', { name: 'Salon suite' }).check();
    await basics.getByRole('button', { name: 'How should clients contact you?' }).click();
    await capture(basics, '06-shared-instagram');
    await basics.getByRole('button', { name: 'Hours' }).click();
    const monday = basics.getByRole('group', { name: 'Monday' });
    await monday.getByRole('checkbox', { name: 'Closed' }).uncheck();
    await basics.getByLabel('Monday opens').fill('10:00');
    await basics.getByLabel('Monday closes').fill('18:00');
    await basics.getByRole('switch', { name: 'Show hours on my website' }).check();
    await capture(basics, '07-connected-optional-hours');

    await basics.getByRole('button', { name: 'How should clients contact you?' }).click();
    await basics.getByRole('switch', { name: 'Clients should use online booking only' }).check();
    await basics.getByRole('button', { name: 'Save and continue' }).click();
    await heading(basics, 'How do clients book with you?').waitFor();
    await basics.getByRole('group', { name: 'How do you accept clients?' })
      .getByRole('radio', { name: 'Appointment only' }).check();
    await basics.getByRole('group', { name: 'Are you accepting new clients?' })
      .getByRole('radio', { name: 'Yes' }).check();
    await capture(basics, '08-service-menu-ready');
    await basics.getByRole('button', { name: 'Review services & add-ons' }).click();
    await capture(basics, '09-service-library-review');
    await basics.getByRole('dialog', { name: 'Service Library' })
      .getByRole('button', { name: 'Done' }).click();
    await basics.getByLabel('How much notice do you need before an appointment?')
      .selectOption('preset:1440');
    await capture(basics, '10-minimum-notice-presets');
    await basics.getByLabel('How much notice do you need before an appointment?')
      .selectOption('custom');
    await basics.getByLabel('Custom amount', { exact: true }).fill('3');
    await basics.getByLabel('Unit').selectOption('days');
    await capture(basics, '11-custom-minimum-notice');
    await basics.getByRole('group', { name: 'How do you handle booking deposits?' })
      .getByRole('radio', { name: 'Same deposit for every service' }).check();
    await basics.getByRole('group', { name: 'Deposit amount' })
      .getByRole('radio', { name: '$50' }).check();
    await capture(basics, '12-fixed-deposit-dropdown');
    await capture(basics, '13-production-compatible-fixed-deposit-only');
    await capture(basics, '14-booking-connected-summary');
    await basics.getByRole('button', { name: /Save booking/u }).click();
    await heading(basics, 'Choose your starting point').waitFor();
    await capture(basics, '15-approved-starter-chooser');
    await basicsContext.close();

    const designContext = await browser.newContext({ viewport: { height: 844, width: 390 } });
    const design = await designContext.newPage();
    await openFresh(design);
    await applyFixture(design, 'Daniela / Isla Nail Studio', 'Review your site');
    const readinessTrigger = design.getByRole('button', { name: /Site readiness/u });
    if (await readinessTrigger.isVisible()) {
      await readinessTrigger.click();
    }
    await design.getByRole('button', { name: 'Edit About section' }).click();
    await heading(design, 'Would you like an About section?').waitFor();
    await capture(design, '17-simplified-about');
    await design.getByText('More about you', { exact: true }).click();
    await capture(design, '18-about-visibility-beside-fields');
    await design.getByRole('button', { name: 'Choose an About design' }).click();
    await heading(design, 'Choose your About design').waitFor();
    await capture(design, '19-about-design-cards');
    await design.getByRole('button', { name: /^About \+ Before You Book/u }).click();
    await design.getByRole('button', { name: 'Open interactive preview' }).click();
    await design.getByRole('dialog', { name: 'Preview your About section' }).waitFor();
    await capture(design, '20-about-preview-positioned-on-about');
    await design.getByRole('dialog', { name: 'Preview your About section' })
      .getByRole('button', { exact: true, name: 'Back' }).click();
    await design.getByRole('button', { name: 'Use this design' }).click();
    await heading(design, 'Set clear expectations').waitFor();
    await capture(design, '21-policy-accordions');
    await design.getByText('What your clients will see', { exact: true }).scrollIntoViewIfNeeded();
    await capture(design, '22-what-clients-will-see');
    await design.getByRole('button', { name: 'Skip for now' }).click();
    await heading(design, 'Choose your website style').waitFor();
    await capture(design, '23-website-style-explanation');
    await design.getByRole('button', { name: /^Luxury/u }).click();
    await capture(design, '24-current-versus-selected-style');
    await designContext.close();

    const extrasContext = await browser.newContext({ viewport: { height: 844, width: 390 } });
    const extras = await extrasContext.newPage();
    await openFresh(extras);
    await applyFixture(extras, 'Canva intent', 'Add something extra');
    await capture(extras, '25-simplified-extras');
    await capture(extras, '27-canva-recommended-for-you');
    await extras.getByRole('button', { name: 'Add Gallery' }).click();
    let dialog = extras.getByRole('dialog', { name: 'Add Gallery' });
    await dialog.getByRole('button', { name: 'Use temporary example photos' }).click();
    await dialog.getByRole('radio', { name: 'carousel' }).check();
    await dialog.getByRole('button', { exact: true, name: 'Add Gallery' }).click();
    await capture(extras, '26-gallery-added');
    await extras.getByRole('button', { name: 'Upload Canva design' }).click();
    dialog = extras.getByRole('dialog', { name: 'Upload a Canva design' });
    await dialog.locator('input[type="file"]').setInputFiles(portraitPath);
    await dialog.getByRole('button', { name: 'Add Canva design' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await capture(extras, '28-canva-design-added');
    await extras.getByRole('button', { name: 'Continue to review' }).click();
    await heading(extras, 'Review your site').waitFor();
    await capture(extras, '29-final-site-review');
    await extras.getByRole('button', { name: 'Finish setup' }).click();
    const plan = extras.getByRole('dialog', { name: 'Your site is saved' });
    await plan.waitFor();
    await capture(extras, '30-config-driven-plan-sheet');
    await plan.getByRole('button', { name: 'Continue free' }).scrollIntoViewIfNeeded();
    await capture(extras, '31-continue-free');
    await plan.getByRole('button', { name: 'Continue free' }).click();
    const tour = extras.getByRole('dialog', { name: 'Welcome to your Luster workspace' });
    await tour.getByRole('button', { name: 'Skip tour' }).click();
    await heading(extras, 'Welcome to Luster, Daniela').waitFor();
    await capture(extras, '32-dashboard-handoff');
    await extrasContext.close();

    const cleanContext = await browser.newContext({ viewport: { height: 844, width: 390 } });
    const clean = await cleanContext.newPage();
    await openFresh(clean);
    await capture(clean, '40-clean-welcome-restoration');
    await cleanContext.close();
  };

  const recordJourney = async (browser, fileName, runner, viewport = { height: 800, width: 1180 }) => {
    const context = await browser.newContext({
      recordVideo: { dir: videosDirectory, size: { height: 720, width: 1080 } },
      viewport,
    });
    const page = await context.newPage();
    const video = page.video();
    await openFresh(page);
    await runner(page);
    await settle(page, 500);
    await page.close();
    if (video) {
      await video.saveAs(join(videosDirectory, fileName));
    }
    await context.close();
  };

  const captureRequestedVideos = async (browser) => {
    await recordJourney(browser, '01-complete-daniela-onboarding.webm', async (page) => {
      await page.getByRole('button', { name: 'Build my website' }).click();
      await page.getByLabel('Salon or studio name').fill('Isla Nail Studio');
      await page.getByLabel('Your name').fill('Daniela');
      await page.getByRole('group', { name: 'Who are you setting Luster up for?' })
        .getByRole('radio', { name: 'Solo nail tech' }).check();
      await settle(page);
      await applyFixture(page, 'Daniela / Isla Nail Studio', 'Review your site');
      await page.getByRole('button', { name: 'Open interactive preview' }).click();
      await settle(page, 700);
      await page.getByRole('dialog', { name: 'Preview your site' })
        .getByRole('button', { exact: true, name: 'Back' }).click();
      await page.getByRole('button', { name: 'Finish setup' }).click();
      await page.getByRole('dialog', { name: 'Your site is saved' })
        .getByRole('button', { name: 'Continue free' }).click();
    });

    await recordJourney(browser, '02-service-library-review.webm', async (page) => {
      await applyFixture(page, 'Daniela / Isla Nail Studio', 'Review your site');
      await navigateBackTo(page, 'How do clients book with you?');
      await page.getByRole('button', { name: 'Review services & add-ons' }).click();
      const library = page.getByRole('dialog', { name: 'Service Library' });
      await settle(page, 700);
      await library.getByRole('button', { name: /^Remove/u }).first().click();
      await library.getByRole('button', { name: /^Add service/u }).first().click();
      await library.getByRole('button', { name: 'Done' }).click();
    });

    await recordJourney(browser, '03-all-full-preview-surfaces.webm', async (page) => {
      await applyFixture(page, 'Multi-page starter', 'Your starting site is ready');
      await page.getByRole('button', { name: 'Preview my site' }).click();
      await settle(page, 600);
      await page.getByRole('dialog', { name: 'Preview your starting site' })
        .getByRole('button', { exact: true, name: 'Back' }).click();
      await page.getByRole('button', { name: 'Continue setting up my site' }).click();
      await page.getByRole('button', { name: 'Open interactive preview' }).click();
      await settle(page, 600);
      await page.getByRole('dialog', { name: 'Preview your About section' })
        .getByRole('button', { exact: true, name: 'Back' }).click();
      await page.getByRole('button', { name: 'Choose an About design' }).click();
      await page.getByRole('button', { name: 'Open interactive preview' }).click();
      await settle(page, 600);
      await page.getByRole('dialog', { name: 'Preview your About section' })
        .getByRole('button', { exact: true, name: 'Back' }).click();
      await applyFixture(page, 'Policies Off', 'Choose your website style');
      await page.getByRole('button', { name: 'View full preview' }).click();
      await settle(page, 600);
      await page.getByRole('dialog', { name: 'Preview your look' })
        .getByRole('button', { exact: true, name: 'Back' }).click();
      await applyFixture(page, 'All essentials complete', 'Review your site');
      await page.getByRole('button', { name: 'Open interactive preview' }).click();
      await settle(page, 600);
      await page.getByRole('dialog', { name: 'Preview your site' })
        .getByRole('button', { exact: true, name: 'Back' }).click();
    });

    await recordJourney(browser, '04-about-content-to-design-selection.webm', async (page) => {
      await applyFixture(page, 'Daniela / Isla Nail Studio', 'Review your site');
      await navigateBackTo(page, 'Would you like an About section?');
      await page.getByText('More about you', { exact: true }).click();
      await settle(page, 600);
      await page.getByRole('button', { name: 'Choose an About design' }).click();
      await page.getByRole('button', { name: /^Photo Right/u }).click();
      await settle(page, 500);
      await page.getByRole('button', { name: /^Profile \+ Quick Facts/u }).click();
      await settle(page, 500);
      await page.getByRole('button', { name: /^About \+ Before You Book/u }).click();
    });

    await recordJourney(browser, '05-policies.webm', async (page) => {
      await applyFixture(page, 'Daniela / Isla Nail Studio', 'Review your site');
      await navigateBackTo(page, 'Set clear expectations');
      for (const label of ['Deposits', 'Late arrivals', 'No-shows', 'Repairs', 'Guests & appointment details']) {
        const trigger = page.getByRole('button', { name: new RegExp(`^${label}`) }).first();
        if (await trigger.isVisible()) {
          await trigger.click();
          await settle(page, 350);
        }
      }
      await page.getByText('What your clients will see', { exact: true }).scrollIntoViewIfNeeded();
    });

    await recordJourney(browser, '06-plan-to-dashboard.webm', async (page) => {
      await applyFixture(page, 'All essentials complete', 'Review your site');
      await page.getByRole('button', { name: 'Finish setup' }).click();
      const plan = page.getByRole('dialog', { name: 'Your site is saved' });
      const compare = plan.getByText('Compare plans', { exact: true });
      if (await compare.isVisible()) {
        await compare.click();
      }
      await settle(page, 700);
      await plan.getByRole('button', { name: 'Continue free' }).click();
      await page.getByRole('dialog', { name: 'Welcome to your Luster workspace' })
        .getByRole('button', { name: 'Skip tour' }).click();
      await heading(page, 'Welcome to Luster, Daniela').waitFor();
      await page.getByRole('navigation', { name: 'Dashboard preview destinations' })
        .getByRole('button', { name: 'Website & Booking Page' }).click();
    });

    await recordJourney(browser, '07-five-part-dashboard-tour.webm', async (page) => {
      await applyFixture(page, 'All essentials complete', 'Review your site');
      await page.getByRole('button', { name: 'Finish setup' }).click();
      await page.getByRole('dialog', { name: 'Your site is saved' })
        .getByRole('button', { name: 'Continue free' }).click();
      const tour = page.getByRole('dialog', { name: 'Welcome to your Luster workspace' });
      for (let step = 2; step <= 5; step += 1) {
        await settle(page, 550);
        await tour.getByRole('button', { name: 'Next' }).click();
      }
      await settle(page, 700);
      await tour.getByRole('button', { name: 'Go to dashboard' }).click();
    });
  };

  const browser = await chromium.launch({ headless: false });
  try {
    await captureSupplementalScreens(browser);
    await captureRequestedVideos(browser);
  } finally {
    await browser.close();
  }
}

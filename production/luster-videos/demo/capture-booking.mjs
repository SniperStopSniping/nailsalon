import { access, mkdir, readFile, writeFile } from 'node:fs/promises';

import { config } from 'dotenv';
import pg from 'pg';
import { chromium } from 'playwright';

// Real UI only. Default mode rehearses up to (but does not press) Confirm.
// --book creates one hero appointment and refuses another if it already exists.
config({ path: '.env.development.local', quiet: true });
const root = 'production/luster-videos';
const origin = 'http://localhost:3141';
const book = process.argv.includes('--book');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const heroPath = `${root}/qa/hero-booking.json`;
const salon = 'video-demo-salon-solo';
let stage = 'preflight';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (
    url.hostname !== '127.0.0.1'
    || url.port !== '55441'
    || url.pathname !== '/luster_video_demo'
    || url.username !== 'luster_video_owner'
    || process.env.APP_ENV !== 'development'
  ) {
    throw new Error('Unsafe database');
  }
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    const prior = await db.query(
      'select id from appointment where salon_id=$1 and client_name=$2 and start_time > now() and status <> $3',
      [salon, 'Sarah Morgan', 'cancelled'],
    );
    if (prior.rowCount) {
      throw new Error(
        'Hero already exists. Reuse its recording and persisted receipt.',
      );
    }
    if (
      book
      && (await access(heroPath)
        .then(() => true)
        .catch(() => false))
    ) {
      throw new Error('Hero receipt already exists');
    }
    const s = await db.query('select settings from salon where id=$1', [salon]);
    if (s.rows[0]?.settings?.communications?.killSwitch !== true) {
      throw new Error('Salon delivery kill switch required');
    }
  } finally {
    await db.end();
  }
  const release = JSON.parse(
    await readFile(`${root}/manifests/release.json`, 'utf8'),
  );
  if (!release.approvedFilmingSHA || !release.localBuildPassed) {
    throw new Error('Released local build required');
  }
  const date = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }),
  );
  date.setDate(date.getDate() + 2);
  if (date.getDay() === 0) {
    date.setDate(date.getDate() + 1);
  }
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  await mkdir(`${root}/recordings/tutorial-booking`, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
    recordVideo: {
      dir: `${root}/recordings/tutorial-booking`,
      size: { width: 780, height: 1688 },
    },
  });
  const page = await context.newPage();
  const started = Date.now();
  const events = [];
  const mark = (label) => {
    stage = label;
    events.push({ label, seconds: (Date.now() - started) / 1000 });
  };
  const reveal = async (locator) => {
    await locator.evaluate(element =>
      element.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    );
    await pause(1300);
  };
  const video = page.video();
  try {
    await page.goto(`${origin}/atelier-nail-demo`, {
      waitUntil: 'domcontentloaded',
    });
    const service = page.getByTestId(
      'service-card-video-demo-solo-service-biab-overlay',
    );
    await service.waitFor();
    await pause(1800);
    mark('booking-page');
    await pause(4000);
    await reveal(service);
    mark('choose-service');
    await pause(1800);
    await service.click();
    await pause(1600);
    const extra = page.getByRole('button', {
      name: 'Add Simple Nail Art',
      exact: true,
    });
    await reveal(extra);
    mark('optional-addon');
    await pause(2000);
    await extra.click();
    await pause(2200);
    const next = page.getByTestId('service-continue-button');
    await reveal(next);
    mark('continue');
    await pause(1600);
    await next.click();
    await page.waitForURL(/book\/time/);
    await page.getByTestId(`calendar-day-${day}`).waitFor();
    await pause(1800);
    const calendarDay = page.getByTestId(`calendar-day-${day}`);
    await reveal(calendarDay);
    mark('choose-date');
    await pause(1600);
    await calendarDay.click();
    const slot = page.getByTestId('time-slot-10:00');
    await slot.waitFor();
    await reveal(slot);
    mark('choose-time');
    await pause(2000);
    await slot.click();
    await page.waitForURL(/book\/confirm/);
    await page.getByLabel('Customer name').waitFor();
    await pause(1800);
    mark('review-summary');
    await pause(5000);
    const name = page.getByLabel('Customer name');
    await reveal(name);
    mark('contact-details');
    await name.pressSequentially('Sarah Morgan', { delay: 100 });
    await page
      .getByLabel('Customer email')
      .pressSequentially('sarah.morgan@example.invalid', { delay: 60 });
    await page
      .getByLabel('Customer phone')
      .pressSequentially('4165550101', { delay: 110 });
    await pause(2000);
    const policy = page.getByTestId('booking-policy-acknowledgment');
    await reveal(policy);
    mark('required-agreement');
    await pause(4000);
    await policy.getByRole('checkbox').check();
    await pause(2300);
    const confirm = page.getByRole('button', {
      name: 'Confirm appointment · $75.00',
      exact: true,
    });
    await reveal(confirm);
    mark('confirm-control');
    await pause(2500);
    if (book) {
      const responsePromise = page.waitForResponse(
        r =>
          new URL(r.url()).pathname === '/api/appointments'
            && r.request().method() === 'POST',
        { timeout: 60000 },
      );
      await confirm.click();
      const response = await responsePromise;
      const body = await response.json();
      if (response.status() !== 201 || !body.data?.appointmentId) {
        throw new Error(`Booking not confirmed: HTTP ${response.status()}`);
      }
      // Intentionally retain only identity, never the private manage-link token.
      await writeFile(
        heroPath,
        JSON.stringify(
          {
            applicationSHA: release.approvedFilmingSHA,
            appointmentId: body.data.appointmentId,
            salonId: salon,
            clientName: 'Sarah Morgan',
            expectedClientId: 'video-demo-solo-client-sarah-morgan',
            serviceId: 'video-demo-solo-service-biab-overlay',
            addOnId: 'video-demo-solo-addon-simple-nail-art',
            technicianId: 'video-demo-solo-tech-marie-dupont',
            date: day,
            time: '10:00',
            timezone: 'America/Toronto',
            priceCents: 7500,
            durationMinutes: 90,
            createdThrough: 'real public UI',
            persistenceVerified: false,
          },
          null,
          2,
        ),
      );
      await page
        .getByRole('heading', { name: 'Appointment confirmed', exact: true })
        .waitFor();
      await pause(1800);
      mark('confirmation');
      await page.screenshot({ path: `${root}/qa/booking-confirmed.png` });
      process.stdout.write(
        `${((await page.locator('main').textContent()) || '').slice(0, 4000)}\n`,
      );
      await pause(9000);
      mark('reload-verification');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page
        .getByRole('heading', { name: /Appointment confirmed|Booking received/, exact: true })
        .waitFor();
      await pause(1800);
      await page.screenshot({
        path: `${root}/qa/booking-confirmed-reload.png`,
      });
      await pause(5000);
    }
    mark(book ? 'capture-complete' : 'rehearsal-no-booking-created');
  } finally {
    await context.close();
    await browser.close();
    const path = await video.path();
    await writeFile(
      `${root}/qa/booking-capture-events.json`,
      JSON.stringify(
        {
          mode: book ? 'real-hero-booking' : 'rehearsal',
          rawRecording: path,
          viewport: { width: 390, height: 844 },
          requestedVideo: { width: 780, height: 1688 },
          events,
        },
        null,
        2,
      ),
    );
    process.stdout.write(
      `Capture saved; mode=${book ? 'real-booking' : 'rehearsal'}, events=${events.length}.\n`,
    );
  }
}
main().catch((error) => {
  process.stderr.write(
    `Capture stopped at ${stage} (${error.name}). Inspect private QA; no response tokens logged.\n`,
  );
  process.exitCode = 1;
});

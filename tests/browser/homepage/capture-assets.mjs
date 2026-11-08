import fs from 'node:fs/promises';

import { chromium } from '@playwright/test';
import sharp from 'sharp';

// Start booking-theme (3138) and homepage (3191) Vite fixtures first.
const output = 'public/assets/images/homepage';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'America/Toronto' });
const save = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await sharp(await page.screenshot()).webp({ quality: 86 }).toFile(`${output}/${name}.webp`);
};
await page.goto('http://127.0.0.1:3138/?step=service&isla&service-policy=visible');
await page.getByTestId('service-card-isla-russian').click();
await page.evaluate(() => window.scrollTo(0, 0));
await save('booking-page');
await page.locator('#isla-services-title').scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelector('#isla-services-title').scrollIntoView({ block: 'start' }));
await save('services');
await page.getByRole('button', { name: 'Booking policies', exact: true }).click();
await page.getByRole('dialog', { name: 'Appointment agreement' }).waitFor();
await save('booking-policy');
await page.goto('http://127.0.0.1:3138/?step=time&isla&count=8');
await page.getByRole('button', { name: /10:15/ }).first().waitFor();
await page.getByRole('button', { name: /10:15/ }).first().scrollIntoViewIfNeeded();
await save('available-time');
await page.setViewportSize({ width: 1100, height: 800 });
await page.clock.setFixedTime(new Date('2026-11-10T14:00:00-05:00'));
await page.goto('http://127.0.0.1:3191/calendar.html');
await page.getByTestId('calendar-day-2026-11-10').waitFor();
await page.getByRole('button', { name: 'Weekly', exact: true }).click();
await page.getByText('Sample client A', { exact: true }).waitFor();
await page.waitForTimeout(800);
await page.evaluate(() => document.fonts.ready);
await sharp(await page.screenshot()).resize(1440, 1047).webp({ quality: 86 }).toFile(`${output}/calendar.webp`);
await browser.close();
process.stdout.write('Captured current app components with synthetic fixture data.\n');

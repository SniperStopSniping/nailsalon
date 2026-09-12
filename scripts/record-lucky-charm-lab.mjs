import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const origin = process.env.LUCKY_CHARM_LAB_URL ?? 'http://127.0.0.1:3200/labs/lucky-charm';
const outputDirectory = path.resolve('docs/prototypes/lucky-charm/recordings');
const temporaryDirectory = path.join(outputDirectory, '.playwright');
const materials = [
  { button: /A · Glazed pearl/, file: 'a-glazed-pearl.webm' },
  { button: /B · Liquid chrome/, file: 'b-liquid-chrome.webm' },
  { button: /C · Jelly glass/, file: 'c-jelly-glass.webm' },
];

await mkdir(temporaryDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });

for (const material of materials) {
  const context = await browser.newContext({
    recordVideo: { dir: temporaryDirectory, size: { width: 1280, height: 800 } },
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: material.button }).click();
  await page.getByRole('button', { name: 'Replay' }).click();
  await page.waitForTimeout(3900);

  const video = page.video();
  await context.close();
  const videoPath = await video.path();
  await rename(videoPath, path.join(outputDirectory, material.file));
}

await browser.close();
await rm(temporaryDirectory, { recursive: true, force: true });

import { chmod, readFile } from 'node:fs/promises';

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { config } from 'dotenv';
import { chromium } from 'playwright';

config({
  path: '.env.development.local',
  quiet: true,
});
const origin = process.env.NEXT_PUBLIC_APP_URL;
if (!['http://localhost:3147', 'http://localhost:3148', 'http://localhost:3149'].includes(origin)) {
  throw new Error('Isolated origin required');
}
async function main() {
  if (process.env.APP_ENV !== 'development' || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
    throw new Error('Development instance required');
  }
  const identity = JSON.parse(await readFile('local/video-runtime/clerk-user.json', 'utf8'));
  if (identity.email !== 'atelier-video-20261014+clerk_test@example.com') {
    throw new Error('Synthetic user mismatch');
  }
  await clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    debug: false,
  });
  const browser = await chromium.launch({
    headless: true,
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await setupClerkTestingToken({
      page,
    });
    await page.goto(`${origin}/en/owner-sign-in`, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    await clerk.signIn({
      page,
      emailAddress: identity.email,
    });
    await page.goto(`${origin}/en/admin?salon=atelier-nail-demo`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    let isAuthorized = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const authorized = await page.request.get(`${origin}/api/admin/auth/me?salonSlug=atelier-nail-demo`);
      if (authorized.status() === 200) {
        isAuthorized = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!isAuthorized) {
      throw new Error('Owner workspace authorization not verified');
    }
    await page.getByRole('main').waitFor();
    await context.storageState({
      path: 'local/video-runtime/owner-state.json',
    });
    await chmod('local/video-runtime/owner-state.json', 0o600);
    await page.screenshot({
      path: 'docs/tutorials/verification/owner-first.png',
      fullPage: true,
    });
    process.stdout.write(`${((await page.locator('main').textContent()) || '').slice(0, 4500)}\n`);
    process.stdout.write('Synthetic owner session stored privately.\n');
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  process.stderr.write(`Owner session setup failed (${error.name}). No secret/token diagnostics emitted.\n`);
  process.exitCode = 1;
});

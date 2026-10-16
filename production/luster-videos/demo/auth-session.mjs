import { chmod, readFile } from 'node:fs/promises';

import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from '@clerk/testing/playwright';
import { config } from 'dotenv';
import { chromium } from 'playwright';

config({ path: '.env.development.local', quiet: true });
async function main() {
  if (
    process.env.APP_ENV !== 'development'
    || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')
  ) {
    throw new Error('Development instance required');
  }
  const identity = JSON.parse(
    await readFile('local/video-runtime/clerk-user.json', 'utf8'),
  );
  if (identity.email !== 'atelier-video-20260930+clerk_test@example.com') {
    throw new Error('Synthetic user mismatch');
  }
  await clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    debug: false,
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await setupClerkTestingToken({ page });
    await page.goto('http://localhost:3141/en/owner-sign-in', {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });
    await clerk.signIn({ page, emailAddress: identity.email });
    await page.goto('http://localhost:3141/en/admin?salon=atelier-nail-demo', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    let isAuthorized = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const authorized = await page.request.get(
        'http://localhost:3141/api/admin/auth/me?salonSlug=atelier-nail-demo',
      );
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
      path: 'production/luster-videos/qa/owner-first.png',
      fullPage: true,
    });
    process.stdout.write(
      `${((await page.locator('main').textContent()) || '').slice(0, 4500)}\n`,
    );
    process.stdout.write('Synthetic owner session stored privately.\n');
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  process.stderr.write(
    `Owner session setup failed (${error.name}). No secret/token diagnostics emitted.\n`,
  );
  process.exitCode = 1;
});

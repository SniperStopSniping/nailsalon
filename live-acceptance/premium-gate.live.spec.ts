/**
 * Live development acceptance journey for the premium account gate.
 *
 * Runs against the real 4191 dev server and the real Clerk development
 * instance. Clerk's official testing token (@clerk/testing) is used so the
 * instance's smart CAPTCHA recognises the sanctioned automated run — the
 * product keeps its real bot check; nothing is bypassed in app code.
 *
 * Untracked harness: this directory is not part of the committed test suite.
 */
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

const BASE = process.env.LIVE_BASE_URL ?? 'http://127.0.0.1:4191';
const EVIDENCE = process.env.LIVE_EVIDENCE_DIR
  ?? '/tmp/luster-premium-account-gate/evidence/live-journey';

const uniqueSuffix = process.env.LIVE_RUN_SUFFIX ?? `${Date.now()}`;
const TEST_EMAIL = `isla.owner.${uniqueSuffix}+clerk_test@example.com`;
const TEST_PASSWORD = `Berry-lab-${uniqueSuffix}!x`;
const TEST_CODE = '424242';

test.describe.configure({ mode: 'serial' });

test('premium account gate: full verified email journey to the workspace', async ({ page }) => {
  test.setTimeout(420_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  await setupClerkTestingToken({ page });

  await page.goto(`${BASE}/onboarding-v1`);
  await page.evaluate(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const databases = await window.indexedDB.databases?.() ?? [];
    databases.forEach((database) => {
      if (database.name) {
        window.indexedDB.deleteDatabase(database.name);
      }
    });
  });
  await page.reload();

  // The dev-browser handshake hydrates the client outside the intercepted
  // JSON path, so the testing token's captcha-bypass flag is not yet set.
  // One intercepted client refresh applies it.
  await page.waitForFunction(() => (window as any).Clerk?.loaded, undefined, { timeout: 30_000 });
  await page.evaluate(async () => {
    await (window as any).Clerk.client.reload();
  });
  const bypassReady = await page.evaluate(() =>
    (window as any).Clerk.client?.captchaBypass);
  console.log('BYPASS_AFTER_RELOAD', bypassReady);

  // ---- Onboarding to Final Review ----
  await page.getByRole('button', { name: /Start with One-page/i }).click();
  await page.getByLabel(/Salon or studio name/i).fill('Isla Nail Studio');
  await page.getByLabel(/^Your name/i).fill('Daniela');
  await page.getByText('Solo nail tech', { exact: false }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Continue setting up my site/i }).click();
  await page.getByLabel(/City or general service area/i).fill('Toronto');
  await page.getByText('Home studio', { exact: false }).click();
  await page.getByRole('button', { name: /Save and continue/i }).click();
  await page.getByText('Appointment only', { exact: true }).first().click();
  await page.getByText('Yes', { exact: true }).first().click();
  await page.getByRole('button', { name: /Save booking setup/i }).click();
  await page.getByRole('button', { name: /Choose an About design/i }).click();
  await page.getByRole('button', { name: /Use this design/i }).click();
  await page.getByRole('button', { name: /Save policies/i }).click();
  await page.getByRole('button', { name: /Use Modern/i }).click();
  await page.getByRole('button', { name: /Continue to review/i }).click();
  await expect(page.getByRole('heading', { name: /Review your site/i })).toBeVisible();

  // ---- Save my site → premium account gate ----
  await page.getByRole('button', { name: 'Save my site' }).click();
  await expect(page.getByRole('heading', {
    level: 1,
    name: /Save your site\.\s*Keep building anywhere\./,
  })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toHaveCount(0);
  await expect(page.getByText(/is ready to save/)).toBeVisible();
  await page.screenshot({ fullPage: true, path: `${EVIDENCE}/01-account-gate.png` });

  // ---- Continue with email → create account ----
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByLabel('Email address').fill(TEST_EMAIL);
  await page.screenshot({ path: `${EVIDENCE}/02-email-entry.png` });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create your password' }))
    .toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  // A non-interceptable keepalive client refresh can drop the captcha-bypass
  // flag mid-journey; re-assert it through the intercepted path immediately
  // before account creation.
  await page.evaluate(async () => {
    await (window as any).Clerk.client.reload();
  });
  console.log('BYPASS_BEFORE_CREATE', await page.evaluate(() =>
    (window as any).Clerk.client?.captchaBypass));
  await page.getByRole('button', { name: 'Create account and continue' }).click();

  // Diagnostic sampling while account creation runs.
  for (let tick = 0; tick < 6; tick += 1) {
    await page.waitForTimeout(5_000);
    const diag = await page.evaluate(() => {
      const clerk = (window as any).Clerk;
      const captchaHost = document.getElementById('clerk-captcha');
      return {
        bypass: clerk?.client?.captchaBypass,
        captchaChildren: captchaHost ? captchaHost.childElementCount : 'no-div',
        heading: document.querySelector('h1')?.textContent,
        iframes: [...document.querySelectorAll('iframe')].map(f => f.src.slice(0, 80)),
        signUpStatus: clerk?.client?.signUp?.status,
      };
    });
    console.log(`DIAG t=${(tick + 1) * 5}s`, JSON.stringify(diag));
    if (diag.heading === 'Check your email') {
      break;
    }
  }

  // ---- Email verification ----
  // signUp.create on this development instance can take >10s while clerk-js
  // waits out its internal captcha probe before honouring the bypass.
  await expect(page.getByRole('heading', { level: 1, name: 'Check your email' }))
    .toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(TEST_EMAIL)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/03-verification.png` });
  await page.getByLabel('Verification code').fill(TEST_CODE);
  await page.getByRole('button', { name: 'Verify and save my site' }).click();

  // ---- Claim, save, celebration (org task resolves silently on the way) ----
  await expect(page.getByRole('heading', { level: 1, name: 'Your Luster site is saved' }))
    .toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Isla Nail Studio/).first()).toBeVisible();
  await page.screenshot({ fullPage: true, path: `${EVIDENCE}/04-save-success.png` });

  // ---- Plans only after save ----
  await page.getByRole('button', { name: 'Choose how to start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Choose how you want to start' }))
    .toBeVisible();
  await page.screenshot({ fullPage: true, path: `${EVIDENCE}/05-plans.png` });
  await page.getByRole('button', { name: 'Continue free' }).click();

  // ---- Real workspace handoff ----
  await page.waitForURL(/\/admin\?/, { timeout: 60_000 });
  await expect(page.getByText(/Isla Nail Studio/).first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ fullPage: true, path: `${EVIDENCE}/06-workspace.png` });

  // ---- Sign out, sign back in, same site loads ----
  const signOut = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
  await signOut.click();
  await page.waitForURL(/owner|sign-in|^((?!admin).)*$/, { timeout: 30_000 }).catch(() => undefined);

  await page.goto(`${BASE}/en/owner-sign-in`);
  await page.getByLabel(/email/i).first().fill(TEST_EMAIL);
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.getByLabel(/password/i).first().fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 60_000 });
  await expect(page.getByText(/Isla Nail Studio/).first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ fullPage: true, path: `${EVIDENCE}/07-signed-back-in.png` });

  const meaningfulErrors = consoleErrors.filter(text =>
    !/clerk.*development|deprecat|Download the React DevTools/i.test(text));

  expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
  expect(meaningfulErrors, `console errors: ${meaningfulErrors.join('\n')}`).toEqual([]);
});

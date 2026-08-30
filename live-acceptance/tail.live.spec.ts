/**
 * Journey tail: sign in as the owner created by the main live journey,
 * confirm the saved site loads in the real workspace, sign out, sign back
 * in, and confirm again.
 */
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

const BASE = process.env.LIVE_BASE_URL ?? 'http://127.0.0.1:4191';
const EVIDENCE = process.env.LIVE_EVIDENCE_DIR
  ?? '/tmp/luster-premium-account-gate/evidence/live-journey';
const suffix = process.env.LIVE_RUN_SUFFIX;
if (!suffix) {
  throw new Error('LIVE_RUN_SUFFIX is required for the tail journey');
}
const TEST_EMAIL = `isla.owner.${suffix}+clerk_test@example.com`;
const TEST_PASSWORD = `Berry-lab-${suffix}!x`;

const signInAndVerifyWorkspace = async (
  page: import('@playwright/test').Page,
  shot: string,
) => {
  await page.goto(`${BASE}/en/owner-sign-in`);
  const emailBox = page.getByRole('textbox', { name: /email/i }).first();
  await emailBox.fill(TEST_EMAIL);
  await page.getByRole('button', { name: /^continue$/i }).click();
  const passwordBox = page.getByRole('textbox', { name: /password/i }).first();
  await passwordBox.fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 90_000 });
  await expect(page.getByText(/Isla Nail Studio/).first()).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ fullPage: true, path: `${EVIDENCE}/${shot}` });
};

test('workspace loads for the saved owner across sign-out and sign-in', async ({ page }) => {
  test.setTimeout(360_000);
  await setupClerkTestingToken({ page });

  await signInAndVerifyWorkspace(page, '06-workspace.png');

  const signOut = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
  await signOut.scrollIntoViewIfNeeded();
  await signOut.click();
  await page.waitForURL(url => !/\/admin(\/|\?|$)/.test(url.pathname), { timeout: 60_000 });

  await signInAndVerifyWorkspace(page, '07-signed-back-in.png');
});

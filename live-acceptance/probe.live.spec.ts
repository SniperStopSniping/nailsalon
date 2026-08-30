/** Diagnostic probe: does captchaBypass decay over time / with the captcha div present? */
import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

const BASE = process.env.LIVE_BASE_URL ?? 'http://127.0.0.1:4191';

test('probe captcha bypass decay', async ({ page }) => {
  test.setTimeout(300_000);
  await setupClerkTestingToken({ page });
  await page.goto(`${BASE}/onboarding-v1`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded, undefined, { timeout: 30_000 });

  const samples: Array<{ at: number; bypass: boolean }> = [];
  const sample = async (at: number) => {
    const bypass = await page.evaluate(() => (window as any).Clerk.client?.captchaBypass);
    samples.push({ at, bypass });
  };

  await sample(0);
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'clerk-captcha';
    document.body.appendChild(div);
  });
  for (const wait of [30, 60, 90, 120]) {
    await page.waitForTimeout(30_000);
    await sample(wait);
  }

  const outcome = await page.evaluate(async () => {
    const clerk = (window as any).Clerk;
    try {
      const created = await Promise.race([
        clerk.client.signUp.create({
          emailAddress: `probe.decay.${Date.now()}+clerk_test@example.com`,
          password: `Probe-${Date.now()}!x`,
        }).then((r: any) => ({ ok: true, status: r.status })),
        new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 45_000)),
      ]);
      return { bypassAtCreate: clerk.client?.captchaBypass, created };
    } catch (error: any) {
      return {
        bypassAtCreate: clerk.client?.captchaBypass,
        error: { code: error?.errors?.[0]?.code, message: String(error?.message).slice(0, 200) },
      };
    }
  });

  console.log('PROBE4_RESULT', JSON.stringify({ outcome, samples }, null, 1));
  expect(samples.length).toBeGreaterThan(0);
});

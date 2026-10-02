import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { chromium, webkit } from 'playwright';

const evidence = [];
const root = 'production/luster-videos/qa';
const origin = 'http://localhost:3141';
for (const [name, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Toronto' });
    const page = await context.newPage();
    await page.goto(`${origin}/atelier-nail-demo`, { waitUntil: 'domcontentloaded' });
    const service = page.getByTestId('service-card-video-demo-solo-service-biab-overlay');
    await service.waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    assert.equal(overflow, false, `${name}: public page must not overflow horizontally`);
    await service.click();
    await page.getByRole('button', { name: 'Add Simple Nail Art', exact: true }).click();
    await page.getByTestId('service-continue-button').click();
    await page.getByTestId('calendar-day-2026-10-02').click();
    await page.getByTestId('time-slot-10:00').click();
    await page.getByLabel('Customer name').waitFor();
    await page.getByLabel('Customer name').fill('Sarah Morgan');
    await page.getByLabel('Customer email').fill('sarah.morgan@example.invalid');
    await page.getByLabel('Customer phone').fill('4165550101');
    const confirm = page.getByRole('button', { name: 'Confirm appointment · $75.00', exact: true });
    assert.equal(await confirm.isDisabled(), true, 'Required agreement cannot be skipped');
    await page.getByTestId('booking-policy-acknowledgment').getByRole('checkbox').check();
    assert.equal(await confirm.isEnabled(), true);
    await page.screenshot({ path: `${root}/booking-mobile-${name}.png`, fullPage: true });
    evidence.push({ browser: name, mobileEmulation: true, realDevice: false, viewport: '390x844', steps: ['service', 'optional add-on', 'date', 'available time', 'review', 'details', 'required agreement'], rootHorizontalOverflow: false, requiredAgreementEnforced: true, submitted: false });
    await context.close();
  } finally {
    await browser.close();
  }
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/atelier-nail-demo`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('service-card-video-demo-solo-service-biab-overlay').waitFor();
  const focusedControls = [];
  for (let i = 0; i < 7; i += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return { tag: element.tagName, label: element.getAttribute('aria-label'), text: element.textContent?.slice(0, 90), focusVisible: element.matches(':focus-visible'), outline: style.outline, boxShadow: style.boxShadow };
    });
    focusedControls.push(focus);
  }
  assert.ok(focusedControls.some(control => control.focusVisible && (control.outline !== 'rgb(0, 0, 0) none 0px' || control.boxShadow !== 'none')));
  await page.screenshot({ path: `${root}/booking-desktop-keyboard.png` });
  evidence.push({ browser: 'chromium', viewport: '1440x900', keyboardTraversal: focusedControls, textScaling200Percent: 'pending native browser text-scale check; not claimed from device pixel ratio' });
} finally {
  await browser.close();
}
await writeFile(`${root}/booking-ui-verification.json`, JSON.stringify(evidence, null, 2));
process.stdout.write('PASS: Chromium and WebKit mobile rehearsal, required consent, no extra booking, desktop keyboard traversal. Native text scaling remains pending.\n');

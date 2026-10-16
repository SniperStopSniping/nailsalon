/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { config } from 'dotenv';
import { chromium } from 'playwright';

config({
  path: '.env.development.local',
  quiet: true,
});
if (process.env.NEXT_PUBLIC_APP_URL !== 'http://localhost:3149' || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('Local synthetic runtime required');
}
await clerkSetup({
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});
const browser = await chromium.launch({
  headless: true,
});
const ctx = await browser.newContext({
  storageState: 'local/video-runtime/owner-state.json',
  viewport: {
    width: 390,
    height: 844,
  },
});
const page = await ctx.newPage();
await setupClerkTestingToken({
  page,
});
const slug = process.env.TUTORIAL_TEAM === 'true' ? 'atelier-nail-demo-salon' : 'atelier-nail-demo';
await page.goto(`http://localhost:3149/en/admin?salon=${slug}`);
await page.getByRole('button', {
  name: 'New Appointment',
  exact: true,
}).waitFor({
  timeout: 60000,
});
for (const name of process.argv.slice(2)) {
  let l;
  if (name.startsWith('#')) {
    l = page.getByTestId(name.slice(1));
  } else if (name.startsWith('@')) {
    l = page.getByRole('combobox', {
      name: 'Client profile section',
    });
  } else if (name.startsWith('~')) {
    l = page.getByRole('button', {
      name: new RegExp(`^${name.slice(1)}`),
    });
  } else if (name.startsWith('$')) {
    l = page.getByTestId('clients-directory-scroll').getByText(name.slice(1), {
      exact: true,
    });
  } else if (name.startsWith('>')) {
    l = page.getByRole('link', {
      name: new RegExp(`^${name.slice(1)}`),
    });
  } else {
    l = page.getByRole('button', {
      name,
      exact: true,
    });
  }
  if (name.startsWith('@')) {
    await l.selectOption(name.slice(1));
  } else {
    await l.click();
  }
  await page.waitForTimeout(800);
  await page.getByText('Getting your studio ready…', {
    exact: true,
  }).waitFor({
    state: 'hidden',
    timeout: 60000,
  });
  await page.waitForTimeout(500);
}
console.log((await page.locator('body').innerText()).slice(-23000));
console.log(JSON.stringify(await page.locator('button,input,textarea,select,summary').evaluateAll(es => es.filter(e => e.getBoundingClientRect().width > 0).map(e => ({
  tag: e.tagName,
  text: (e.innerText || '').slice(0, 100),
  label: e.getAttribute('aria-label'),
  id: e.id,
  testid: e.getAttribute('data-testid'),
  type: e.getAttribute('type'),
  disabled: e.disabled,
  value: e.value,
  options: e.options ? [...e.options].slice(0, 12).map(o => [o.value, o.text]) : undefined,
}))), null, 2));
await page.screenshot({
  path: '/tmp/luster-inspect.png',
  fullPage: true,
});
await browser.close();

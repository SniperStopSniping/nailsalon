/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { config } from 'dotenv';
import { chromium } from 'playwright';

import { beginScreenRecording } from './screencast.mjs';

config({
  path: '.env.development.local',
  quiet: true,
});
const origin = 'http://localhost:3149';
let slug = 'atelier-nail-demo';
if (process.env.NEXT_PUBLIC_APP_URL !== origin || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('Guarded development recording origin required');
}
const sourceIdentity = JSON.parse(await readFile('local/video-runtime/compiled-source.json', 'utf8'));
if (sourceIdentity.compiledBuildId !== (await readFile('.next/BUILD_ID', 'utf8')).trim()) {
  throw new Error('Build identity changed; restart the verified runtime before recording');
}
sourceIdentity.workingTreeSourcePatchSha256 = createHash('sha256').update(execFileSync('git', ['diff', '--', 'src'])).digest('hex');
const id = process.argv[2];
if (!/^[a-z-]+$/.test(id || '')) {
  throw new Error('Tutorial id required');
}
const queue = JSON.parse(await readFile('docs/tutorials/library-queue.json', 'utf8'));
const queued = queue.find(x => x.id === id);
if (!queued) {
  throw new Error('Unknown tutorial');
}
if (queued.status.startsWith('blocked_')) {
  throw new Error('This workflow is blocked; verify its prerequisites before updating the queue.');
}
let existing;
try {
  existing = JSON.parse(await readFile(`docs/tutorials/verification/${id}-evidence.json`, 'utf8'));
} catch {}
if (existing?.completed && !process.argv.includes('--retake')) {
  throw new Error('Verified take preserved. Review the synthetic fixture state and use --retake only for an intentional new take.');
}
const flowModule = await import(`./flows/${id}.mjs`);
const flow = flowModule.default;
if (flowModule.salon) {
  if (!['atelier-nail-demo', 'atelier-nail-demo-salon'].includes(flowModule.salon)) {
    throw new Error('Synthetic salon required');
  }
  slug = flowModule.salon;
}
await clerkSetup({
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  debug: false,
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
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
});
await ctx.addInitScript(() => {
  window.__tutorialTaps = [];
  document.addEventListener('pointerdown', (e) => {
    const captured = {
      epoch: Date.now(),
      x: e.clientX,
      y: e.clientY,
    };
    window.__tutorialTaps.push(captured);
    void window.__tutorialRecordTap?.(captured);
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'fixed',
      left: `${e.clientX - 22}px`,
      top: `${e.clientY - 22}px`,
      width: '44px',
      height: '44px',
      border: '2px solid #b85075',
      borderRadius: '50%',
      background: '#dba2b144',
      pointerEvents: 'none',
      zIndex: 2147483647,
    });
    document.body.append(dot);
    dot.animate([{
      transform: 'scale(.55)',
      opacity: 1,
    }, {
      transform: 'scale(1.3)',
      opacity: 0,
    }], {
      duration: 700,
    }).finished.then(() => dot.remove());
  }, true);
});
const actualTaps = [];
await ctx.exposeBinding('__tutorialRecordTap', ({
  page: target,
}, event) => {
  actualTaps.push({
    ...event,
    target,
  });
});
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(60000);
await setupClerkTestingToken({
  page,
});
let recording;
const steps = [];
const errors = [];
const evidence = {};
let zero = 0;
page.on('pageerror', e => errors.push(e.message));
const wait = ms => page.waitForTimeout(ms);
const settled = async () => {
  await page.waitForFunction(() => ![...document.querySelectorAll('[class*="animate-pulse"]')].some(e => e.getBoundingClientRect().width > 0) && !document.body.innerText.includes('Checking free-text allowance') && !document.body.innerText.includes('Loading your text balance'), {}, {
    timeout: 45000,
  });
};
const tap = async (l) => {
  await l.scrollIntoViewIfNeeded();
  const testId = await l.getAttribute('data-testid');
  await l.click({
    trial: true,
  });
  await wait(250);
  const before = actualTaps.length;
  await l.click();
  for (let retry = 0; retry < 5 && actualTaps.length === before; retry++) {
    await wait(20);
  }
  const event = actualTaps.slice(before).find(e => e.target === page);
  if (!event) {
    throw new Error('Actual pointer event missing');
  }
  const active = steps.at(-1);
  if (active && !('end' in active)) {
    active.clicks ??= [];
    active.clicks.push({
      t: (event.epoch - zero) / 1000,
      x: event.x,
      y: event.y,
    });
    active.lastClick = active.clicks.at(-1).t;
  }
  await wait(220);
  if (testId === 'owner-nav-more') {
    await page.getByTestId('sms-balance-card').waitFor({
      timeout: 45000,
    });
    await settled();
    const active = steps.at(-1);
    const now = (Date.now() - zero) / 1000;
    if (active && !('end' in active) && active.lastClick && now - active.lastClick > 0.15) {
      active.cuts ??= [];
      active.cuts.push({
        start: active.lastClick + 0.07,
        end: now,
        reason: 'Actual More balance loading interval removed; real tap and settled UI retained',
      });
    }
  }
};
const fill = async (l, value) => {
  await tap(l);
  await l.fill(value);
  await wait(400);
};
const ready = async (l, trim = true) => {
  await l.waitFor({
    state: 'visible',
    timeout: 45000,
  });
  const active = steps.at(-1);
  const now = (Date.now() - zero) / 1000;
  if (trim && active?.lastClick && now - active.lastClick > 0.15) {
    active.cuts ??= [];
    active.cuts.push({
      start: active.lastClick + 0.07,
      end: now,
      reason: 'Actual navigation/save waiting interval; real click and confirmed result retained',
    });
  }
  return l;
};
const navigate = async (url, locator) => {
  if (new URL(url, page.url()).origin !== origin) {
    throw new Error('Tutorial navigation must stay local');
  }
  const a = (Date.now() - zero) / 1000;
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
  });
  await locator.waitFor({
    state: 'visible',
    timeout: 45000,
  });
  const b = (Date.now() - zero) / 1000;
  const active = steps.at(-1);
  if (active && !('end' in active) && b - a > 0.15) {
    active.cuts ??= [];
    active.cuts.push({
      start: a + 0.07,
      end: b,
      reason: 'Actual local navigation waiting interval; source and confirmed destination retained',
    });
  }
};
const step = async (heading, benefit, fn, hold = 1700) => {
  console.log(`${id}: ${heading}`);
  const s = {
    heading,
    benefit,
    start: (Date.now() - zero) / 1000,
  };
  steps.push(s);
  if (fn) {
    await fn();
  }
  s.readyAt = (Date.now() - zero) / 1000;
  await wait(hold);
  s.end = (Date.now() - zero) / 1000;
  await page.screenshot({
    path: `docs/tutorials/verification/${id}-${steps.length}.png`,
  });
};
const post = async (action, path, parseBody = false) => {
  const promise = page.waitForResponse(r => new URL(r.url()).pathname === path && ['POST', 'PATCH', 'PUT'].includes(r.request().method()), {
    timeout: 45000,
  });
  await action();
  const r = await promise;
  console.log(`${id}: actual save response ${r.status()}`);
  if (!r.ok()) {
    throw new Error(`Real save failed: ${r.status()}`);
  }
  if (!parseBody) {
    return {
      httpStatus: r.status(),
    };
  }
  let timer;
  try {
    return await Promise.race([r.json(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Save response body unavailable; verify the existing saved record before any new take')), 10000);
    })]);
  } finally {
    clearTimeout(timer);
  }
};
const api = async (path) => {
  const r = await page.request.get(origin + path);
  if (!r.ok()) {
    throw new Error(`Verification GET failed: ${path} ${r.status()}`);
  }
  return r.json();
};
try {
  await page.goto(`${origin}/en/admin?salon=${slug}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await ready(page.getByRole('button', {
    name: 'New Appointment',
    exact: true,
  }));
  await page.waitForFunction(() => ![...document.querySelectorAll('[class*="animate-pulse"]')].some(e => e.getBoundingClientRect().width > 0), {}, {
    timeout: 45000,
  });
  await wait(1200);
  if (flowModule.prepare) {
    await flowModule.prepare({
      page,
      ctx,
      origin,
      slug,
      tap,
      fill,
      ready,
      wait,
      post,
      api,
    });
    await page.goto(`${origin}/en/admin?salon=${slug}`, {
      waitUntil: 'domcontentloaded',
    });
    await ready(page.getByRole('button', {
      name: 'New Appointment',
      exact: true,
    }));
    await settled();
    await wait(1200);
  }
  recording = await beginScreenRecording(page, id);
  zero = recording.zero * 1000;
  await wait(350);
  await flow({
    page,
    ctx,
    origin,
    slug,
    tap,
    fill,
    ready,
    wait,
    navigate,
    step,
    post,
    api,
    evidence,
  });
  if (errors.length) {
    throw new Error(`Browser errors: ${errors.join('; ')}`);
  }
  evidence.completed = true;
  evidence.sourceIdentity = sourceIdentity;
} catch (e) {
  console.error(e.message);
  evidence.completed = false;
  evidence.error = e.message;
  console.log((await page.locator('body').innerText()).slice(-6000));
  await page.screenshot({
    path: `docs/tutorials/verification/${id}-failure.png`,
  }).catch(() => {});
  process.exitCode = 1;
}
if (recording) {
  const raw = await recording.finish();
  await writeFile(`docs/tutorials/recordings/${id}-timeline.json`, JSON.stringify({
    id,
    raw: raw.replace('docs/tutorials/', ''),
    sourceCommit: sourceIdentity.sourceCommit,
    sourceIdentity,
    completed: evidence.completed,
    steps,
  }, null, 2));
}
await writeFile(`docs/tutorials/verification/${id}-evidence.json`, JSON.stringify(evidence, null, 2));
await browser.close();

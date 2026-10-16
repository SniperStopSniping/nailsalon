/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
import { readFile, writeFile } from 'node:fs/promises';

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { config } from 'dotenv';
import { chromium } from 'playwright';

import { beginScreenRecording } from './screencast.mjs';

config({
  path: '.env.development.local',
  quiet: true,
});
if (!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('Development authentication required');
}
await clerkSetup({
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  debug: false,
});
const handSvg = await readFile('docs/tutorials/assets/hand-pointer.svg', 'utf8');
const kind = process.argv[2] || 'service';
const origin = `http://localhost:${['noshow', 'warning'].includes(kind) ? '3148' : '3147'}`;
const slug = kind === 'warning' ? 'atelier-nail-demo-salon' : 'atelier-nail-demo';
const browser = await chromium.launch({
  headless: true,
});
const ctx = await browser.newContext({
  viewport: {
    width: 390,
    height: 844,
  },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
});
await ctx.addInitScript(() => {
  document.addEventListener('pointerdown', (e) => {
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
      zIndex: '2147483647',
    });
    document.body.append(dot);
    dot.animate([{
      transform: 'scale(.55)',
      opacity: 1,
    }, {
      transform: 'scale(1.3)',
      opacity: 0,
    }], {
      duration: 750,
      easing: 'ease-out',
    }).finished.then(() => dot.remove());
  }, true);
  new MutationObserver(() => {
    document.querySelectorAll('nextjs-portal').forEach(e => e.style.display = 'none');
  }).observe(document, {
    subtree: true,
    childList: true,
  });
});
const page = await ctx.newPage();
await setupClerkTestingToken({
  page,
});
const nativeGoto = page.goto.bind(page);
page.goto = (url, options = {}) => nativeGoto(url, {
  waitUntil: 'domcontentloaded',
  timeout: 90000,
  ...options,
});
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
let zero = Date.now();
let recording;
const steps = [];
const wait = ms => page.waitForTimeout(ms);
const step = async (heading, body, act, hold = 1900) => {
  console.log(heading);
  const item = {
    heading,
    body,
    start: (Date.now() - zero) / 1000,
  };
  steps.push(item);
  if (act) {
    await act();
  }
  item.readyAt = (Date.now() - zero) / 1000;
  await wait(hold);
  item.end = (Date.now() - zero) / 1000;
  await page.screenshot({
    path: `docs/tutorials/verification/${kind}-${steps.length}.png`,
  });
};
const tap = async (l) => {
  await l.scrollIntoViewIfNeeded();
  await wait(350);
  const box = await l.boundingBox();
  if (!box) {
    throw new Error('Tap target missing');
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(async ({
    x,
    y,
    svg,
  }) => {
    let h = document.getElementById('tutorial-hand');
    if (!h) {
      h = document.createElement('div');
      h.id = 'tutorial-hand';
      h.innerHTML = svg;
      Object.assign(h.style, {
        position: 'fixed',
        width: '44px',
        height: '52px',
        pointerEvents: 'none',
        zIndex: 2147483647,
        left: '185px',
        top: '710px',
        filter: 'drop-shadow(0 2px 2px #51343f30)',
      });
      document.body.append(h);
    }
    h.getAnimations().forEach(a => a.cancel());
    h.style.opacity = '1';
    const rotation = y > 770 ? 180 : 0;
    h.style.transformOrigin = '18px 5px';
    h.style.transform = `rotate(${rotation}deg)`;
    const anim = h.animate([{
      left: h.style.left,
      top: h.style.top,
    }, {
      left: `${x - 18}px`,
      top: `${y - 5}px`,
    }], {
      duration: 320,
      easing: 'ease-in-out',
      fill: 'forwards',
    });
    await anim.finished;
    h.style.left = `${x - 18}px`;
    h.style.top = `${y - 5}px`;
    anim.cancel();
    h.animate([{
      transform: `rotate(${rotation}deg) scale(1)`,
    }, {
      transform: `rotate(${rotation}deg) scale(.88)`,
    }, {
      transform: `rotate(${rotation}deg) scale(1)`,
    }], {
      duration: 400,
    });
  }, {
    x,
    y,
    svg: handSvg,
  });
  await wait(160);
  const t = (Date.now() - zero) / 1000;
  const active = steps.at(-1);
  if (active) {
    active.clicks ??= [];
    active.clicks.push({
      t,
      x,
      y,
    });
    active.lastClick = t;
  }
  await l.click();
  await wait(350);
  await page.evaluate(() => {
    const h = document.getElementById('tutorial-hand');
    if (h) {
      h.animate([{
        opacity: 1,
      }, {
        opacity: 0,
      }], {
        duration: 250,
        fill: 'forwards',
      });
    }
  }).catch(() => {});
};
const assert = async (l) => {
  await l.waitFor({
    state: 'visible',
    timeout: 90000,
  });
  const active = steps.at(-1);
  const now = (Date.now() - zero) / 1000;
  if (active?.lastClick && now - active.lastClick > 0.12) {
    active.cuts ??= [];
    active.cuts.push({
      start: active.lastClick + 0.03,
      end: now,
      reason: 'Verified navigation/save wait omitted; actual click and result retained',
    });
  }
};
const evidence = {};
try {
  console.log('Preparing a fresh synthetic owner session in the recording browser.');
  await page.goto(`${origin}/en/owner-sign-in`);
  const identity = JSON.parse(await readFile('local/video-runtime/clerk-user.json', 'utf8'));
  if (identity.email !== 'atelier-video-20261014+clerk_test@example.com') {
    throw new Error('Unexpected test identity');
  }
  await clerk.signIn({
    page,
    emailAddress: identity.email,
  });
  for (const path of [`/api/admin/auth/me?salonSlug=${slug}`, `/api/salon/services?salonSlug=${slug}`]) {
    const warm = await page.request.get(origin + path, {
      timeout: 90000,
    });
    if (warm.status() !== 200) {
      throw new Error(`Isolated prewarm authorization failed: ${warm.status()}`);
    }
  }
  if (kind === 'customize') {
    await page.goto(`${origin}/en/admin/booking-page?salon=${slug}&panel=appearance`);
    await page.getByRole('button', {
      name: /^Soft/,
    }).waitFor();
    await page.goto(`${origin}/admin/booking-page/preview/${slug}`);
    await page.getByText('Private preview of your booking page', {
      exact: true,
    }).waitFor();
  }
  await page.goto(`${origin}/en/admin?salon=${slug}`);
  await Promise.race([page.getByTestId('owner-nav-more').waitFor({
    timeout: 90000,
  }), page.getByRole('button', {
    name: 'Try again',
    exact: true,
  }).waitFor({
    timeout: 90000,
  })]);
  if (await page.getByRole('button', {
    name: 'Try again',
    exact: true,
  }).isVisible()) {
    await page.getByRole('button', {
      name: 'Try again',
      exact: true,
    }).click();
  }
  await assert(page.getByTestId('owner-nav-more'));
  await wait(2000);
  recording = await beginScreenRecording(page, kind);
  zero = recording.zero * 1000;
  await wait(500);
  if (kind === 'warning') {
    await step('07  Open the second salon', 'An authorized salon opens its own client list.', async () => {
      await tap(page.getByTestId('owner-nav-clients'));
      await assert(page.getByText('Maya Singh', {
        exact: true,
      }).first());
    }, 2200);
    await step('08  View recorded history', 'Open the client to see the limited warning.', async () => {
      await tap(page.getByText('Maya Singh', {
        exact: true,
      }).first());
      await assert(page.getByTestId('booking-risk-warning'));
      await page.getByTestId('booking-risk-warning').scrollIntoViewIfNeeded();
    }, 4000);
    evidence.warning = await page.getByTestId('booking-risk-warning').innerText();
    if (!evidence.warning.includes('1 eligible no-show')) {
      throw new Error('Incorrect shared count');
    }
    await step('You choose how to proceed', 'Recorded history. No automatic customer blocking.', null, 3000);
    await step('Mistakes can be reviewed', 'Owners can correct reports; clients can request review.', null, 3200);
  } else if (kind === 'customize') {
    const reset = await page.request.post(`${origin}/api/admin/booking-page?salonSlug=atelier-nail-demo`, {
      data: {
        action: 'revert',
      },
    });
    if (!reset.ok()) {
      throw new Error('Synthetic draft reset failed');
    }
    await step('01  Open your website', 'From your dashboard, tap More.', () => tap(page.getByTestId('owner-nav-more')));
    await step('02  Open Booking Page', 'Your website tools are all together.', async () => {
      await tap(page.getByRole('button', {
        name: /^Booking Page/,
      }));
      await assert(page.getByRole('link', {
        name: /^Style, Colours/,
      }));
    });
    await step('03  Choose your style', 'Open Style, Colours & Fonts.', async () => {
      await tap(page.getByRole('link', {
        name: /^Style, Colours/,
      }));
      await assert(page.getByRole('button', {
        name: /^Soft/,
      }));
    });
    await step('04  Make it feel like you', 'Choose Soft, then Blush & Cocoa.', async () => {
      await tap(page.getByRole('button', {
        name: /^Soft/,
      }));
      await wait(1200);
      await tap(page.getByRole('button', {
        name: /^Blush & Cocoa/,
      }));
      await wait(1800);
    });
    await step('05  Pick an elegant heading', 'Choose Newsreader for your headings.', async () => {
      await tap(page.getByRole('button', {
        name: /^Newsreader heading font/,
      }));
      await wait(1800);
    });
    await step('06  Preview your saved draft', 'Your live page stays unchanged.', async () => {
      const preview = page.getByRole('link', {
        name: 'Preview draft',
        exact: true,
      });
      const url = await preview.getAttribute('href');
      const opened = ctx.waitForEvent('page');
      await tap(preview);
      const popup = await opened;
      await page.goto(new URL(url, page.url()).href);
      await popup.close();
      await page.waitForLoadState('domcontentloaded');
      await assert(page.getByText('Private preview of your booking page', {
        exact: true,
      }));
      await wait(1500);
    }, 2800);
    evidence.previewUrl = page.url();
    const res = await page.request.get(`${origin}/api/admin/booking-page?salonSlug=atelier-nail-demo`);
    evidence.status = res.status();
    evidence.config = await res.json();
    if (res.status() !== 200) {
      throw new Error('Saved draft could not be verified');
    }
  } else if (kind === 'noshow') {
    await step('01  Open the appointment', 'The client has confirmed they cannot attend.', async () => {
      await tap(page.getByTestId('owner-current-next-appointment').getByRole('button', {
        name: /BIAB Overlay/,
      }));
      await assert(page.getByRole('button', {
        name: /Details.*Show/,
      }));
    });
    await step('02  Find the no-show action', 'Open Details to see other actions.', async () => {
      await tap(page.getByRole('button', {
        name: /Details.*Show/,
      }));
      await assert(page.getByRole('button', {
        name: 'Mark no-show',
        exact: true,
      }));
    });
    await step('03  Mark No-Show', 'Reporting opens 24 hours before the visit.', async () => {
      await tap(page.getByRole('button', {
        name: 'Mark no-show',
        exact: true,
      }));
      await assert(page.getByRole('alertdialog'));
    });
    await step('04  Choose the confirmed reason', 'Select the reason that matches the conversation.', async () => {
      await tap(page.getByRole('radio', {
        name: /Customer confirmed/,
      }));
    }, 2300);
    await step('05  A private note is optional', 'Keep any private details out of shared history.', async () => {
      await tap(page.getByText('Add a private note (optional)', {
        exact: true,
      }));
    }, 2200);
    await step('06  Confirm the report', 'Wait for the saved and shared acknowledgement.', async () => {
      await tap(page.getByRole('button', {
        name: 'Confirm no-show',
        exact: true,
      }));
      await assert(page.getByText('No-show saved', {
        exact: true,
      }));
      await assert(page.getByText(/now shared with participating/));
    }, 3300);
    const r = await page.request.get(`${origin}/api/admin/clients/video-demo-team-client-maya-singh?salonSlug=atelier-nail-demo-salon`);
    evidence.secondSalonResponseStatus = r.status();
    evidence.secondSalonProfile = await r.json();
    await step('07  Check the limited shared history', 'Open the client at a second participating salon.', async () => {
      const done = page.getByRole('button', {
        name: 'Done',
        exact: true,
      });
      if (await done.isVisible()) {
        await tap(done);
      }
      const navigationStart = (Date.now() - zero) / 1000;
      await page.goto(`${origin}/en/admin?salon=atelier-nail-demo-salon`);
      await page.getByTestId('owner-nav-clients').waitFor();
      steps.at(-1).cuts ??= [];
      steps.at(-1).cuts.push({
        start: navigationStart,
        end: (Date.now() - zero) / 1000,
        reason: 'Second-salon navigation wait omitted; real destination retained',
      });
      await tap(page.getByTestId('owner-nav-clients'));
      await assert(page.getByText('Maya Singh', {
        exact: true,
      }).first());
      await tap(page.getByText('Maya Singh', {
        exact: true,
      }).first());
      await assert(page.getByTestId('booking-risk-warning'));
      await page.getByTestId('booking-risk-warning').scrollIntoViewIfNeeded();
    }, 3400);
    evidence.warning = await page.getByTestId('booking-risk-warning').innerText();
    if (!evidence.warning.includes('1 eligible no-show')) {
      throw new Error('Shared count did not propagate');
    }
    await step('Recorded history, handled fairly', 'Mistakes can be corrected. Clients can request review.', null, 3000);
  } else if (kind === 'serviceextras') {
    await tap(page.getByTestId('owner-nav-services'));
    await assert(page.getByText('Luster Gel Manicure', {
      exact: true,
    }).first());
    await tap(page.getByText('Luster Gel Manicure', {
      exact: true,
    }).first());
    await assert(page.getByTestId('service-addons-summary-manage'));
    await step('07  Choose your add-ons', 'Offer extras with Luster Gel Manicure.', async () => {
      await tap(page.getByTestId('service-addons-summary-manage'));
      await assert(page.getByTestId('service-addon-picker'));
    });
    await step('08  Add French tips & chrome', 'Select the finishes your clients can choose.', async () => {
      await tap(page.getByRole('checkbox', {
        name: /^French Tips/,
      }));
      await tap(page.getByRole('checkbox', {
        name: /^Chrome/,
      }));
    }, 1700);
    await step('09  Include art & removal', 'Choose Glitter and removal from another salon.', async () => {
      await tap(page.getByRole('checkbox', {
        name: /^Glitter/,
      }));
      await tap(page.getByRole('checkbox', {
        name: /^Removal from Another Salon/,
      }));
    }, 1700);
    await step('10  Save your add-ons', 'Tap Done to save the selected extras.', async () => {
      await tap(page.getByTestId('service-addon-picker-save'));
      await assert(page.getByTestId('service-addons-summary-names'));
    }, 2200);
    evidence.savedNames = await page.getByTestId('service-addons-summary-names').innerText();
    for (const name of ['French Tips', 'Chrome', 'Glitter', 'Removal from Another Salon']) {
      if (!evidence.savedNames.includes(name)) {
        throw new Error(`Missing saved extra: ${name}`);
      }
    }
    await step('Your service, with all the extras', 'Clients can choose these add-ons when booking.', async () => {
      await page.getByTestId('service-addons-summary').scrollIntoViewIfNeeded();
    }, 2500);
    // Independent reload and picker verification; not represented as an extra video step.
    await page.goto(`${origin}/en/admin?salon=${slug}`);
    await page.getByTestId('owner-nav-services').click();
    await page.getByText('Luster Gel Manicure', {
      exact: true,
    }).first().click();
    await page.getByTestId('service-addons-summary-names').waitFor();
    evidence.reopenedNames = await page.getByTestId('service-addons-summary-names').innerText();
    await page.getByTestId('service-addons-summary-manage').click();
    await page.getByTestId('service-addon-picker').waitFor();
    evidence.selected = [];
    for (const name of ['French Tips', 'Chrome', 'Glitter', 'Removal from Another Salon']) {
      if ((await page.getByRole('checkbox', {
        name: new RegExp(`^${name}`),
      }).getAttribute('aria-checked')) !== 'true') {
        throw new Error(`Selection did not persist: ${name}`);
      }
      evidence.selected.push(name);
    }
    await page.getByTestId('service-addon-picker-cancel').click();
  } else if (kind === 'service') {
    await step('01  Open your services', 'Tap Services in the bottom menu.', async () => {
      await tap(page.getByTestId('owner-nav-services'));
      await assert(page.getByRole('button', {
        name: /^BIAB Overlay/,
      }));
    });
    await step('02  Add a new service', 'Tap + Service to open the form.', async () => {
      await tap(page.getByRole('button', {
        name: 'New service',
        exact: true,
      }));
      await assert(page.getByLabel('Name', {
        exact: true,
      }));
    });
    await step('03  Set the essentials', 'Add a name, price and duration.', async () => {
      await tap(page.getByLabel('Name', {
        exact: true,
      }));
      await page.getByLabel('Name', {
        exact: true,
      }).fill('Luster Gel Manicure');
      await wait(600);
      await tap(page.getByLabel('Price', {
        exact: true,
      }));
      await page.getByLabel('Price', {
        exact: true,
      }).fill('55');
      await wait(600);
      await tap(page.getByLabel('Duration', {
        exact: true,
      }));
      await page.getByLabel('Duration', {
        exact: true,
      }).fill('60');
      await wait(600);
    });
    await step('04  Save your service', 'Save Service adds it to your menu.', async () => {
      await tap(page.getByRole('button', {
        name: 'Save Service',
        exact: true,
      }));
      await assert(page.getByRole('button', {
        name: 'Edit',
        exact: true,
      }));
    }, 2500);
    await step('05  Edit it whenever needed', 'Tap Edit and update the price.', async () => {
      await tap(page.getByRole('button', {
        name: 'Edit',
        exact: true,
      }));
      await assert(page.getByLabel('Price', {
        exact: true,
      }));
      await tap(page.getByLabel('Price', {
        exact: true,
      }));
      await page.getByLabel('Price', {
        exact: true,
      }).fill('60');
    }, 2000);
    await step('06  Save your updated price', 'Tap Update Service to save the change.', async () => {
      await tap(page.getByRole('button', {
        name: 'Update Service',
        exact: true,
      }));
      await assert(page.getByRole('button', {
        name: 'Edit',
        exact: true,
      }));
    }, 2500);
    await step('Saved and ready', 'Your service is saved: $60 for 60 minutes.', null, 2500);
    await page.goto(`http://localhost:3147/en/admin?salon=${slug}`);
    await page.getByTestId('owner-nav-services').click();
    await assert(page.locator('[data-testid^=service-row-]').filter({
      has: page.getByText('Luster Gel Manicure', {
        exact: true,
      }),
    }));
    evidence.savedRow = await page.locator('[data-testid^=service-row-]').filter({
      has: page.getByText('Luster Gel Manicure', {
        exact: true,
      }),
    }).innerText();
    if (!evidence.savedRow.includes('60.00')) {
      throw new Error('Price did not persist');
    }
  }
  await writeFile(`docs/tutorials/verification/${kind}-evidence.json`, JSON.stringify(evidence, null, 2));
} catch (e) {
  console.error(e.message);
  await page.screenshot({
    path: `docs/tutorials/verification/${kind}-failure.png`,
    timeout: 5000,
  }).catch(() => {});
  console.log((await page.locator('body').innerText()).slice(-6500));
  process.exitCode = 1;
}
if (!recording) {
  await ctx.close();
  await browser.close();
  throw new Error('No verified recording session was started');
}
const raw = await recording.finish();
await ctx.close();
await browser.close();
await writeFile(`docs/tutorials/recordings/${kind}-timeline.json`, JSON.stringify({
  raw: raw.replace('docs/tutorials/', ''),
  steps,
}, null, 2));
console.log(JSON.stringify({
  kind,
  raw,
  steps: steps.length,
}));

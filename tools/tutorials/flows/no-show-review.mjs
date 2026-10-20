import { readFile } from 'node:fs/promises';

const appointmentId = 'video-library-confirmed-nonattendance-4';
let manageUrl;
export async function prepare({
  page,
  origin,
  tap,
  ready,
  post,
}) {
  const link = await page.request.post(`${origin}/api/appointments/${appointmentId}/manage-link?salonSlug=atelier-nail-demo`, {
    headers: {
      origin,
    },
  });
  if (!link.ok()) {
    throw new Error('Secure review fixture link could not be prepared');
  }
  manageUrl = (await link.json()).data.manageUrl;
  if (new URL(manageUrl).origin !== origin) {
    throw new Error('Management link must stay in isolated runtime');
  }
  await tap(page.getByTestId('owner-current-next-appointment').getByRole('button', {
    name: /BIAB Overlay/,
  }));
  await tap(page.getByRole('button', {
    name: /Details.*Show/,
  }));
  await ready(page.getByRole('button', {
    name: 'Mark no-show',
    exact: true,
  }));
  await tap(page.getByRole('button', {
    name: 'Mark no-show',
    exact: true,
  }));
  await tap(page.getByRole('radio', {
    name: /Customer confirmed/,
  }));
  await post(() => tap(page.getByRole('button', {
    name: 'Confirm no-show',
    exact: true,
  })), `/api/appointments/${appointmentId}/cancel`);
  await ready(page.getByText('No-show saved', {
    exact: true,
  }));
}
export default async ({
  page,
  ctx,
  origin,
  tap,
  fill,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Review a no-show record', 'Customers can ask for an incorrect report to be reviewed.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^No-show records/,
    }));
    await ready(page.getByRole('button', {
      name: 'Correct mistaken no-show',
      exact: true,
    }).first());
  });
  await step('Customer opens their link', 'Now showing the customer’s appointment-management view.', async () => {
    await ctx.clearCookies();
    await page.goto(manageUrl, {
      waitUntil: 'domcontentloaded',
    });
    await ready(page.getByRole('button', {
      name: 'Request review of this no-show',
      exact: true,
    }));
  }, 2300);
  await step('Explain what needs review', 'The explanation stays with authorized reviewers.', async () => {
    await tap(page.getByRole('button', {
      name: 'Request review of this no-show',
      exact: true,
    }));
    await page.getByText('This appointment was marked as a no-show.', {
      exact: true,
    }).evaluate(e => e.scrollIntoView({
      block: 'start',
      behavior: 'smooth',
    }));
    await page.waitForTimeout(450);
    await fill(page.getByRole('textbox', {
      name: 'Explain what should be reviewed (10–500 characters)',
    }), 'Please review this record. I believe this report refers to the wrong appointment.');
  });
  await step('Submit the review request', 'The eligible shared contribution is paused during review.', async () => {
    await post(() => tap(page.getByRole('button', {
      name: 'Request review',
      exact: true,
    })), `${new URL(manageUrl).pathname.replace(/^\/en\/[^/]+\/manage\//, '/api/public/appointments/manage/')}/no-show-review`);
    await ready(page.getByText(/^Review requested\. Any eligible shared contribution/));
  }, 2700);
  await step('Owner sees the paused record', 'Earlier deposits and payments need a separate review.', async () => {
    const state = JSON.parse(await readFile('local/video-runtime/owner-state.json', 'utf8'));
    await ctx.addCookies(state.cookies);
    await page.goto(`${origin}/en/admin?salon=atelier-nail-demo`, {
      waitUntil: 'domcontentloaded',
    });
    await ready(page.getByTestId('owner-nav-more'));
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^No-show records/,
    }));
    await ready(page.getByText('Customer review requested · not shared', {
      exact: true,
    }));
  }, 2700);
  evidence.records = await api('/api/admin/network-no-show/records?salonSlug=atelier-nail-demo&page=1');
  const record = evidence.records.items?.find(x => x.appointmentId === appointmentId);
  if (!record || record.reviewState !== 'requested') {
    throw new Error('Review state not recorded');
  }
  evidence.scope = 'Actual secure customer review request for isolated synthetic report, followed by authorized owner suspension view. Management token intentionally omitted. No external shared-network report, payment or refund.';
};

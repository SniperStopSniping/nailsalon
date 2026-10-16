export async function prepare({
  page,
  tap,
  ready,
  post,
}) {
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
  })), '/api/appointments/video-library-confirmed-nonattendance-3/cancel');
  await ready(page.getByText('No-show saved', {
    exact: true,
  }));
}
export default async ({
  page,
  tap,
  fill,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open no-show records', 'Correct mistakes without erasing client history.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^No-show records/,
    }));
    await ready(page.getByRole('button', {
      name: 'Correct mistaken no-show',
      exact: true,
    }));
  });
  await step('Choose the mistaken report', 'Remove only the report that needs correcting.', async () => {
    await tap(page.getByRole('button', {
      name: 'Correct mistaken no-show',
      exact: true,
    }));
    await ready(page.getByLabel('Why was this marked incorrectly?'));
  });
  await step('Explain the correction', 'Keep a clear reason in your salon’s history.', async () => {
    await fill(page.getByLabel('Why was this marked incorrectly?'), 'Recorded against the wrong synthetic appointment.');
  });
  await step('Confirm the correction', 'This visit no longer contributes to shared risk.', async () => {
    evidence.result = await post(() => tap(page.getByRole('button', {
      name: 'Confirm correction',
      exact: true,
    })), '/api/admin/network-no-show/correct', false);
    await ready(page.getByText('Corrected to cancelled', {
      exact: true,
    }).last());
  }, 2300);
  const records = await api('/api/admin/network-no-show/records?salonSlug=atelier-nail-demo&page=1');
  evidence.corrected = records.items?.find(x => x.appointmentId === 'video-library-confirmed-nonattendance-3')?.cancelReason === 'admin_correction';
  if (!evidence.corrected) {
    throw new Error('Correction not persisted');
  }
  evidence.paymentNotice = 'Prior deposits and refunds require an explicit review; no automatic refund is demonstrated.';
};

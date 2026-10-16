/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
import { writeFile } from 'node:fs/promises';

import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { config } from 'dotenv';
import { chromium } from 'playwright';

config({
  path: '.env.development.local',
  quiet: true,
});
if (process.env.NEXT_PUBLIC_APP_URL !== 'http://localhost:3149' || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_')) {
  throw new Error('Isolated runtime required');
}
await clerkSetup({
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
});
const b = await chromium.launch({
  headless: true,
});
const c = await b.newContext({
  storageState: 'local/video-runtime/owner-state.json',
  viewport: {
    width: 390,
    height: 844,
  },
});
const p = await c.newPage();
await setupClerkTestingToken({
  page: p,
});
await p.goto('http://localhost:3149/en/admin?salon=atelier-nail-demo');
await p.getByRole('button', {
  name: 'New Appointment',
  exact: true,
}).waitFor({
  timeout: 60000,
});
const get = async (path) => {
  const r = await p.request.get(`http://localhost:3149${path}`);
  if (!r.ok()) {
    throw new Error(`Read-back refused: ${r.status()}`);
  }
  return r.json();
};
const checkout = await get('/api/appointments/video-library-checkout-emma-1/checkout?salonSlug=atelier-nail-demo');
const data = checkout.data;
const paid = {
  status: data.appointment.status,
  paymentStatus: data.appointment.paymentStatus,
  balanceCents: data.balance.balanceCents,
  payments: data.payments.map(x => ({
    method: x.method,
    amountCents: x.amountCents,
  })),
};
if (paid.status !== 'completed' || paid.balanceCents !== 0 || !paid.payments.some(x => x.method === 'cash' && x.amountCents === 6500)) {
  throw new Error('Expected recorded cash invoice not found');
}
await writeFile('docs/tutorials/verification/checkout-final-check.json', JSON.stringify(paid, null, 2));
const other = await get('/api/admin/clients/video-demo-team-client-maya-singh?salonSlug=atelier-nail-demo-salon');
const risk = other.data.summary?.bookingRisk;
await writeFile('docs/tutorials/verification/correction-cross-salon-check.json', JSON.stringify({
  risk,
  actor: 'Development owner authorized at second synthetic salon',
  checkedAt: new Date().toISOString(),
}, null, 2));
console.log(JSON.stringify({
  checkout: paid,
  risk,
}));
await b.close();

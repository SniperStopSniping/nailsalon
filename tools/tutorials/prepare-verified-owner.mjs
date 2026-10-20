/* eslint-disable no-console -- Progress output for isolated tutorial CLI workflows. */
// Approved synthetic fixture setup only. No verification preparation or SMS send.
import { readFile, writeFile } from 'node:fs/promises';

import { createClerkClient } from '@clerk/backend';
import { config } from 'dotenv';

config({
  path: '.env.development.local',
  quiet: true,
});
if (process.env.NEXT_PUBLIC_APP_URL !== 'http://localhost:3149' || !process.env.CLERK_SECRET_KEY?.startsWith('sk_test_') || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')) {
  throw new Error('Development instance and isolated application required');
}
const id = JSON.parse(await readFile('local/video-runtime/clerk-user.json', 'utf8')).userId;
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});
const user = await clerk.users.getUser(id);
const expected = 'atelier-video-20261014+clerk_test@example.com';
if (!user.emailAddresses.some(x => x.emailAddress === expected)) {
  throw new Error('Only the previously approved synthetic tutorial owner may be prepared');
}
const number = '+15555550199';
const existing = user.phoneNumbers.find(x => x.phoneNumber === number);
if (user.phoneNumbers.some(x => x.phoneNumber !== number)) {
  throw new Error('Existing unrelated test-owner phone preserved; fixture setup stopped');
}
if (existing && (existing.verification?.status !== 'verified' || user.primaryPhoneNumberId !== existing.id)) {
  throw new Error('Existing phone state preserved; use a separately approved fixture');
}
if (!existing) {
  await clerk.phoneNumbers.createPhoneNumber({
    userId: id,
    phoneNumber: number,
    verified: true,
    primary: true,
  });
}
const updated = await clerk.users.getUser(id);
if (!updated.phoneNumbers.some(x => x.id === updated.primaryPhoneNumberId && x.phoneNumber === number && x.verification?.status === 'verified')) {
  throw new Error('Verified test identity not confirmed');
}
await writeFile('docs/tutorials/verification/starter-owner-fixture.json', JSON.stringify({
  developmentInstance: true,
  syntheticOwnerOnly: true,
  primaryEmailVerified: updated.emailAddresses.some(x => x.id === updated.primaryEmailAddressId && x.verification?.status === 'verified'),
  primaryPhoneVerified: true,
  verificationMethod: 'Backend-prepared development fixture. No verification message requested.',
  reference: 'https://clerk.com/docs/reference/backend/phone-numbers/create-phone-number',
}, null, 2));
console.log('Prepared the existing synthetic development owner with a verified reserved phone. No verification message requested.');

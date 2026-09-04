import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { expect, test } from '@playwright/test';

import { runQuickBookJourney } from './quick-book-journey';

test('Clerk setup propagates to the browser worker', async ({ page }, testInfo) => {
  const presence = {
    frontendApiPresent: Boolean(process.env.CLERK_FAPI),
    testingTokenPresent: Boolean(process.env.CLERK_TESTING_TOKEN),
  };

  expect(presence).toEqual({ frontendApiPresent: true, testingTokenPresent: true });

  await setupClerkTestingToken({ page });
  const evidencePath = testInfo.outputPath('clerk-worker-presence.json');
  await writeFile(evidencePath, JSON.stringify(presence));
  await testInfo.attach('clerk-worker-presence', { contentType: 'application/json', path: evidencePath });
});

test('Quick Book owner can verify, save media, finish setup, and return to the same workspace', async ({ page, browser }, testInfo) => {
  test.setTimeout(420_000);

  const result = await runQuickBookJourney({ page, browser }, testInfo, {
    pages: [],
    password: randomUUID().concat('!aA9'),
  });

  expect(result).toMatchObject({ freshBrowserPreview: true, mediaReady: true, publicGuestBookingStart: true, serviceMenuApplied: true });
});

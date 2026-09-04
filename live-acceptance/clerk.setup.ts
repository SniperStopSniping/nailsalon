import { clerkSetup } from '@clerk/testing/playwright';
import { test as setup } from '@playwright/test';

import { assertLocalAcceptanceEnvironment } from './safety';

setup('obtain a Clerk development testing token', async () => {
  assertLocalAcceptanceEnvironment(process.env);
  await clerkSetup();
});

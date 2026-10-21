import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { installFreshOwnerSafeDiagnostics, readFreshOwnerSignUpMetadata } from './fresh-owner-safe-diagnostics';

const candidateRoot = process.env.OWNER_PHASE_CANDIDATE!;
const requireFromCandidate = createRequire(`${candidateRoot}/package.json`);
const { expect, test } = requireFromCandidate('@playwright/test');
const { setupClerkTestingToken } = requireFromCandidate('@clerk/testing/playwright');
const baseURL = process.env.E2E_BASE_URL!;
const frontendApi = 'musical-muskox-47.clerk.accounts.dev';
const expectedSha = 'b81137ef8bdc55e58030abe109d2d468f6c85e54';
const phases = new Map<string, string>();
function markStage(stage: string) {
  phases.set(test.info().project.name, stage);
  // eslint-disable-next-line no-console -- fixed safe reporter protocol.
  console.log(`[owner-journey] stage=${stage}`);
}
function ownerContextOptions() {
  const use = test.info().project.use;
  return { baseURL, ignoreHTTPSErrors: false, viewport: use.viewport, userAgent: use.userAgent, isMobile: use.isMobile, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor, acceptDownloads: false, serviceWorkers: 'block' as const };
}
function requireOwnedAppUrl(value: string) {
  const url = new URL(value, baseURL);
  if (url.origin !== baseURL) {
    throw new Error('Application returned a non-owned URL.');
  }
  return url.href;
}
function isOwnedWizardUrl(value: string) {
  const url = new URL(value);
  return url.origin === baseURL && /^(?:\/en)?\/onboarding\/luster$/u.test(url.pathname);
}

async function installBrowserEgressAllowlist(context: BrowserContext) {
  const blocked = new Map<string, number>();
  // No websocket is required by this fixed-source acceptance run. HMR is
  // intentionally blocked too; no route may connect before this guard.
  await context.routeWebSocket('**/*', (socket) => {
    blocked.set('websocket', (blocked.get('websocket') ?? 0) + 1);
    socket.close({ code: 1008, reason: 'Blocked by test egress policy' });
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const isClerk = url.protocol === 'https:' && !url.port && url.hostname === frontendApi;
    const isFont = url.protocol === 'https:' && !url.port && ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
      && ['GET', 'HEAD'].includes(route.request().method());
    if (url.origin === baseURL || isClerk || isFont) {
      await route.continue();
      return;
    }
    blocked.set('unapproved-destination', (blocked.get('unapproved-destination') ?? 0) + 1);
    await route.abort('blockedbyclient');
  });
  return { report() {
    // eslint-disable-next-line no-console -- fixed safe reporter protocol.
    console.log(`[owner-journey] blocked-egress ${JSON.stringify(Object.fromEntries(blocked))}`);
  } };
}

test.setTimeout(360_000);

test.beforeAll(async () => {
  if (!candidateRoot
    || !isAbsolute(candidateRoot)
    || execFileSync('git', ['-C', candidateRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expectedSha
    || execFileSync('git', ['-C', candidateRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) {
    throw new Error('Fresh-owner journey requires the clean exact b811 candidate.');
  }
  const url = new URL(baseURL);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || !url.port || url.origin !== baseURL) {
    throw new Error('E2E_BASE_URL must be an explicit owned HTTP localhost origin.');
  }
  if (process.env.FRESH_OWNER_RUNTIME_ATTESTED_SHA !== expectedSha) {
    throw new Error('Root runtime source attestation required.');
  }
  if (!process.env.CLERK_SECRET_KEY?.startsWith('sk_test_') || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_test_')
    || !process.env.CLERK_TESTING_TOKEN || process.env.CLERK_FAPI !== frontendApi) {
    throw new Error('Root-bound Development keys, Frontend API and ephemeral testing token required.');
  }
});

async function waitForSignedInClerk(page: Page) {
  await page.waitForFunction(() => {
    const c = (window as unknown as { Clerk?: { loaded?: boolean; user?: { id?: string }; session?: { status?: string } } }).Clerk;
    return c?.loaded === true && Boolean(c.user?.id) && c.session?.status === 'active';
  }, undefined, { timeout: 60_000 });
}
function fixture() {
  const project = test.info().project.name;
  const suffix = project === 'desktop-chromium' ? 'DESKTOP' : 'IPHONE';
  const token = process.env[`FRESH_OWNER_INVITE_TOKEN_${suffix}`];
  const email = process.env[`FRESH_OWNER_INVITED_EMAIL_${suffix}`];
  const runId = process.env.FRESH_OWNER_RUN_TAG;
  if (!token || !/^[\w-]{20,200}$/u.test(token) || !email || !runId
    || !/^[a-z0-9-]{8,30}$/u.test(runId)
    || !new RegExp(`^luster[.]owner[.]${runId}[.](desktop|iphone)\\+clerk_test@example[.]com$`, 'u').test(email)
    || !email.includes(`.${suffix.toLowerCase()}+`)) {
    throw new Error('Distinct root-seeded fresh-owner invite fixture required for each project.');
  }
  const projectTag = `${runId}-${suffix.toLowerCase()}`;
  return { token, email, runId, projectTag, businessName: `RC ${projectTag} Studio`, slug: `rc-${projectTag}`, ownerPhone: suffix === 'DESKTOP' ? '4165550101' : '4165550102' };
}

async function waitForOrganizationCreationOutcome(page: Page) {
  markStage('organization-create-submitted-once');
  try {
    const handle = await page.waitForFunction(() => {
      const visible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
        .some(element => Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length));
      const c = (window as unknown as { Clerk?: { organization?: { id?: string }; session?: { status?: string } } }).Clerk;
      if (c?.organization?.id && c.session?.status === 'active') {
        return 'organization-active';
      }
      // Some stock Clerk forms offer invitations after creation. A visible
      // Skip action is a real next step, not another creation submission.
      const skip = [...document.querySelectorAll<HTMLButtonElement>('button')].some(button =>
        /^(?:Skip this step|Skip for now)$/iu.test(button.textContent?.trim() ?? '')
        && Boolean(button.offsetWidth || button.offsetHeight || button.getClientRects().length));
      if (skip) {
        return 'invitation-step';
      }
      if (visible('[role="alert"], .cl-formFieldErrorText, .cl-alertText')) {
        return 'organization-ui-error';
      }
      return false;
    }, undefined, { timeout: 60_000, polling: 250 });
    const outcome = await handle.jsonValue();
    await handle.dispose();
    if (outcome === 'organization-ui-error') {
      markStage('organization-create-ui-error');
      throw new Error('The actual organization form reported an error after its single creation submission.');
    }
    markStage(outcome === 'invitation-step' ? 'organization-create-invitation-step' : 'organization-create-active');
    return outcome;
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      markStage('organization-create-outcome-timeout');
      throw new Error('No terminal organization/task/session transition appeared within the bounded single-submission wait.');
    }
    throw error;
  }
}

async function hasPendingOrganizationTask(page: Page) {
  return page.evaluate(() => {
    const c = (window as unknown as { Clerk?: { session?: { status?: string; currentTask?: { key?: string } } } }).Clerk;
    return c?.session?.status === 'pending' && c.session.currentTask?.key === 'choose-organization';
  });
}
async function advancedPastCredentialForm(page: Page) {
  if (await hasPendingOrganizationTask(page)) {
    return true;
  }
  return isOwnedWizardUrl(page.url()) && await page.getByRole('heading', { name: 'Set up your salon', exact: true }).isVisible();
}
async function visibleAuthFormSignature(page: Page) {
  const visible: string[] = [];
  for (const name of ['First name', 'Last name', 'Username', 'Email address', 'Password']) {
    if (await page.getByLabel(name, { exact: true }).isVisible().catch(() => false)) {
      visible.push(name);
    }
  }
  if (await page.locator('input[name="code"]').first().isVisible().catch(() => false)) {
    visible.push('verification-code');
  }
  return visible.join('|');
}

async function signUpAndSetup(page: Page, diagnostics: ReturnType<typeof installFreshOwnerSafeDiagnostics>) {
  const data = fixture();
  const password = ['Test-', randomUUID(), '!', 'Aa9'].join('');
  await setupClerkTestingToken({ page });
  markStage('invitation-navigation');
  await page.goto(`${baseURL}/en/join/${encodeURIComponent(data.token)}`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Create your owner account', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);

  const signupResponses: Array<{ signupStatus: string | null; emailVerified: boolean | null; createdSessionPresent: boolean | null }> = [];
  const pending: Promise<void>[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname === frontendApi && /^\/v1\/client\/sign_ups(?:\/[^/]+(?:\/attempt_verification)?)?$/u.test(url.pathname)
      && response.request().method() === 'POST') {
      pending.push(readFreshOwnerSignUpMetadata(response).then((value) => {
        signupResponses.push(value);
        if (value.createdUserId) {
          // eslint-disable-next-line no-console -- bounded cleanup reference.
          console.log(`[fresh-owner-created-artifacts] ${JSON.stringify({ project: test.info().project.name, tag: data.projectTag, userId: value.createdUserId })}`);
        }
      }));
    }
  });
  let verificationSubmitted = false;
  let organizationSubmitted = false;
  const successfullyFilledAuthFields = new Set<string>();
  for (let step = 0; step < 12; step += 1) {
    if (isOwnedWizardUrl(page.url())
      && await page.getByRole('heading', { name: 'Set up your salon', exact: true }).isVisible().catch(() => false)) {
      break;
    }
    markStage('auth-visible-form-controls');
    let pendingOrganizationTask = await hasPendingOrganizationTask(page);
    // A successful fill is never replayed while Clerk replaces the form.
    // Read actual pending-task state before every possible credential fill.
    if (!pendingOrganizationTask) {
      for (const [name, value, stage] of [
        ['First name', 'Validation', 'signup-first-name-field'],
        ['Last name', 'Owner', 'signup-last-name-field'],
        ['Username', `owner${data.runId.replaceAll('-', '')}${test.info().project.name === 'desktop-chromium' ? 'd' : 'i'}`, 'signup-username-field'],
        ['Email address', data.email, 'signup-email-field'],
        ['Password', password, 'signup-password-field'],
      ] as const) {
        if (successfullyFilledAuthFields.has(name)) {
          continue;
        }
        pendingOrganizationTask = await hasPendingOrganizationTask(page);
        if (pendingOrganizationTask) {
          break;
        }
        markStage(stage);
        const field = page.getByLabel(name, { exact: true });
        if (!await field.isVisible().catch(() => false)) {
          continue;
        }
        try {
          await field.fill(value, { timeout: 5_000 });
          successfullyFilledAuthFields.add(name);
        } catch (error) {
        // A detached field is acceptable only when the real task or owned
        // wizard independently proves advancement. Same-form errors fail.
          if (!await advancedPastCredentialForm(page).catch(() => false)) {
            throw error;
          }
          markStage('auth-field-task-advanced');
          break;
        }
      }
    }
    pendingOrganizationTask = await hasPendingOrganizationTask(page);
    if (isOwnedWizardUrl(page.url())
      && await page.getByRole('heading', { name: 'Set up your salon', exact: true }).isVisible().catch(() => false)) {
      break;
    }
    const code = page.locator('input[name="code"]').first();
    const signupCodeVisible = !pendingOrganizationTask && await code.isVisible().catch(() => false);
    if (signupCodeVisible) {
      markStage('signup-email-code-entry');
      await code.fill('424242');
    }
    // Scope generic Name strictly to Clerk's actual pending organization
    // task and its visible task heading; never treat an unrelated Name as org.
    pendingOrganizationTask = await hasPendingOrganizationTask(page);
    const organizationHeadingVisible = await page.getByRole('heading', { name: /(?:set up|setup|create).*organization/iu }).first().isVisible().catch(() => false);
    let organization = page.getByLabel(/^Organization name(?:\s*\*)?$/iu).first();
    if (!await organization.isVisible().catch(() => false)) {
      organization = page.getByLabel(/^Name(?:\s*\*)?$/iu).first();
    }
    const isOrganizationCreation = pendingOrganizationTask && organizationHeadingVisible
      && await organization.isVisible().catch(() => false);
    if (isOrganizationCreation) {
      // No second create request is permitted. The first request gets a
      // bounded terminal-outcome wait below, even while its form stays visible.
      if (organizationSubmitted) {
        await waitForOrganizationCreationOutcome(page);
        continue;
      }
      markStage('organization-task-name-entry');
      await organization.fill(data.businessName);
    }
    const skipInvitations = page.getByRole('button', { name: /^Skip (?:this step|for now)$/i }).first();
    if (organizationSubmitted && await skipInvitations.isVisible().catch(() => false)) {
      await skipInvitations.click();
      await page.waitForTimeout(750);
      continue;
    }
    const terms = page.getByRole('checkbox', { name: /terms|legal/i }).first();
    if (await terms.isVisible().catch(() => false)) {
      await terms.check();
    }
    const action = page.getByRole('button', { name: /^(?:Continue|Create account|Sign up|Verify|Create organization)$/i }).first();
    markStage(isOrganizationCreation ? 'organization-task-action-wait' : 'auth-action-wait');

    await expect(action).toBeVisible({ timeout: 15_000 });
    await expect(action).toBeEnabled({ timeout: 15_000 });

    const submittedAuthSignature = !isOrganizationCreation ? await visibleAuthFormSignature(page) : '';
    const signupVerificationReply = signupCodeVisible
      ? page.waitForResponse(response =>
        new URL(response.url()).hostname === frontendApi && new URL(response.url()).pathname.endsWith('/attempt_verification')
          && response.request().method() === 'POST', { timeout: 30_000 })
      : null;
    void signupVerificationReply?.catch(() => undefined);
    await action.click();
    if (signupVerificationReply) {
      expect((await signupVerificationReply).status()).toBe(200);

      verificationSubmitted = true;
      markStage('signup-email-code-submitted');
    }
    if (isOrganizationCreation) {
      organizationSubmitted = true;
      await waitForOrganizationCreationOutcome(page);
    } else {
      // Never submit Continue again while the same submitted form is settling.
      markStage('auth-transition-wait');

      await expect.poll(async () => {
        if (await advancedPastCredentialForm(page)) {
          return true;
        }
        const next = await visibleAuthFormSignature(page);
        return next !== '' && next !== submittedAuthSignature;
      }, { timeout: 45_000, intervals: [100, 250, 500] }).toBe(true);
    }
  }
  markStage('manual-wizard-arrival-wait');

  await expect(page.getByRole('heading', { name: 'Set up your salon', exact: true })).toBeVisible({ timeout: 60_000 });

  await waitForSignedInClerk(page);
  await Promise.all(pending);

  expect(signupResponses.some(value => value.signupStatus === 'complete')).toBe(true);

  // The current manual wizard deliberately permits verification after the
  // organization handoff. A missing SDK status is never treated as verified.
  const actuallyVerified = await page.evaluate(() => {
    const c = (window as unknown as { Clerk?: { user?: { primaryEmailAddress?: { verification?: { status?: string } } } } }).Clerk;
    return c?.user?.primaryEmailAddress?.verification?.status === 'verified';
  });
  if (!actuallyVerified) {
    markStage('wizard-email-verification-send-wait');
    const sendCode = page.getByRole('button', { name: 'Send verification code', exact: true });

    await expect(sendCode).toBeVisible();
    await expect(sendCode).toBeEnabled();

    await sendCode.click();
    markStage('wizard-email-verification-code-entry');
    const wizardCode = page.getByLabel('Email verification code', { exact: true });

    await expect(wizardCode).toBeVisible();

    await wizardCode.fill('424242');
    const verifyCode = page.getByRole('button', { name: 'Verify code', exact: true });

    await expect(verifyCode).toBeEnabled();

    const verificationReply = page.waitForResponse(response =>
      new URL(response.url()).hostname === frontendApi && new URL(response.url()).pathname.endsWith('/attempt_verification')
        && response.request().method() === 'POST', { timeout: 30_000 });
    void verificationReply.catch(() => undefined);
    markStage('wizard-email-verification-submit');
    await verifyCode.click();

    expect((await verificationReply).status()).toBe(200);

    verificationSubmitted = true;
    markStage('wizard-email-verification-accepted');
  }

  await expect(page.getByText('Owner email verified', { exact: true })).toBeVisible();
  expect(verificationSubmitted).toBe(true);

  await diagnostics.captureClerkState('after-sign-up-response');
  const identity = await page.evaluate(() => {
    const c = (window as unknown as { Clerk?: { user?: { id?: string; primaryEmailAddress?: { emailAddress?: string; verification?: { status?: string } } }; session?: { id?: string; status?: string }; organization?: { id?: string; name?: string } } }).Clerk;
    return { userId: c?.user?.id, sessionId: c?.session?.id, email: c?.user?.primaryEmailAddress?.emailAddress, verified: c?.user?.primaryEmailAddress?.verification?.status === 'verified', organizationId: c?.organization?.id };
  });

  expect(identity.email).toBe(data.email);
  expect(identity.verified).toBe(true);
  expect(identity.userId).toMatch(/^user_[A-Za-z0-9]+$/u);
  expect(identity.sessionId).toMatch(/^sess_[A-Za-z0-9]+$/u);
  expect(identity.organizationId).toMatch(/^org_[A-Za-z0-9]+$/u);

  // IDs are cleanup references, never authentication tokens. Root must verify
  // exact email, creation time, organization name and creator before deletion.
  // eslint-disable-next-line no-console -- bounded cleanup reference.
  console.log(`[fresh-owner-created-artifacts] ${JSON.stringify({ project: test.info().project.name, tag: data.projectTag, userId: identity.userId, organizationId: identity.organizationId })}`);
  markStage('verified-owner-organization-active');

  await expect(page.getByText('Owner email verified', { exact: true })).toBeVisible();

  await page.getByLabel('Salon name', { exact: true }).fill(data.businessName);
  await page.getByLabel('Your name', { exact: true }).fill('Validation Owner');
  await page.getByLabel('Phone', { exact: true }).fill(data.ownerPhone);
  await page.getByLabel('Your permanent Luster link').fill(data.slug);
  await page.getByLabel('Address or service-area note', { exact: true }).fill('100 Test Street');
  await page.getByLabel('City', { exact: true }).fill('Toronto');
  await page.getByLabel('Postal code', { exact: true }).fill('M5V 1A1');
  // Keep one real starter service and set its values through visible controls.
  const offers = page.locator('input[aria-label^="Offer "]');

  expect(await offers.count()).toBeGreaterThan(0);

  for (let index = 0; index < await offers.count(); index += 1) {
    await offers.nth(index).uncheck();
  }
  await page.getByLabel('Offer Luster Manicure', { exact: true }).check();
  await page.getByLabel('Price for Luster Manicure', { exact: true }).fill('55');
  await page.getByLabel('Duration for Luster Manicure', { exact: true }).fill('60');
  const createdPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/onboarding/luster' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create my booking page', exact: true }).click();
  const created = await createdPromise;

  expect(created.status()).toBe(201);

  const result = (await created.json()).data;

  expect(result.slug).toBe(data.slug);
  expect(result.salonId).toMatch(/^[a-f0-9-]{36}$/u);

  requireOwnedAppUrl(result.dashboardUrl);
  requireOwnedAppUrl(result.bookingUrl);
  requireOwnedAppUrl(result.publicUrl);

  await expect(page.getByRole('heading', { name: 'Your salon is set up — ready to publish', exact: true })).toBeVisible();

  markStage('manual-setup-draft-created');
  const publishedPromise = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/salon/publish' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publish my booking page', exact: true }).click();
  const published = await publishedPromise;

  expect(published.status()).toBe(200);

  const publication = (await published.json()).data;

  expect(publication.salonId).toBe(result.salonId);
  expect(publication.publicationStatus).toBe('published');
  expect(publication.publishedAt).toBeTruthy();
  expect(publication.slugLockedAt).toBeTruthy();
  await expect(page.getByRole('heading', { name: 'Your booking page is live', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Open owner dashboard', exact: true }).click();
  await page.waitForURL(url => url.origin === baseURL && /^\/(?:en\/)?admin$/u.test(url.pathname));

  await expect(page.getByTestId('owner-today-workspace')).toBeVisible();

  markStage('manual-owner-dashboard-handoff');
  const me = await page.request.get(`/api/admin/auth/me?salonSlug=${encodeURIComponent(data.slug)}`);

  expect(me.status()).toBe(200);

  const membership = (await me.json()).user;

  expect(membership.isSuperAdmin).toBe(false);
  expect(membership.salons).toEqual([expect.objectContaining({ id: result.salonId, slug: data.slug, role: 'owner', name: data.businessName })]);

  return { ...data, password, identity, claim: { salonId: result.salonId, salonSlug: data.slug } };
}
function localDateAtOffset(offset: number) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Toronto',
    year: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offset, 12));
  return date.toISOString().slice(0, 10);
}

async function findBookableDate(page: Page, salonSlug: string, timeUrl: URL) {
  for (let offset = 2; offset < 14; offset += 1) {
    const date = localDateAtOffset(offset);
    const params = new URLSearchParams({ date, salonSlug });
    const baseServiceId = timeUrl.searchParams.get('baseServiceId');
    const locationId = timeUrl.searchParams.get('locationId');
    const selectedAddOns = timeUrl.searchParams.get('selectedAddOns');
    const technicianId = timeUrl.searchParams.get('techId');
    if (baseServiceId) {
      params.set('baseServiceId', baseServiceId);
    }
    if (locationId) {
      params.set('locationId', locationId);
    }
    if (selectedAddOns) {
      params.set('selectedAddOns', selectedAddOns);
    }
    if (technicianId && technicianId !== 'any') {
      params.set('technicianId', technicianId);
    }
    if (!baseServiceId) {
      const serviceIds = timeUrl.searchParams.get('serviceIds');
      if (serviceIds) {
        params.set('serviceIds', serviceIds);
      }
      const duration = timeUrl.searchParams.get('durationMinutes');
      if (duration) {
        params.set('durationMinutes', duration);
      }
    }
    const response = await page.request.get(`/api/appointments/availability?${params}`);

    expect(response.ok(), `Availability check failed on ${date}.`).toBe(true);

    const body = await response.json();
    const visibleSlots: string[] = body?.visibleSlots ?? [];
    const bookedSlots = new Set<string>(body?.bookedSlots ?? []);
    const slot = visibleSlots.find(value => !bookedSlots.has(value));
    if (slot) {
      return { date, slot };
    }
  }
  throw new Error('No locally bookable appointment slot was returned for the new salon.');
}

test('fresh invited owner registers, publishes, books, completes and resumes after revocation', async ({ browser }: { browser: Browser }) => {
  const ownerAContext = await browser.newContext(ownerContextOptions());
  const ownerAEgress = await installBrowserEgressAllowlist(ownerAContext);
  const ownerAPage = await ownerAContext.newPage();
  ownerAPage.setDefaultTimeout(30_000);
  ownerAPage.setDefaultNavigationTimeout(90_000);
  const diagnostics = installFreshOwnerSafeDiagnostics(ownerAPage, { baseURL, frontendApi, phase: () => phases.get(test.info().project.name) ?? 'journey-start', projectName: test.info().project.name });
  try {
    const ownerA = await signUpAndSetup(ownerAPage, diagnostics);
    const guestContext = await browser.newContext(ownerContextOptions());
    await installBrowserEgressAllowlist(guestContext);
    const guestPage = await guestContext.newPage();
    guestPage.setDefaultTimeout(30_000);
    guestPage.setDefaultNavigationTimeout(90_000);
    let completion: { appointment?: { id?: string; status?: string } } | undefined;
    let appointmentId: string | undefined;
    let serviceId: string | undefined;
    const guestName = `RC Guest ${ownerA.projectTag}`;
    const guestPhoneSuffix = test.info().project.name === 'desktop-chromium' ? '0103' : '0104';
    const guestPhone = `416555${guestPhoneSuffix}`;
    const guestEmail = `guest.${ownerA.projectTag}@example.com`;
    const bookingURL = `/en/${ownerA.claim.salonSlug}/book/service`;
    try {
      await guestPage.goto(bookingURL, { waitUntil: 'domcontentloaded' });

      await expect(guestPage.getByRole('heading', { name: ownerA.businessName, exact: true })).toBeVisible({ timeout: 30_000 });

      const publicRoute = new URL(guestPage.url());

      expect(publicRoute.pathname).toMatch(new RegExp(`(?:/en)?/${ownerA.claim.salonSlug}/book/service$`));

      markStage('public-customer-route-opened');
      const serviceCard = guestPage.locator('button[data-testid^="service-card-"]').first();

      await expect(serviceCard).toBeVisible({ timeout: 30_000 });

      serviceId = (await serviceCard.getAttribute('data-testid'))?.replace(/^service-card-/u, '');

      expect(serviceId).toBeTruthy();

      markStage('published-service-catalog-visible');
      await serviceCard.click();
      await guestPage.getByTestId('service-continue-button').click();

      await expect(guestPage).toHaveURL(/\/book\/(?:tech|time)(?:\?|$)/u);

      if (new URL(guestPage.url()).pathname.endsWith('/book/tech')) {
        const techOption = guestPage.locator('button').filter({ hasText: /any.*team|any technician|validation owner/i }).first();

        await expect(techOption).toBeVisible();

        await techOption.click();

        await expect(guestPage).toHaveURL(/\/book\/time(?:\?|$)/u);
      }
      const timeURL = new URL(guestPage.url());
      const { date, slot } = await findBookableDate(guestPage, ownerA.claim.salonSlug, timeURL);
      const dayButton = guestPage.getByTestId(`calendar-day-${date}`);
      for (let month = 0; month < 3 && !await dayButton.isVisible(); month += 1) {
        await guestPage.getByRole('button', { name: /next (?:week|month)/i }).click();
      }

      await expect(dayButton).toBeVisible();

      await dayButton.click();
      const slotButton = guestPage.getByTestId(`time-slot-${slot}`);

      await expect(slotButton).toBeVisible();
      await expect(slotButton).toBeEnabled();

      await Promise.all([
        guestPage.waitForURL(/\/book\/confirm(?:\?|$)/u),
        slotButton.click(),
      ]);

      await expect(guestPage.getByRole('heading', { name: 'Review & confirm', exact: true })).toBeVisible();

      await guestPage.getByLabel('Customer name').fill(guestName);
      await guestPage.getByLabel('Customer email').fill(guestEmail);
      await guestPage.getByLabel('Customer phone').fill(guestPhone);
      const acknowledgment = guestPage.getByTestId('booking-policy-acknowledgment');
      if (await acknowledgment.count()) {
        await acknowledgment.getByRole('checkbox').check();
      }
      const bookingResponsePromise = guestPage.waitForResponse(response => (
        new URL(response.url()).pathname === '/api/appointments'
          && response.request().method() === 'POST'
      ), { timeout: 60_000 });
      await guestPage.getByRole('button', { name: /confirm appointment/i }).click();
      const bookingResponse = await bookingResponsePromise;
      const bookingEnvelope = await bookingResponse.json();
      const code = bookingEnvelope?.error?.code;
      // eslint-disable-next-line no-console -- fixed safe booking-outcome marker.
      console.log(`[owner-booking-outcome] ${JSON.stringify({ status: bookingResponse.status(), code: typeof code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(code) ? code : null, appointmentPresent: Boolean(bookingEnvelope?.data?.appointmentId) })}`);

      expect(bookingResponse.status()).toBe(201);

      const bookingData = bookingEnvelope.data;
      appointmentId = bookingData?.appointmentId;

      expect(appointmentId).toBeTruthy();
      expect(bookingData?.manageUrl).toBeTruthy();

      markStage('guest-booking-created');

      await expect(guestPage.getByRole('heading', { name: /appointment confirmed/i })).toBeVisible();

      await ownerAPage.goto(`${baseURL}/en/admin?salon=${encodeURIComponent(ownerA.claim.salonSlug)}`, { waitUntil: 'domcontentloaded' });

      await expect(ownerAPage.getByTestId('owner-today-workspace')).toBeVisible();

      await ownerAPage.getByTestId('owner-nav-calendar').click();
      const calendar = ownerAPage.getByRole('dialog', { name: 'Calendar' });

      await expect(calendar).toBeVisible();

      const bookedDay = calendar.locator(`[data-testid="calendar-day-${date}"]`);
      for (let period = 0; period < 3 && !await bookedDay.isVisible(); period += 1) {
        await calendar.getByRole('button', { name: /next (?:week|month)/i }).click();
      }

      await expect(bookedDay).toBeVisible();

      await bookedDay.click();
      const appointmentCard = ownerAPage.getByTestId(`day-detail-appointment-${appointmentId}`);

      await expect(appointmentCard).toBeVisible();

      await appointmentCard.click();

      await expect(ownerAPage.getByTestId('appointment-quick-edit-sheet')).toBeVisible();

      const completeButton = ownerAPage.getByTestId('appointment-sheet-mark-completed');

      await expect(completeButton).toBeVisible();

      await completeButton.click();

      await expect(ownerAPage.getByTestId('checkout-sheet')).toBeVisible();

      await ownerAPage.getByTestId('checkout-comp').check();
      const reviewCheckout = ownerAPage.getByTestId('checkout-review-button');

      await expect(reviewCheckout).toBeVisible();

      await reviewCheckout.click();

      await expect(ownerAPage.getByTestId('checkout-complete-button')).toBeVisible();

      const completionResponsePromise = ownerAPage.waitForResponse(response => (
        new URL(response.url()).pathname.endsWith(`/api/appointments/${appointmentId}/complete`)
          && response.request().method() === 'PATCH'
      ), { timeout: 60_000 });
      await ownerAPage.getByTestId('checkout-complete-button').click();
      const photoDecision = ownerAPage.getByRole('button', { name: 'Complete without photo', exact: true });
      await Promise.race([photoDecision.waitFor({ state: 'visible', timeout: 15_000 }).then(() => photoDecision.click()), completionResponsePromise]);
      const completionResponse = await completionResponsePromise;

      expect(completionResponse.status()).toBe(200);

      completion = (await completionResponse.json()).data;

      expect(completion?.appointment?.id).toBe(appointmentId);
      expect(completion?.appointment?.status).toBe('completed');
      await expect(ownerAPage.getByTestId('checkout-success')).toBeVisible();

      markStage('owner-a-appointment-completed');
    } catch (error) {
      markStage('guest-booking-failed');
      throw error;
    } finally {
      await guestContext.close();
    }

    const { createClerkClient } = requireFromCandidate('@clerk/backend');
    const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const identity = ownerA.identity;
    const session = await backend.sessions.getSession(identity.sessionId);
    const user = await backend.users.getUser(identity.userId);

    expect(session.userId).toBe(identity.userId);
    expect(user.emailAddresses.some((e: { emailAddress: string }) => e.emailAddress === ownerA.email)).toBe(true);

    const memberships = await backend.users.getOrganizationMembershipList({ userId: identity.userId, limit: 10 });

    expect(memberships.data).toHaveLength(1);
    expect(memberships.data[0].organization.id).toBe(identity.organizationId);

    const organization = await backend.organizations.getOrganization({ organizationId: identity.organizationId });

    expect(organization.createdBy).toBe(identity.userId);
    expect(organization.name).toBe(ownerA.businessName);

    markStage('owned-session-revocation-start');
    await backend.sessions.revokeSession(identity.sessionId);
    await ownerAPage.reload({ waitUntil: 'domcontentloaded' });
    await ownerAPage.waitForFunction(() => {
      const c = (window as unknown as { Clerk?: { loaded?: boolean; session?: { status?: string } | null } }).Clerk;
      return c?.loaded === true && (!c.session || c.session.status === 'ended');
    }, undefined, { timeout: 45_000 });
    const revokedStatus = await ownerAPage.request.get(`/api/admin/auth/me?salonSlug=${encodeURIComponent(ownerA.slug)}`);

    expect(revokedStatus.status()).toBe(401);

    markStage('revoked-session-admin401');
    // Observe the application's own transition through admin-login. Never use a
    // test navigation or auth helper to force sign-in or the resumed dashboard.
    await ownerAPage.waitForURL(url => url.origin === baseURL && /^\/(?:en\/)?owner-sign-in$/u.test(url.pathname), { timeout: 45_000 });

    await expect(ownerAPage.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();

    await ownerAPage.getByLabel('Email address', { exact: true }).fill(ownerA.email);
    await ownerAPage.getByRole('button', { name: 'Continue', exact: true }).click();
    await ownerAPage.getByLabel('Password', { exact: true }).fill(ownerA.password);
    await ownerAPage.getByRole('button', { name: /^(?:Continue|Sign in)$/i }).click();
    await waitForSignedInClerk(ownerAPage);
    await ownerAPage.waitForURL(url => url.origin === baseURL && /^\/(?:en\/)?admin$/u.test(url.pathname), { timeout: 45_000 });

    await expect(ownerAPage.getByTestId('owner-today-workspace')).toBeVisible();

    const restored = await ownerAPage.request.get(`/api/admin/auth/me?salonSlug=${encodeURIComponent(ownerA.slug)}`);

    expect(restored.status()).toBe(200);

    const restoredUser = (await restored.json()).user;

    expect(restoredUser.salons).toEqual([expect.objectContaining({ id: ownerA.claim.salonId, slug: ownerA.slug, role: 'owner' })]);

    const appointment = await ownerAPage.request.get(`/api/appointments/${appointmentId}`);

    expect(appointment.status()).toBe(200);
    expect((await appointment.json()).data.appointment).toMatchObject({ id: appointmentId, salonId: ownerA.claim.salonId, status: 'completed' });

    markStage('product-sign-in-owner-work-resumed');
    // eslint-disable-next-line no-console -- fixed safe reporter result protocol.
    console.log(`[fresh-owner-result] ${JSON.stringify({ registrationCompleted: true, organizationCreated: true, emailVerified: true, invitationSetupCompleted: true, publishCompleted: true, customerBookingCreated: true, appointmentCompleted: true, ownSessionRevoked: true, unauthenticatedStatus: 401, productSignInRestored: true, persistedOwnerWorkResumed: true })}`);
  } catch (error) {
    await diagnostics.captureClerkState('post-sign-up-failure');
    await diagnostics.captureFailureCheckpoint();
    throw error;
  } finally {
    await diagnostics.flush();
    ownerAEgress.report();
    await ownerAContext.close();
  }
});

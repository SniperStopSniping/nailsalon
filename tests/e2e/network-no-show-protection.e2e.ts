import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { appPath, authStatePaths, e2eConfig } from './support/config';

const CLIENT_ID = 'network-risk-client';

test.use({
  storageState: authStatePaths.superAdmin,
  viewport: { width: 390, height: 844 },
});

type NetworkRisk =
  | {
    state: 'available';
    activeNoShowCount: number;
    windowMonths: 12;
    protection: 'warn_only' | 'deposit_1' | 'deposit_2';
  }
  | { state: 'unavailable' };

const directoryClient = {
  id: CLIENT_ID,
  phone: '4165550199',
  fullName: 'Network Risk Fixture',
  email: 'network-risk@example.test',
  preferredTechnician: null,
  lastVisitAt: null,
  totalVisits: 0,
  totalSpent: 0,
  spendCurrency: 'CAD',
  spendState: 'canonical_settled',
  noShowCount: 0,
  loyaltyPoints: 0,
  createdAt: '2026-09-01T12:00:00.000Z',
};

function detailPayload(bookingRisk: NetworkRisk) {
  return {
    data: {
      client: {
        ...directoryClient,
        notes: '',
        sensitivities: '',
        nailPreferences: {},
        tags: [],
        rebookIntervalDays: null,
        nextRebookDueAt: null,
        lastContactAt: null,
        updatedAt: '2026-09-01T12:00:00.000Z',
      },
      summary: {
        currency: 'CAD',
        timeZone: 'America/Toronto',
        lifetimeSpendCents: 0,
        spendThisMonthCents: 0,
        completedOutstandingCents: 0,
        financialState: 'resolved',
        completedVisits: 0,
        mostBookedService: null,
        rebooking: { status: 'new_client', dueAt: null },
        provenance: {
          lifetimeSpend: { mode: 'empty', unresolvedAppointmentCount: 0, isEstimated: false },
          spendThisMonth: { mode: 'empty', unresolvedAppointmentCount: 0, isEstimated: false },
          completedOutstanding: { mode: 'empty', unresolvedAppointmentCount: 0, isEstimated: false },
        },
        bookingRisk,
      },
      submittedPreferences: null,
      upcomingAppointments: [],
      pastAppointments: [],
      recentIssues: [],
      photos: [],
    },
  };
}

function settingsPayload(protection: 'warn_only' | 'deposit_1' | 'deposit_2') {
  return {
    reviewsEnabled: true,
    rewardsEnabled: true,
    billingMode: 'NONE',
    subscriptionStatus: null,
    bookingConfig: {
      bufferMinutes: 10,
      slotIntervalMinutes: 15,
      currency: 'CAD',
      timezone: 'America/Toronto',
      introPriceDefaultLabel: '',
      firstVisitDiscountEnabled: false,
      clientChangeCutoffHours: 24,
    },
    merchandising: { featureLusterManicure: true },
    bookingNotifications: {},
    payments: { deposit: { enabled: false, amountCents: 2500 } },
    networkNoShow: { active: true, protection, canRequireDeposit: true },
    depositPolicy: {
      collectionLive: true,
      entitled: true,
      active: false,
      reason: 'disabled',
      readinessStale: false,
      readinessAgeMs: null,
    },
    ownerPhonePresent: true,
    ownerEmailPresent: true,
    smsChannelAvailable: true,
    emailChannelAvailable: true,
  };
}

async function impersonateConfiguredSalon(page: Page) {
  const organizationsResponse = await page.request.get(
    `/api/super-admin/organizations?page=1&pageSize=20&q=${encodeURIComponent(e2eConfig.salonSlug)}`,
  );
  const organizations = await organizationsResponse.json();
  const salon = organizations.items?.find(
    (item: { slug?: string }) => item.slug === e2eConfig.salonSlug,
  );

  expect(salon?.id, 'The configured E2E salon must exist.').toBeTruthy();

  const impersonation = await page.request.post('/api/super-admin/impersonate', {
    data: { salonId: salon.id },
  });

  expect(impersonation.ok(), await impersonation.text()).toBe(true);
}

async function mockClientProfile(page: Page, bookingRisk: NetworkRisk) {
  await page.route('**/api/admin/clients?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        clients: [directoryClient],
        pagination: { page: 1, limit: 30, total: 1, totalPages: 1 },
        filter: { segment: null, rulesVersion: null, generatedAt: null },
      },
    }),
  }));

  await page.route(`**/api/admin/clients/${CLIENT_ID}?*`, route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(detailPayload(bookingRisk)),
  }));

  await page.route('**/api/admin/settings/modules?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        moduleReasons: {
          clientFlags: 'MODULE_DISABLED',
          clientBlocking: 'MODULE_DISABLED',
        },
      },
    }),
  }));

  await page.route('**/api/admin/technicians?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ data: { technicians: [] } }),
  }));
}

async function openProfile(page: Page, bookingRisk: NetworkRisk) {
  await mockClientProfile(page, bookingRisk);
  await page.goto(
    `${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`,
    { waitUntil: 'domcontentloaded' },
  );

  await expect(page.getByTestId('owner-nav-clients')).toBeVisible();

  await page.getByTestId('owner-nav-clients').click();
  const client = page.getByTestId('clients-directory-scroll').locator('button').first();

  await expect(client).toBeVisible();

  await client.click();
}

test.describe('network no-show protection owner mobile @network-no-show-protection', () => {
  test('shows the automatic warning for one active no-show in the Warn only policy', async ({ page }) => {
    await impersonateConfiguredSalon(page);
    try {
      await openProfile(page, {
        state: 'available',
        activeNoShowCount: 1,
        windowMonths: 12,
        protection: 'warn_only',
      });

      const warning = page.getByTestId('booking-risk-warning');

      await expect(warning).toContainText('Higher no-show risk');
      await expect(warning).toContainText('1 recorded no-show on Luster in the last 12 months.');
      await expect(warning).toContainText('No-show protection: Warning only');
    } finally {
      await page.request.delete('/api/super-admin/impersonate');
    }
  });

  test('shows the automatic warning before the deposit-at-two threshold is met', async ({ page }) => {
    await impersonateConfiguredSalon(page);
    try {
      await openProfile(page, {
        state: 'available',
        activeNoShowCount: 1,
        windowMonths: 12,
        protection: 'deposit_2',
      });

      await expect(page.getByTestId('booking-risk-warning')).toContainText(
        'No-show protection: Deposit required at 2 recorded no-shows',
      );
    } finally {
      await page.request.delete('/api/super-admin/impersonate');
    }
  });

  test('keeps unavailable network history distinct from a clear no-show result', async ({ page }) => {
    await impersonateConfiguredSalon(page);
    try {
      await openProfile(page, { state: 'unavailable' });

      await expect(page.getByTestId('booking-risk-unavailable')).toContainText(
        'Network no-show history unavailable.',
      );

      await expect(page.getByTestId('booking-risk-clear')).toHaveCount(0);
      await expect(page.getByTestId('booking-risk-warning')).toHaveCount(0);
    } finally {
      await page.request.delete('/api/super-admin/impersonate');
    }
  });

  test('offers only the three no-show deposit consequences when the platform feature is active', async ({ page }) => {
    await impersonateConfiguredSalon(page);
    await page.route('**/api/admin/salon/settings?*', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(settingsPayload('warn_only')),
    }));

    try {
      await page.goto(
        `${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}&app=settings&view=payments`,
        { waitUntil: 'domcontentloaded' },
      );

      const protection = page.getByTestId('no-show-protection');

      await page.getByRole('button', { name: /^Deposits / }).click();

      await expect(protection).toBeVisible();
      await expect(protection.getByRole('radio')).toHaveCount(3);
      await expect(protection.getByTestId('no-show-protection-warn_only')).toBeChecked();
      await expect(protection).toContainText('Warn only');
      await expect(protection).not.toContainText('Warn me only');
      await expect(protection).not.toContainText(/^Off$/);
    } finally {
      await page.request.delete('/api/super-admin/impersonate');
    }
  });
});

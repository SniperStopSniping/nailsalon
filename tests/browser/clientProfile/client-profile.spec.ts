import { expect, test } from '@playwright/test';

type Scenario = 'default' | 'empty' | 'empty-profile' | 'no-offer';

const longName = 'Alexandria Maximiliana Longcontactname With A Very Deliberately Long Address';

function clientList(scenario: Scenario) {
  if (scenario === 'empty') {
    return { data: { clients: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } } };
  }
  return {
    data: {
      clients: [{
        id: 'client_browser',
        fullName: longName,
        phone: '4165550101',
        email: 'alexandria.fixture@example.com',
        preferredTechnician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        lastVisitAt: '2026-09-01T14:00:00.000Z',
        totalVisits: 6,
        totalSpent: 45500,
        spendCurrency: 'CAD',
        spendState: 'canonical_settled',
        noShowCount: 0,
        loyaltyPoints: 820,
        notes: 'Prefers quiet appointments and short almond nails.',
        createdAt: '2025-01-01T00:00:00.000Z',
      }],
      pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
    },
  };
}

function clientDetail(noUpcoming = false) {
  return {
    data: {
      client: {
        id: 'client_browser',
        fullName: longName,
        phone: '4165550101',
        email: 'alexandria.fixture@example.com',
        birthday: null,
        preferredTechnician: { id: 'tech_1', name: 'Daniela', avatarUrl: null },
        notes: 'Prefers quiet appointments and short almond nails.',
        sensitivities: 'HEMA sensitivity',
        nailPreferences: { shape: 'Almond', length: 'Short', favoriteColors: 'Neutral pink', productsUsed: 'Builder gel' },
        tags: ['VIP'],
        rebookIntervalDays: 21,
        nextRebookDueAt: '2026-09-22T14:00:00.000Z',
        lastVisitAt: '2026-09-01T14:00:00.000Z',
        totalVisits: 6,
        totalSpent: 45500,
        averageSpend: 7583,
        noShowCount: 0,
        loyaltyPoints: 820,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2026-09-20T00:00:00.000Z',
      },
      upcomingAppointments: noUpcoming ? [] : [{ id: 'appt_upcoming', startTime: '2026-09-24T15:00:00.000Z', endTime: '2026-09-24T16:00:00.000Z', status: 'confirmed', totalPrice: 9500, currency: 'CAD', technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null }, services: [{ id: 'svc_1', name: 'Structured Builder Gel', price: 9500 }], notes: null }],
      pastAppointments: [{ id: 'appt_completed', startTime: '2026-09-01T15:00:00.000Z', endTime: '2026-09-01T16:00:00.000Z', status: 'completed', totalPrice: 8200, currency: 'CAD', technician: { id: 'tech_1', name: 'Daniela', avatarUrl: null }, services: [{ id: 'svc_1', name: 'Structured Builder Gel', price: 8200 }], addOns: [], financial: { completedValueCents: 8200, paymentsReceivedCents: 8200, balanceCents: 0, financialState: 'resolved' }, notes: null }],
      recentIssues: [],
      photos: [],
      summary: { currency: 'CAD', timeZone: 'America/Toronto', lifetimeSpendCents: 45500, spendThisMonthCents: 8200, completedOutstandingCents: 0, financialState: 'resolved', completedVisits: 6, mostBookedService: { id: 'svc_1', name: 'Structured Builder Gel', count: 3 }, rebooking: { status: 'due_soon', dueAt: '2026-09-22T14:00:00.000Z' }, provenance: { lifetimeSpend: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false }, spendThisMonth: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false }, completedOutstanding: { mode: 'finalized', unresolvedAppointmentCount: 0, isEstimated: false } } },
      submittedPreferences: { favoriteTechnician: { id: 'tech_1', name: 'Daniela', avatarUrl: null }, favoriteServices: ['svc_1'], nailShape: 'almond', nailLength: 'short', finishes: ['glossy'], colorFamilies: ['nude'], preferredBrands: ['Luster Gel'], sensitivities: ['HEMA-free'], musicPreference: 'quiet', conversationLevel: 'quiet', beveragePreference: ['tea'], techNotes: null, appointmentNotes: null, updatedAt: '2026-09-01T00:00:00.000Z' },
    },
  };
}

function emptyClientDetail() {
  const detail = structuredClone(clientDetail(true)) as {
    data: {
      client: Record<string, unknown>;
      upcomingAppointments: unknown[];
      pastAppointments: unknown[];
      photos: unknown[];
      submittedPreferences: unknown;
      summary: Record<string, unknown>;
    };
  };
  detail.data.client = {
    ...detail.data.client,
    notes: '',
    sensitivities: '',
    nailPreferences: null,
    tags: [],
    preferredTechnician: null,
    rebookIntervalDays: null,
    nextRebookDueAt: null,
    lastVisitAt: null,
    totalVisits: 0,
    totalSpent: 0,
    averageSpend: 0,
    loyaltyPoints: 0,
  };
  detail.data.pastAppointments = [];
  detail.data.photos = [];
  detail.data.submittedPreferences = null;
  detail.data.summary = {
    ...detail.data.summary,
    completedVisits: 0,
    lifetimeSpendCents: 0,
    spendThisMonthCents: 0,
    mostBookedService: null,
    rebooking: { status: 'not_due', dueAt: null },
  };
  return detail;
}

function managedAppointment() {
  return { data: { appointment: { id: 'appt_upcoming', salonId: 'salon_browser_fixture', salonSlug: 'isla-browser', clientName: longName, clientPhone: '4165550101', clientEmail: 'alexandria.fixture@example.com', technicianId: 'tech_1', locationId: null, locationName: null, status: 'confirmed', startTime: '2026-09-24T15:00:00.000Z', endTime: '2026-09-24T16:00:00.000Z', totalPrice: 9500, totalDurationMinutes: 60, bufferMinutes: 0, slotIntervalMinutes: 15, isLocked: false, lockedAt: null, paymentStatus: 'pending', baseServiceId: 'svc_1', baseServiceName: 'Structured Builder Gel', discountType: null, discountAmountCents: 0, notes: null, techNotes: null }, services: [], addOns: [], serviceOptions: [{ id: 'svc_1', name: 'Structured Builder Gel', category: 'manicure', priceCents: 9500, durationMinutes: 60 }], technicianOptions: [{ id: 'tech_1', name: 'Daniela' }], permissions: { canMove: true, canChangeService: true, canCancel: true, canMarkCompleted: true, canStart: true, canConfirm: false, canMarkNoShow: true, canReassignTechnician: true }, warnings: [], communications: [] } };
}

async function mockClientProfileApi(page: import('@playwright/test').Page) {
  const writes: string[] = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3148') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    const scenario = (new URL(page.url()).searchParams.get('scenario') ?? 'default') as Scenario;
    const method = request.method();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      writes.push(`${method} ${url.pathname}`);
    }
    const json = (data: unknown) => route.fulfill({ json: data });
    if (url.pathname === '/api/admin/settings/modules') {
      return json({ data: { moduleReasons: { clientFlags: 'MODULE_DISABLED', clientBlocking: 'MODULE_DISABLED' } } });
    }
    if (url.pathname === '/api/admin/technicians') {
      return json({ data: { technicians: [{ id: 'tech_1', name: 'Daniela', avatarUrl: null, isActive: true }] } });
    }
    if (url.pathname === '/api/salon/services') {
      return json({ data: { services: [{ id: 'svc_1', name: 'Structured Builder Gel', price: 9500, duration: 60, isActive: true }] } });
    }
    if (url.pathname === '/api/admin/client-insights') {
      return json({ data: { generatedAt: '2026-09-20T00:00:00.000Z', timeZone: 'America/Toronto', rulesVersion: 'fixture', kpis: { active: 1, new_this_month: 0, due_to_return: 1, overdue: 0 }, segments: [], attention: { total: 0, items: [] } } });
    }
    if (url.pathname === '/api/admin/clients') {
      return json(clientList(scenario));
    }
    if (url.pathname === '/api/admin/clients/client_browser') {
      return json(scenario === 'empty-profile'
        ? emptyClientDetail()
        : clientDetail(scenario === 'no-offer'));
    }
    if (url.pathname === '/api/admin/clients/client_browser/flags') {
      return json({ data: { client: { id: 'client_browser', phone: '4165550101', fullName: longName, adminFlags: { isProblemClient: false, flagReason: '' }, isBlocked: false, blockedReason: '', noShowCount: 0, lateCancelCount: 0 } } });
    }
    if (url.pathname === '/api/admin/retention/settings') {
      return json({ data: { settings: { defaultRebookDays: 21, reminderLeadHours: 24, googleReviewUrl: null, parkingInstructions: null } } });
    }
    if (url.pathname === '/api/admin/review-requests/settings') {
      return json({ data: { googleReviewUrl: null, messageTemplate: '', businessName: null } });
    }
    if (url.pathname === '/api/admin/location') {
      return json({ data: { location: null } });
    }
    if (url.pathname === '/api/admin/today') {
      return json({ data: { timeZone: 'America/Toronto', links: { bookingUrl: 'http://127.0.0.1:3148/book' } } });
    }
    if (url.pathname === '/api/admin/retention') {
      return json({ data: { retention: [], appointmentReminders: [], history: [] } });
    }
    if (url.pathname === '/api/admin/clients/client_browser/messages') {
      return json({ data: { sms: { manualAvailable: false, senderLabel: 'Synthetic fixture', senderMode: 'shared_luster', detail: 'Disabled in fixture' }, history: [] } });
    }
    if (url.pathname === '/api/admin/clients/client_browser/review-requests') {
      return json({ data: { timeZone: 'America/Toronto', reviewRequestsSuppressed: false, history: [], hasMore: false } });
    }
    if (url.pathname === '/api/appointments/appt_upcoming/manage') {
      return json(managedAppointment());
    }
    if (url.pathname === '/api/appointments/appt_upcoming/communication') {
      return json({ data: { history: [] } });
    }
    if (url.pathname === '/api/appointments/appt_upcoming/review-request') {
      return json({ data: { status: 'disabled', reason: null, canSendManually: false, automationMode: 'manual' } });
    }
    if (url.pathname === '/api/admin/next-visit-offer/link' && method === 'POST') {
      return json(scenario === 'no-offer' ? { data: { offer: null } } : { data: { offer: { bookingUrl: 'http://127.0.0.1:3148/book?campaign=fixture-token', deadlineDate: '2026-10-01', settings: { discountType: 'percent', value: 10 } } } });
    }
    unexpected.push(`${method} ${url.pathname}`);
    return route.fulfill({ status: 404, json: { error: 'unexpected synthetic fixture API' } });
  });
  return { writes, unexpected };
}

test('client profile preserves navigation and canonical appointment handoff without writes', async ({ page }, testInfo) => {
  const { writes, unexpected } = await mockClientProfileApi(page);
  await page.goto('/?scenario=default');

  await page.getByPlaceholder('Search clients').fill('Alexandria');

  await page.getByRole('button', { name: new RegExp(longName, 'i') }).click();

  await expect(page.getByTestId('client-detail-scroll')).toBeVisible();

  await expect.poll(async () => {
    const box = await page.getByTestId('client-detail-scroll').boundingBox();
    return Math.abs(box?.x ?? Number.POSITIVE_INFINITY);
  }).toBeLessThanOrEqual(1);

  const currentNext = page.getByTestId('client-current-next-summary');

  await expect(currentNext).toContainText('Structured Builder Gel');
  await expect(currentNext).toContainText('Daniela');
  await expect(page.getByText('SMS history', { exact: true })).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath(`profile-overview-${testInfo.project.name}-320.png`) });

  await expect(page.getByRole('button', { name: /view next appointment/i })).toBeVisible();

  await page.getByRole('button', { name: /view next appointment/i }).click();

  await expect(page.getByTestId('appointment-quick-edit-sheet')).toBeVisible();

  await page.getByRole('button', { name: /close/i }).first().click();
  const sectionSelect = page.getByLabel('Client profile section', { exact: true });
  await sectionSelect.selectOption('activity');

  await expect(page.getByText('SMS history', { exact: true }).locator('..')).not.toHaveAttribute('open');

  await sectionSelect.selectOption('preferences');

  await expect(page.getByLabel('Sensitivities and allergies')).toBeVisible();

  await sectionSelect.selectOption('notes');

  await expect(page.getByLabel('Private notes')).toBeVisible();

  await page.getByRole('button', { name: 'Client controls' }).click();

  await expect(page.getByRole('checkbox', { name: 'Do not send review requests' })).toBeVisible();

  await page.keyboard.press('Escape');
  await sectionSelect.selectOption('overview');
  await page.evaluate(() => {
    const profile = document.querySelector<HTMLElement>('[data-testid="client-detail-scroll"]');
    if (!profile) {
      throw new Error('Client profile did not render.');
    }
    const snapshots = Array.from(profile.querySelectorAll<HTMLElement>('*')).map((element) => {
      const styles = window.getComputedStyle(element);
      return {
        element,
        fontSize: Number.parseFloat(styles.fontSize),
        lineHeight: Number.parseFloat(styles.lineHeight),
      };
    });
    snapshots.forEach(({ element, fontSize, lineHeight }) => {
      if (Number.isFinite(fontSize) && fontSize > 0) {
        element.style.fontSize = `${fontSize * 2}px`;
      }
      if (Number.isFinite(lineHeight) && lineHeight > 0) {
        element.style.lineHeight = `${lineHeight * 2}px`;
      }
    });
  });
  await currentNext.scrollIntoViewIfNeeded();

  await page.screenshot({ path: testInfo.outputPath(`profile-overview-${testInfo.project.name}-200.png`) });

  await expect(currentNext).toBeInViewport();

  await page.getByRole('button', { name: 'Clients' }).focus();

  await expect(page.getByRole('button', { name: 'Clients' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await currentNext.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.getByRole('button', { name: 'Clients' }).click();

  await expect(page.getByPlaceholder('Search clients')).toHaveValue('Alexandria');

  expect(writes).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('rebooking uses only the synthetic existing-offer lookup, including no-offer', async ({ page }) => {
  const { writes, unexpected } = await mockClientProfileApi(page);
  await page.goto('/?scenario=no-offer');
  await page.getByRole('button', { name: new RegExp(longName, 'i') }).click();
  await page.getByTestId('client-profile-rebook').click();

  await expect(page.getByRole('dialog', { name: 'New Appointment' })).toBeVisible();
  expect(writes).toEqual(['POST /api/admin/next-visit-offer/link']);
  expect(unexpected).toEqual([]);
});

test('empty synthetic scenario offers an honest zero state', async ({ page }) => {
  const { writes, unexpected } = await mockClientProfileApi(page);
  await page.goto('/?scenario=empty');

  await expect(page.getByTestId('clients-empty-add')).toBeVisible();
  expect(writes).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('brand-new client profile does not invent visits, preferences, notes, photos, or rebook discounts', async ({ page }) => {
  const { writes, unexpected } = await mockClientProfileApi(page);
  await page.goto('/?scenario=empty-profile');

  await page.getByRole('button', { name: new RegExp(longName, 'i') }).click();

  await expect(page.getByTestId('client-book-appointment')).toHaveText(/book/i);
  await expect(page.getByText('No current or upcoming appointment.')).toBeVisible();
  await expect(page.getByTestId('client-profile-rebook')).toHaveCount(0);

  const sectionSelect = page.getByLabel('Client profile section', { exact: true });
  await sectionSelect.selectOption('preferences');

  await expect(page.getByText('No client-submitted preferences yet.')).toBeVisible();

  await sectionSelect.selectOption('notes');

  await expect(page.getByText('No appointment photos yet.')).toBeVisible();
  expect(writes).toEqual([]);
  expect(unexpected).toEqual([]);
});

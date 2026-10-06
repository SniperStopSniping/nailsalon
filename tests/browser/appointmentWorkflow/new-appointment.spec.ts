import { expect, type Page, test } from '@playwright/test';

const services = Array.from({ length: 8 }, (_, index) => ({
  id: `service_${index + 1}`,
  name: index === 0 ? 'Russian Manicure with Structured Builder Gel and Detailed Cuticle Care' : `Studio service ${index + 1}`,
  price: 3500 + index * 500,
  durationMinutes: 30 + index * 5,
  category: index > 3 ? 'pedicure' : 'manicure',
}));

async function installApi(page: Page, options: { failLoad?: boolean; failSubmit?: boolean; failSearch?: boolean; multipleTechs?: boolean } = {}) {
  const submissions: Array<{ body: Record<string, unknown>; key: string | undefined }> = [];
  const searches: string[] = [];
  const unexpected: string[] = [];
  let failedLoad = false;
  let failedSearch = false;
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3146') {
      unexpected.push(url.origin + url.pathname);
      await route.abort();
      return;
    }
    if (url.pathname === '/api/admin/technicians') {
      if (options.failLoad && !failedLoad) {
        failedLoad = true;
        await route.fulfill({ status: 503, json: {} });
        return;
      }
      await route.fulfill({ json: { data: { technicians: [{ id: 'tech_1', name: 'Daniela', avatarUrl: null }, ...(options.multipleTechs ? [{ id: 'tech_2', name: 'Ari', avatarUrl: null }] : [])] } } });
      return;
    }
    if (url.pathname === '/api/salon/services') {
      await route.fulfill({ json: { data: { services } } });
      return;
    }
    if (url.pathname === '/api/admin/clients') {
      searches.push(url.searchParams.get('search') || '');

      expect(url.searchParams.get('salonSlug')).toBe('fixture');

      if (options.failSearch && !failedSearch) {
        failedSearch = true;
        await route.fulfill({ status: 503, json: {} });
        return;
      }
      await route.fulfill({ json: { data: { clients: url.searchParams.get('search') === 'Nobody' ? [] : [{ id: 'client_1', fullName: 'Alexandria Verylongname', phone: '+14165550101', email: 'alex@example.test' }] } } });
      return;
    }
    if (url.pathname === '/api/appointments' && request.method() === 'POST') {
      submissions.push({ body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (options.failSubmit && submissions.length === 1) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: 201, json: { appointmentId: 'synthetic_appointment' } });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      unexpected.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    await route.continue();
  });
  return { submissions, searches, unexpected };
}

async function openForm(page: Page, query = '') {
  await page.goto(`/${query}`);
  await page.getByTestId('open-new-appointment').click();

  await expect(page.getByLabel('Phone Number *')).toBeVisible();
}

test('client lookup and compact services create an owner appointment with the selected date and one technician', async ({ page }, testInfo) => {
  const { submissions, unexpected } = await installApi(page);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openForm(page);

  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2099-07-20');
  await expect(page.getByRole('button', { name: 'Technician Daniela', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Appointment', exact: true })).toBeInViewport();

  await page.screenshot({ path: testInfo.outputPath('new-appointment-initial.png') });
  await page.getByRole('button', { name: 'Find existing client', exact: true }).click();
  await page.getByLabel('Find an existing client').fill('Alex');
  await page.getByRole('button', { name: /Alexandria Verylongname/ }).click();

  await expect(page.getByLabel('Phone Number *')).toHaveValue('(416) 555-0101');
  await expect(page.getByLabel('Email (optional)')).toHaveValue('alex@example.test');
  await expect(page.getByLabel('Client Name (optional)')).toHaveValue('Alexandria Verylongname');

  await page.getByRole('button', { name: /Russian Manicure/ }).click();

  await expect(page.getByRole('button', { name: /Studio service 8/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Show all 8 services' }).click();
  await page.getByRole('button', { name: /Studio service 8/ }).click();
  await page.getByRole('button', { name: 'Show fewer services' }).click();

  await expect(page.getByRole('button', { name: /Studio service 8/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('new-appointment-summary')).toContainText('2 services');
  await expect(page.getByTestId('new-appointment-summary')).toContainText('105');
  await expect(page.getByRole('button', { name: 'Create Appointment', exact: true })).toBeInViewport();

  await page.screenshot({ path: testInfo.outputPath('new-appointment-selected.png') });
  await page.getByRole('button', { name: 'Create Appointment', exact: true }).click();

  await expect(page.getByTestId('appointment-created')).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.body).toMatchObject({ salonSlug: 'fixture', serviceIds: ['service_1', 'service_8'], technicianId: 'tech_1', clientPhone: '4165550101', clientName: 'Alexandria Verylongname', clientEmail: 'alex@example.test' });
  expect(submissions[0]!.key).toBeTruthy();
  expect(unexpected).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('loading and search errors recover, and a lost submission preserves the draft and retry identity', async ({ page }, testInfo) => {
  const { submissions, unexpected } = await installApi(page, { failLoad: true, failSearch: true, failSubmit: true });
  await openForm(page);

  await expect(page.getByTestId('new-appointment-error')).toContainText('Failed to load form data');
  await expect(page.getByRole('button', { name: 'Create Appointment', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Retry loading' }).click();

  await expect(page.getByRole('button', { name: 'Technician Daniela', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Find existing client', exact: true }).click();
  await page.getByLabel('Find an existing client').fill('Alex');

  await expect(page.getByText('Client search is unavailable.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Retry search' }).click();
  await page.getByRole('button', { name: /Alexandria Verylongname/ }).click();
  await page.getByRole('button', { name: /Russian Manicure/ }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(page.getByTestId('open-new-appointment')).toBeFocused();

  await page.getByTestId('open-new-appointment').click();

  await expect(page.getByText('Your saved appointment draft was restored.')).toBeVisible();
  await expect(page.getByLabel('Phone Number *')).toHaveValue('(416) 555-0101');

  await page.getByRole('button', { name: 'Create Appointment', exact: true }).click();

  await expect(page.getByTestId('new-appointment-error')).toContainText('whether the appointment was saved');

  await page.screenshot({ path: testInfo.outputPath('new-appointment-retry.png') });
  await page.getByRole('button', { name: 'Create Appointment', exact: true }).click();

  await expect(page.getByTestId('appointment-created')).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
  expect(unexpected).toEqual([]);
});

test('rebooking retains all services and remains usable with enlarged text and a smaller visual viewport', async ({ page }, testInfo) => {
  const { unexpected } = await installApi(page);
  await openForm(page, '?rebook=1');

  await expect(page.getByRole('button', { name: /Studio service 6/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Studio service 7/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Phone Number *')).toHaveValue('(416) 555-0101');

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const dialog = page.getByRole('dialog', { name: 'New Appointment' });

  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Create Appointment', exact: true })).toBeInViewport();

  await page.screenshot({ path: testInfo.outputPath('new-appointment-200-percent.png') });

  const dateFits = await page.getByLabel('Date', { exact: true }).evaluate((element) => {
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    return element.getBoundingClientRect().width >= size * 6.5 + 24;
  });

  expect(dateFits).toBe(true);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.getByLabel('Phone Number *').focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 390 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });

  await expect.poll(async () => {
    const box = await page.getByRole('button', { name: 'Create Appointment', exact: true }).boundingBox();
    return box ? box.y + box.height : 1000;
  }).toBeLessThanOrEqual(390);
  await expect.poll(async () => {
    const phone = await page.getByLabel('Phone Number *').boundingBox();
    const body = await page.getByTestId('new-appointment-body').boundingBox();
    return Boolean(phone && body && phone.y >= body.y && phone.y + phone.height <= body.y + body.height);
  }).toBe(true);
  expect((await page.getByTestId('new-appointment-body').boundingBox())!.height).toBeGreaterThan(150);

  await page.screenshot({ path: testInfo.outputPath('new-appointment-reduced-viewport.png') });

  expect(unexpected).toEqual([]);
});

test('desktop keeps client and service panels together and respects an explicit any-technician choice', async ({ page }, testInfo) => {
  const { submissions, unexpected } = await installApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openForm(page);
  await page.getByRole('button', { name: 'Technician Daniela', exact: true }).click();
  await page.getByRole('button', { name: 'Any available technician', exact: true }).click();
  await page.getByLabel('Phone Number *').fill('+1 (416) 555-0101');
  await page.getByRole('button', { name: /Russian Manicure/ }).click();
  const client = await page.getByRole('region', { name: 'Client', exact: true }).boundingBox();
  const service = await page.getByRole('region', { name: 'Services *', exact: true }).boundingBox();

  expect(service!.x).toBeGreaterThan(client!.x + client!.width);
  await expect(page.getByRole('button', { name: 'Create Appointment', exact: true })).toBeInViewport();

  await page.screenshot({ path: testInfo.outputPath('new-appointment-desktop.png') });
  await page.getByRole('button', { name: 'Create Appointment', exact: true }).click();

  await expect(page.getByTestId('appointment-created')).toBeVisible();
  expect(submissions[0]!.body.technicianId).toBeNull();
  expect(submissions[0]!.body.clientPhone).toBe('4165550101');
  expect(unexpected).toEqual([]);
});

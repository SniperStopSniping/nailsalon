import { expect, type Page, test } from '@playwright/test';

const services = Array.from({ length: 8 }, (_, index) => ({
  id: `service_${index + 1}`,
  name: index === 0 ? 'Russian Manicure with Structured Builder Gel and Detailed Cuticle Care' : index === 1 ? 'BIAB French' : `Studio service ${index + 1}`,
  price: index === 1 ? 7500 : 3500 + index * 500,
  durationMinutes: index === 1 ? 90 : 30 + index * 5,
  category: index > 3 ? 'pedicure' : 'manicure',
}));

async function installApi(page: Page, options: { failLoad?: boolean; failSubmit?: boolean; failSearch?: boolean; multipleTechs?: boolean; anyTechnician?: boolean; allowNextDate?: boolean } = {}) {
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
    if (url.pathname === '/api/appointments/availability' && request.method() === 'GET') {
      expect(url.searchParams.get('salonSlug')).toBe('fixture');

      const date = url.searchParams.get('date');
      const nextDay = date === '2099-07-21';

      expect(date).toBe(nextDay && options.allowNextDate ? '2099-07-21' : '2099-07-20');
      expect(url.searchParams.get('technicianId')).toBe(options.anyTechnician ? null : 'tech_1');

      const requestedIds = url.searchParams.get('serviceIds')?.split(',') || [];

      expect(requestedIds.length).toBeGreaterThan(0);
      expect(requestedIds.every(id => services.some(service => service.id === id))).toBe(true);

      await route.fulfill({ json: { slots: [
        { time: nextDay ? '12:00' : '11:00', startTime: `${date}T${nextDay ? '16:00' : '15:00'}:00.000Z`, availability: 'available' },
        { time: nextDay ? '12:30' : '11:30', startTime: `${date}T${nextDay ? '16:30' : '15:30'}:00.000Z`, availability: 'schedule_conflict' },
      ] } });
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
  await expect(page.getByTestId('appointment-primary-action')).toBeInViewport();

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
  await expect(page.getByTestId('appointment-primary-action')).toBeInViewport();

  const openings = page.getByRole('region', { name: 'Find a time' });

  await expect(openings.getByRole('button', { name: '11:30', exact: true })).toHaveCount(0);

  await openings.getByRole('button', { name: '11:00', exact: true }).click();

  await expect(page.getByTestId('new-appointment-summary')).toContainText('11:00');

  await page.screenshot({ path: testInfo.outputPath('new-appointment-selected.png') });
  await page.getByRole('button', { name: 'Create Appointment', exact: true }).click();

  await expect(page.getByTestId('appointment-created')).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]!.body).toMatchObject({ salonSlug: 'fixture', serviceIds: ['service_1', 'service_8'], technicianId: 'tech_1', clientPhone: '4165550101', clientName: 'Alexandria Verylongname', clientEmail: 'alex@example.test' });
  expect(submissions[0]!.body.startTime).toBe('2099-07-20T15:00:00.000Z');
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

  await page.getByRole('region', { name: 'Find a time' }).getByRole('button', { name: '11:00', exact: true }).click();
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
  await expect(page.getByTestId('appointment-primary-action')).toBeInViewport();

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
    const box = await page.getByTestId('appointment-primary-action').boundingBox();
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
  const { submissions, unexpected } = await installApi(page, { anyTechnician: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openForm(page);
  await page.getByRole('button', { name: 'Technician Daniela', exact: true }).click();
  await page.getByRole('button', { name: 'Any available technician', exact: true }).click();
  await page.getByLabel('Phone Number *').fill('+1 (416) 555-0101');
  await page.getByRole('button', { name: /Russian Manicure/ }).click();
  const client = await page.getByRole('region', { name: 'Client', exact: true }).boundingBox();
  const service = await page.getByRole('region', { name: 'Services *', exact: true }).boundingBox();

  expect(client!.x).toBeGreaterThan(service!.x + service!.width);
  await expect(page.getByTestId('appointment-primary-action')).toBeInViewport();

  await page.screenshot({ path: testInfo.outputPath('new-appointment-desktop.png') });
  await page.getByRole('region', { name: 'Find a time' }).getByRole('button', { name: '11:00', exact: true }).click();
  await page.getByRole('button', { name: 'Create Appointment', exact: true }).click();

  await expect(page.getByTestId('appointment-created')).toBeVisible();
  expect(submissions[0]!.body.technicianId).toBeNull();
  expect(submissions[0]!.body.clientPhone).toBe('4165550101');
  expect(unexpected).toEqual([]);
});

for (const entry of [
  { id: 'open-new-appointment', title: 'New Appointment', screenshot: 'new-appointment' },
  { id: 'open-walk-in', title: 'Quick Walk-in', screenshot: 'walk-in' },
]) {
  test(`${entry.title} selects a service, checks a new date, then saves an available time`, async ({ page }, testInfo) => {
    const { submissions, unexpected } = await installApi(page, { allowNextDate: true });
    await page.clock.setFixedTime(new Date('2099-07-20T12:00:00.000Z'));
    await page.goto('/');
    await page.getByTestId(entry.id).click();
    const form = page.getByRole('dialog', { name: entry.title, exact: true });
    const service = form.getByRole('button', { name: /BIAB French/ });
    const date = form.getByLabel('Date', { exact: true });
    const summary = form.getByTestId('new-appointment-summary');
    const times = form.getByRole('region', { name: 'Find a time' });
    const primaryAction = form.getByTestId('appointment-primary-action');

    await expect(service).toContainText('1h 30m');
    expect(await service.evaluate(element => Boolean(element.compareDocumentPosition(document.getElementById('appointment-date')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await expect(times).toHaveCount(0);
    await expect(primaryAction).toHaveText('Choose a service');

    await primaryAction.click();

    await expect(form.getByRole('heading', { name: 'Services *', exact: true })).toBeFocused();

    await service.click();

    await expect(primaryAction).toHaveText('See available times');

    await primaryAction.click();

    await expect(form.getByRole('heading', { name: 'Date & time', exact: true })).toBeFocused();

    const quickDates = form.getByRole('group', { name: 'Quick dates' });

    await expect(quickDates.getByRole('button', { name: 'Today', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(times.getByRole('button', { name: '11:00', exact: true })).toBeVisible();

    await quickDates.getByRole('button', { name: 'Tomorrow', exact: true }).click();

    await expect(date).toHaveValue('2099-07-21');
    await expect(times.getByRole('button', { name: '11:00', exact: true })).toHaveCount(0);
    await expect(times.getByRole('button', { name: '12:30', exact: true })).toHaveCount(0);
    expect(submissions).toHaveLength(0);

    await times.getByRole('button', { name: '12:00', exact: true }).click();

    await expect(summary).toContainText('12:00–13:30');
    await expect(summary).toContainText('1h 30m');
    await expect(primaryAction).toHaveText('Add client details');
    await expect(primaryAction).toBeInViewport();

    await page.screenshot({ path: testInfo.outputPath(`${entry.screenshot}-availability.png`), animations: 'disabled' });
    await primaryAction.click();

    await expect(form.getByRole('heading', { name: 'Client', exact: true })).toBeFocused();

    await form.getByLabel('Phone Number *').fill('4165550198');

    await expect(primaryAction).toHaveText('Create Appointment');

    await primaryAction.click();

    await expect(page.getByTestId('appointment-created')).toBeVisible();
    expect(submissions.map(submission => submission.body)).toEqual([{
      salonSlug: 'fixture',
      serviceIds: ['service_2'],
      technicianId: 'tech_1',
      clientPhone: '4165550198',
      startTime: '2099-07-21T16:00:00.000Z',
    }]);
    expect(unexpected).toEqual([]);
  });
}

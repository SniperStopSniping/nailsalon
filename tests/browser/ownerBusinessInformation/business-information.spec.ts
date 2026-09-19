/* eslint-disable style/max-statements-per-line */
import { expect, test } from '@playwright/test';

type Page = import('@playwright/test').Page;

const profile = {
  showBio: false,
  showBookingPolicy: false,
  showCancellationPolicy: false,
  showEmail: false,
  showHours: false,
  showInstagram: false,
  showLocation: false,
  showPhone: false,
  showReviews: false,
  showTechName: false,
  showTechPhoto: false,
};
const side = {
  layout: 'quick_book',
  serviceMenuLayout: 'visual_grid',
  stylePack: 'default',
  tokenOverrides: null,
  sectionOrder: ['salonProfile', 'serviceMenu', 'featuredServices', 'policies', 'socialLinks', 'bookingCta'],
  sectionVariants: {},
  hiddenSections: [],
  businessMode: 'solo',
  startMode: 'services_first',
  quickBookProfile: profile,
};
const businessHours = { monday: { open: '10:00', close: '18:00' }, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null };

function bookingState() {
  return {
    config: { version: 1, draft: side, live: side, draftPresetBase: { presetId: 'quick_book', recipeVersion: 1 }, livePresetBase: { presetId: 'quick_book', recipeVersion: 1 } },
    content: { version: 1, draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' }, live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' } },
    salon: { publicationStatus: 'published' },
    savedDetails: {},
    presentationPreview: null,
  };
}
function information() {
  return { data: {
    salon: { id: 'salon_isla', slug: 'isla', name: 'Isla Nail Studio', publicationStatus: 'published', slugLocked: true, customDomain: null, publicUrl: 'https://luster.test/isla', logoUrl: null, phone: '4165550111', email: 'hello@isla.test' },
    technician: null,
    technicianCount: 1,
    instagram: null,
    instagramHandle: null,
    location: { id: 'location_isla', name: 'Isla Nail Studio', address: '1 King St', city: 'Toronto', state: 'ON', zipCode: 'M5H 1A1' },
    addressPrivacy: { draft: 'full_address', live: 'full_address' },
    contactPreferences: { bookingOnlyContact: false, callEnabled: true, textEnabled: true, textNumber: '4165550111' },
    businessHours,
    staffedDays: ['monday'],
    timezone: 'America/Toronto',
  } };
}

async function mockLocalApi(page: Page, { failInformationSave = false }: { failInformationSave?: boolean } = {}) {
  const writes: Array<{ path: string; salonSlug: string | null; body: unknown }> = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3139') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort(); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue(); return;
    }
    if (url.pathname === '/api/admin/auth/me') {
      await route.fulfill({ json: { user: { id: 'owner' } } }); return;
    }
    if (url.pathname === '/api/admin/booking-page') {
      await route.fulfill({ json: bookingState() }); return;
    }
    if (url.pathname === '/api/admin/salon/information' && request.method() === 'GET') {
      await route.fulfill({ json: information() }); return;
    }
    if (url.pathname === '/api/admin/salon/information' && request.method() === 'PATCH') {
      writes.push({ path: url.pathname, salonSlug: url.searchParams.get('salonSlug'), body: request.postDataJSON() });
      if (failInformationSave) {
        await route.fulfill({ status: 503, json: { error: { message: 'Information unavailable' } } }); return;
      }
      await route.fulfill({ json: information() }); return;
    }
    if (url.pathname === '/api/admin/location' && request.method() === 'PATCH') {
      writes.push({ path: url.pathname, salonSlug: url.searchParams.get('salonSlug'), body: request.postDataJSON() }); await route.fulfill({ json: { data: { location: information().data.location } } }); return;
    }
    if (url.pathname === '/api/admin/retention/settings' && request.method() === 'GET') {
      const parkingInstructions = url.searchParams.get('salonSlug') === 'beta'
        ? 'Beta parking only.'
        : 'Park behind the studio.';
      await route.fulfill({ json: { data: { settings: { parkingInstructions } } } }); return;
    }
    if (url.pathname === '/api/admin/retention/settings' && request.method() === 'PATCH') {
      writes.push({ path: url.pathname, salonSlug: url.searchParams.get('salonSlug'), body: request.postDataJSON() }); await route.fulfill({ json: { data: { settings: { parkingInstructions: request.postDataJSON().parkingInstructions } } } }); return;
    }
    // The actual Owner Assistant remains silent when no fixture context exists.
    if (url.pathname.startsWith('/api/admin/owner-assistant')) {
      await route.fulfill({ status: 404, json: {} }); return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`); await route.abort();
  });
  return { writes, unexpected };
}

test('mobile business information preserves canonical live editors and header saves', async ({ page }) => {
  const api = await mockLocalApi(page);
  await page.goto('/?salon=isla&panel=business&returnTo=%2Fen%2Fadmin%3Fsalon%3Disla');

  await expect(page.locator('h1')).toHaveText('Business Information');
  await expect(page.locator('#settings-parking-instructions')).toHaveValue('Park behind the studio.');
  await expect(page.getByTestId('information-hours-monday-open')).toHaveCount(0);
  await expect(page.getByText('Address privacy', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator('#settings-parking-instructions').fill('Use the side entrance.');
  await page.getByRole('button', { name: 'Save parking info' }).click();

  await expect.poll(() => api.writes.length).toBe(1);

  await page.getByRole('button', { name: 'Booking Page' }).click();

  expect(api.writes).toContainEqual({ path: '/api/admin/retention/settings', salonSlug: 'isla', body: { parkingInstructions: 'Use the side entrance.' } });
  await expect(page).toHaveURL(/\/en\/admin\/website\?salon=isla/);
  expect(api.unexpected).toEqual([]);
});

test('dirty parking offers Keep editing or Discard before header navigation', async ({ page }) => {
  const api = await mockLocalApi(page);
  await page.goto('/?salon=isla&panel=business');
  await page.locator('#settings-parking-instructions').fill('Unsaved arrival note');
  await page.getByRole('button', { name: 'Booking Page' }).click();

  await expect(page.getByRole('heading', { name: 'Discard parking changes?' })).toBeVisible();

  await page.getByRole('button', { name: 'Keep editing' }).click();

  await expect(page).toHaveURL(/panel=business/);
  await expect(page.locator('#settings-parking-instructions')).toHaveValue('Unsaved arrival note');
  expect(api.writes).toEqual([]);

  await page.getByRole('button', { name: 'Booking Page' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();

  await expect(page).toHaveURL(/\/en\/admin\/website\?salon=isla/);
  expect(api.writes).toEqual([]);
});

test('a client-side salon switch remounts the business editor before any write', async ({ page }) => {
  const api = await mockLocalApi(page);
  await page.goto('/?salon=isla&panel=business');

  await expect(page.locator('#settings-parking-instructions')).toHaveValue('Park behind the studio.');

  await page.locator('#settings-parking-instructions').fill('A draft must not carry over');

  await page.evaluate(() => {
    window.history.pushState({}, '', '/?salon=beta&panel=business');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  await expect(page.locator('#settings-parking-instructions')).toHaveValue('Beta parking only.');

  await page.locator('#settings-parking-instructions').fill('Beta saved note');
  await page.getByRole('button', { name: 'Save parking info' }).click();

  await expect.poll(() => api.writes.length).toBe(1);
  expect(api.writes).toEqual([
    { path: '/api/admin/retention/settings', salonSlug: 'beta', body: { parkingInstructions: 'Beta saved note' } },
  ]);
});

test('discarded parking is never saved when a dirty information retry fails', async ({ page }) => {
  const api = await mockLocalApi(page, { failInformationSave: true });
  await page.goto('/?salon=isla&panel=business');

  await expect(page.locator('#settings-parking-instructions')).toHaveValue('Park behind the studio.');

  await page.getByTestId('information-identity').evaluate((element) => {
    (element as HTMLDetailsElement).open = true;
  });
  await page.getByTestId('information-business-name').fill('Unsaved salon name');
  await page.locator('#settings-parking-instructions').fill('Discarded parking note');
  await page.getByRole('button', { name: 'Booking Page' }).click();
  await page.getByRole('button', { name: 'Discard changes' }).click();

  await expect(page.getByText('Your changes could not be saved. Please retry before leaving this editor.')).toBeVisible();
  expect(api.writes).toEqual([
    { path: '/api/admin/salon/information', salonSlug: 'isla', body: { name: 'Unsaved salon name' } },
  ]);

  await page.getByRole('button', { name: 'Booking Page' }).click();

  await expect.poll(() => api.writes.length).toBe(2);
  expect(api.writes.every(write => write.path !== '/api/admin/retention/settings')).toBe(true);
});

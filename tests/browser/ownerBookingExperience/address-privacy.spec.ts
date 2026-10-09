import { expect, test } from '@playwright/test';

import type { SalonInformation } from '@/components/admin/BookingPageInformationEditor';

import { mockApi } from './fixtures';

const information: SalonInformation = {
  salon: {
    id: 'synthetic-salon',
    slug: 'isla',
    name: 'Synthetic Studio',
    logoUrl: null,
    publicationStatus: 'published',
    slugLocked: true,
    customDomain: null,
    publicUrl: 'https://synthetic.invalid/isla',
    phone: null,
    email: null,
  },
  location: { id: 'synthetic-location', name: 'Studio', city: 'Toronto', address: 'Synthetic address', state: 'ON', zipCode: null },
  technician: null,
  technicianCount: 1,
  instagram: null,
  addressPrivacy: { draft: 'full_address', live: 'full_address' },
  contactPreferences: { bookingOnlyContact: false, callEnabled: false, textEnabled: false, textNumber: null },
  businessHours: null,
  staffedDays: [],
  timezone: 'America/Toronto',
};

for (const width of [390, 1440]) {
  test(`address privacy waits for both saves and preserves the live choice at ${width}px`, async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await mockApi(page, false);
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/admin/salon/information?*', route => route.fulfill({ json: { data: information } }));
    const loaded = page.waitForResponse(response => (
      new URL(response.url()).pathname === '/api/admin/booking-page'
        && response.request().method() === 'GET'
    ));
    await page.goto('/?salon=isla&panel=information');
    const state = await (await loaded).json();
    const writes: unknown[] = [];
    let releaseWrite: (() => void) | undefined;
    await page.route('**/api/admin/booking-page?*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: state });
        return;
      }

      expect(route.request().method()).toBe('PATCH');

      const body = route.request().postDataJSON();
      writes.push(body);
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      state.content.draft = { ...state.content.draft, ...body.content };
      await route.fulfill({ json: state });
    });

    await page.getByTestId('information-location').locator('summary').click();
    const cityOnly = page.getByTestId('address-privacy-city_only');
    const fullAddress = page.getByTestId('address-privacy-full_address');
    const warning = page.getByTestId('address-privacy-unpublished');
    const status = page.getByRole('status', { name: 'Page draft status' });

    await expect(cityOnly).toBeVisible();
    await expect(fullAddress).toBeChecked();
    await expect(warning).toHaveCount(0);

    await cityOnly.check();

    await expect.poll(() => writes).toEqual([{ content: { locationDisplayMode: 'city_only' } }]);
    await expect(cityOnly).toBeChecked();
    await expect(status).toHaveText('Saving draft…');
    expect(state.content.draft.locationDisplayMode).toBe('full_address');
    await expect(warning).toHaveCount(0);

    releaseWrite!();

    await expect(status).toContainText('Draft saved');
    await expect(warning).toHaveText('Your live site still uses “Always show my full address” until you publish.');
    expect(state.content.live.locationDisplayMode).toBe('full_address');

    await fullAddress.check();

    await expect.poll(() => writes).toEqual([
      { content: { locationDisplayMode: 'city_only' } },
      { content: { locationDisplayMode: 'full_address' } },
    ]);
    await expect(fullAddress).toBeChecked();
    await expect(status).toHaveText('Saving draft…');
    await expect(warning).toBeVisible();
    expect(state.content.draft.locationDisplayMode).toBe('city_only');

    await page.screenshot({ path: testInfo.outputPath(`privacy-saving-${width}.png`), fullPage: false });
    releaseWrite!();

    await expect(status).toHaveText('Published · No page changes');
    await expect(warning).toHaveCount(0);
    await expect(fullAddress).toBeChecked();
    expect(state.content.draft.locationDisplayMode).toBe('full_address');
    expect(state.content.live.locationDisplayMode).toBe('full_address');
    expect(writes).toHaveLength(2);
    expect(pageErrors).toEqual([]);

    await page.screenshot({ path: testInfo.outputPath(`privacy-restored-${width}.png`), fullPage: false });
  });
}

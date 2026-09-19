/* eslint-disable style/max-statements-per-line */
import { expect, test } from '@playwright/test';

async function mockApi(page: import('@playwright/test').Page, freeSolo: boolean, authDelayMs = 0) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3140') {
      await route.abort(); return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue(); return;
    }
    if (url.pathname === '/api/admin/auth/me') {
      if (authDelayMs) await new Promise(resolve => setTimeout(resolve, authDelayMs));
      await route.fulfill({ json: { user: { id: 'owner', salons: [{ slug: 'isla', freeSoloEnabled: freeSolo }] } } }); return;
    }
    if (url.pathname === '/api/admin/booking-page') {
      const side = { layout: 'quick_book', serviceMenuLayout: 'visual_grid', stylePack: 'default', tokenOverrides: null, sectionOrder: [], sectionVariants: {}, hiddenSections: [], businessMode: 'solo', startMode: 'services_first', quickBookProfile: { showBio: false, showBookingPolicy: false, showCancellationPolicy: false, showEmail: false, showHours: false, showInstagram: false, showLocation: false, showPhone: false, showReviews: false, showTechName: false, showTechPhoto: false } };
      await route.fulfill({ json: { config: { version: 1, draft: side, live: side, draftPresetBase: { presetId: 'quick_book', recipeVersion: 1 }, livePresetBase: { presetId: 'quick_book', recipeVersion: 1 } }, content: { version: 1, draft: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' }, live: { heroImageUrl: null, specialtyLine: null, bio: null, locationDisplayMode: 'full_address' } }, salon: { publicationStatus: 'published' } } }); return;
    }
    if (url.pathname === '/api/admin/salon/settings') {
      await route.fulfill({ json: { bookingExperience: { primaryColor: null, bookingMessage: 'Welcome', socialLinks: { instagram: null, facebook: null, tiktok: null }, confirmationMessage: 'Thanks', policy: { enabled: false, title: null, text: null, showOnServicePage: true, showBeforeConfirmation: true, showAfterConfirmation: true, showInConfirmationEmail: true, acknowledgment: { required: false, text: null }, version: null }, quickFacts: { appointmentOnly: { enabled: false, label: null }, depositNotice: { enabled: false, label: null }, cancellationNotice: { enabled: false, label: null } } }, bookingConfig: {} } }); return;
    }
    if (url.pathname === '/api/admin/settings/modules') {
      await route.fulfill({ json: { data: { modules: {}, entitledModules: {}, moduleReasons: {} } } }); return;
    }
    if (url.pathname === '/api/admin/settings/visibility') {
      await route.fulfill({ json: { data: { visibility: { staff: {} } } } }); return;
    }
    if (url.pathname === '/api/admin/settings/booking-flow') {
      await route.fulfill({ json: { data: { bookingFlowCustomizationEnabled: true, bookingFlow: ['service', 'time', 'confirm'] } } }); return;
    }
    if (url.pathname === '/api/admin/profile') {
      await route.fulfill({ json: { user: {} } }); return;
    }
    if (url.pathname.startsWith('/api/admin/owner-assistant')) {
      await route.fulfill({ status: 404, json: {} }); return;
    }
    await route.fulfill({ json: {} });
  });
}

test('experience is mobile canonical and Flow fails closed for Free Solo', async ({ page }) => {
  await mockApi(page, true);
  await page.goto('/?salon=isla&panel=experience');

  await expect(page.getByLabel('Booking message')).toHaveValue('Welcome');
  await expect(page.getByText('Legacy Page Themes')).toHaveCount(0);
  await expect(page.getByText('Website colours are set in Booking Page')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto('/?salon=isla&panel=flow');

  await expect(page.getByTestId('booking-flow-unavailable')).toContainText('not included with Free Solo');
  await page.getByRole('button', { name: 'Booking Page' }).click();
  await expect(page).toHaveURL(/\/en\/admin\/website\?salon=isla$/);
});

test('team Flow stays closed while its scoped access check is pending', async ({ page }) => {
  await mockApi(page, false, 250);
  await page.goto('/?salon=isla&panel=flow');

  await expect(page.getByRole('status')).toContainText('Checking booking flow access');
  await expect(page.getByText('Customize Booking Flow')).toHaveCount(0);
  await expect(page.getByText('Customize Booking Flow')).toBeVisible();
});

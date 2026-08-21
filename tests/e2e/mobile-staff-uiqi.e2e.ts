import { expect, type Locator, type Page, test } from '@playwright/test';

import { appPath } from './support/config';

const APPOINTMENT_ID = 'appt-stage3c2';

function syntheticAppointment() {
  const startTime = new Date(Date.now() + 30 * 60_000);
  const endTime = new Date(startTime.getTime() + 75 * 60_000);

  return {
    id: APPOINTMENT_ID,
    clientName: 'Ava Example',
    clientPhone: '4165550123',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    status: 'confirmed',
    canvasState: 'waiting',
    technicianId: 'tech-stage3c2',
    services: [{ name: 'BIAB Short' }],
    totalPrice: 6500,
    invoiceCurrency: 'CAD',
    photos: [],
  };
}

async function installSyntheticStaffDashboard(page: Page) {
  let transitionRequests = 0;

  await page.route('**/api/staff/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        technician: { id: 'tech-stage3c2', name: 'Taylor Artist' },
        salon: { id: 'salon-stage3c2', name: 'Luster Test Salon', slug: 'luster-test-salon' },
      },
    }),
  }));
  await page.route('**/api/staff/capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        modules: { scheduleOverrides: true, staffEarnings: true },
        visibility: {
          clientPhone: true,
          clientEmail: true,
          clientFullName: true,
          appointmentPrice: true,
          clientHistory: true,
          clientNotes: true,
          otherTechAppointments: false,
        },
      },
    }),
  }));
  await page.route(/\/api\/staff\/notifications\?/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { notifications: [], unreadCount: 0 } }),
  }));
  await page.route(/\/api\/appointments\?/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: { appointments: [syntheticAppointment()] } }),
  }));
  await page.route(`**/api/appointments/${APPOINTMENT_ID}/transition`, async (route) => {
    transitionRequests += 1;
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { appointment: syntheticAppointment() } }),
    });
  });

  return {
    transitionRequests: () => transitionRequests,
  };
}

async function openDashboard(page: Page) {
  await page.goto(appPath('/staff'), { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId(`staff-appointment-${APPOINTMENT_ID}`)).toBeVisible();
}

async function dispatchLongPress(target: Locator) {
  await target.evaluate((element) => {
    const touch = new Touch({
      identifier: 1,
      target: element,
      clientX: 120,
      clientY: 240,
    });
    element.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: [touch],
      targetTouches: [touch],
      changedTouches: [touch],
    }));
  });
  await new Promise(resolve => setTimeout(resolve, 600));
  await target.evaluate((element) => {
    const touch = new Touch({
      identifier: 1,
      target: element,
      clientX: 120,
      clientY: 240,
    });
    element.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true,
      cancelable: true,
      touches: [],
      targetTouches: [],
      changedTouches: [touch],
    }));
  });
}

async function expectMinimumTarget(target: Locator) {
  const box = await target.boundingBox();

  expect(box).not.toBeNull();
  expect(Math.round(box!.width * 100) / 100).toBeGreaterThanOrEqual(44);
  expect(Math.round(box!.height * 100) / 100).toBeGreaterThanOrEqual(44);
}

async function assertOneUsableBottomRegion(page: Page) {
  const result = await page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-testid="staff-bottom-region"]');
    const action = document.querySelector<HTMLElement>('[data-testid="staff-bottom-context-action"]');
    const nav = region?.querySelector<HTMLElement>('nav');
    const appointment = document.querySelector<HTMLElement>('[data-testid^="staff-appointment-"]');
    if (!region || !action || !nav || !appointment) {
      return null;
    }

    window.scrollTo(0, document.documentElement.scrollHeight);
    const regionRect = region.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const appointmentRect = appointment.getBoundingClientRect();
    const visibleFixedBottomRegions = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.position === 'fixed'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
          && rect.bottom >= window.innerHeight - 1;
      })
      .map(element => element.dataset.testid ?? element.tagName.toLowerCase());
    const undersizedTargets = Array.from(region.querySelectorAll<HTMLElement>('button, a[href]'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        };
      })
      .filter(({ width, height }) => width < 44 || height < 44);
    const overflowingElements = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: element.dataset.testid
            ?? element.getAttribute('aria-label')
            ?? element.tagName.toLowerCase(),
          left: Math.round(rect.left * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
        };
      })
      .filter(({ left, right }) => left < -0.5 || right > document.documentElement.clientWidth + 0.5);

    return {
      actionDoesNotOverlapNav: actionRect.bottom <= navRect.top + 0.5,
      appointmentClearsRegion: appointmentRect.bottom <= regionRect.top + 0.5,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      navSafeAreaPadding: getComputedStyle(nav).paddingBottom,
      overflowingElements,
      regionBottom: Math.round(regionRect.bottom * 100) / 100,
      regionLeft: Math.round(regionRect.left * 100) / 100,
      regionRight: Math.round(regionRect.right * 100) / 100,
      undersizedTargets,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      visibleFixedBottomRegions,
    };
  });

  expect(result).not.toBeNull();
  expect(result!.visibleFixedBottomRegions).toEqual(['staff-bottom-region']);
  expect(result!.actionDoesNotOverlapNav).toBe(true);
  expect(result!.appointmentClearsRegion).toBe(true);
  expect(result!.undersizedTargets).toEqual([]);
  expect(result!.overflowingElements).toEqual([]);
  expect(result!.documentScrollWidth).toBe(result!.documentClientWidth);
  expect(result!.regionLeft).toBeGreaterThanOrEqual(0);
  expect(result!.regionRight).toBeLessThanOrEqual(result!.viewportWidth);
  expect(result!.regionBottom).toBeLessThanOrEqual(result!.viewportHeight);
  expect(Number.parseFloat(result!.navSafeAreaPadding)).toBeGreaterThanOrEqual(12);
}

test.use({ viewport: { width: 375, height: 600 } });

test('staff modal, resize, destructive, and bottom-edge contracts hold in Chromium', async ({ page }) => {
  test.slow();

  const requests = await installSyntheticStaffDashboard(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);

  const manage = page.getByTestId(`staff-appointment-action-${APPOINTMENT_ID}`);
  await manage.click();

  const actionDialog = page.getByRole('dialog', { name: 'Appointment Actions' });
  const closeActions = page.getByRole('button', { name: 'Close appointment actions' });

  await expect(actionDialog).toBeVisible();
  await expect(closeActions).toBeFocused();

  await expectMinimumTarget(closeActions);

  const actionFocusables = actionDialog.locator('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
  await actionFocusables.last().focus();
  await page.keyboard.press('Tab');

  await expect(actionFocusables.first()).toBeFocused();

  await page.keyboard.press('Shift+Tab');

  await expect(actionFocusables.last()).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(actionDialog).toBeHidden();
  await expect(page.locator('body')).toBeFocused();

  await manage.focus();
  await dispatchLongPress(page.getByTestId(`staff-appointment-${APPOINTMENT_ID}`));

  const sheet = page.getByRole('dialog', { name: 'Appointment details' });
  const slider = page.getByRole('slider', { name: 'Resize Appointment details' });

  await expect(sheet).toBeVisible();
  await expect(slider).toBeFocused();
  await expect(slider).toHaveAttribute('aria-valuenow', '60');
  await expect(sheet).toHaveCSS('transition-property', 'none');

  await expectMinimumTarget(slider);

  await page.keyboard.press('End');

  await expect(slider).toHaveAttribute('aria-valuenow', '92');

  await page.keyboard.press('ArrowDown');

  await expect(slider).toHaveAttribute('aria-valuenow', '60');

  await page.keyboard.press('Home');

  await expect(slider).toHaveAttribute('aria-valuenow', '30');

  const sliderBox = await slider.boundingBox();

  expect(sliderBox).not.toBeNull();

  await page.mouse.move(sliderBox!.x + sliderBox!.width / 2, sliderBox!.y + sliderBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sliderBox!.x + sliderBox!.width / 2, sliderBox!.y - 160, { steps: 4 });
  await page.mouse.up();

  await expect(slider).toHaveAttribute('aria-valuenow', '60');

  const resizedSliderBox = await slider.boundingBox();

  expect(resizedSliderBox).not.toBeNull();

  await page.mouse.move(
    resizedSliderBox!.x + resizedSliderBox!.width / 2,
    resizedSliderBox!.y + resizedSliderBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resizedSliderBox!.x + resizedSliderBox!.width / 2,
    resizedSliderBox!.y + resizedSliderBox!.height / 2 + 160,
    { steps: 4 },
  );
  await page.mouse.up();

  await expect(slider).toHaveAttribute('aria-valuenow', '30');

  const sheetFocusables = sheet.locator('button:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="slider"]');
  await slider.focus();
  await page.keyboard.press('Shift+Tab');

  await expect(sheetFocusables.last()).toBeFocused();

  await page.keyboard.press('Tab');

  await expect(slider).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(sheet).toBeHidden();
  await expect(page.locator('body')).toBeFocused();

  await manage.click();
  const cancelAppointment = page.getByRole('button', { name: 'Cancel Appointment', exact: true });
  await expectMinimumTarget(cancelAppointment);
  await cancelAppointment.click();
  const confirmation = page.getByRole('alertdialog', { name: /Cancel Ava Example's appointment/ });

  await expect(confirmation).toBeVisible();

  await expectMinimumTarget(page.getByRole('button', { name: 'Go back' }));
  await expectMinimumTarget(page.getByRole('button', { name: 'Cancel appointment', exact: true }));

  await page.getByRole('button', { name: 'Go back' }).click();

  await expect(confirmation).toBeHidden();
  await expect(cancelAppointment).toBeFocused();
  expect(requests.transitionRequests()).toBe(0);

  await cancelAppointment.click();
  await page.getByTestId('confirm-dialog-confirm').evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect.poll(requests.transitionRequests).toBe(1);
  await expect(actionDialog).toBeHidden();

  await expect(page.getByTestId('staff-floating-action')).toBeVisible();
  await expect(page.getByTestId('staff-floating-action')).toHaveCSS('animation-name', 'none');

  await assertOneUsableBottomRegion(page);

  await page.setViewportSize({ width: 320, height: 568 });
  await assertOneUsableBottomRegion(page);

  await page.setViewportSize({ width: 750, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await assertOneUsableBottomRegion(page);
});

test('staff bottom edge remains singular and usable in iPhone WebKit @mobile-safari', async ({ page }) => {
  await installSyntheticStaffDashboard(page);
  await openDashboard(page);

  const manage = page.getByTestId(`staff-appointment-action-${APPOINTMENT_ID}`);
  await manage.click();
  await page.keyboard.press('Escape');

  await expect(page.locator('body')).toBeFocused();
  await expect(page.getByTestId('staff-floating-action')).toBeVisible();

  await assertOneUsableBottomRegion(page);
});

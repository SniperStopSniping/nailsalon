import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { applySetupOperations, CLOSED_HOURS, type SetupDocument, setupReadiness } from '../../../src/features/business-setup/contracts';
import { resolveBookingConfigFromSettings } from '../../../src/libs/bookingConfig.shared';

test('owner team controls save, resume, preview and review on desktop and phones', async ({ page }, info) => {
  const hours = { ...CLOSED_HOURS, monday: { open: '09:00', close: '17:00' } };
  const service = { id: 'gel', name: 'Gel manicure', description: null, priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 10, category: 'manicure' as const, bookingCategory: 'manicure' as const, origin: 'existing' as const, confirmed: true };
  const baseline: SetupDocument = { schemaVersion: 1, business: { name: 'Synthetic Team Studio', city: 'Toronto', exactAddress: '', homeBased: false, workMode: 'team', locationDisplayMode: 'city_only' }, hours, booking: resolveBookingConfigFromSettings(null), services: [service], staff: [{ id: 'alex', name: 'Alex', hours, isActive: true, serviceIds: ['gel'], assignmentMode: 'explicit' }], staffUsesExplicitAssignments: true, website: { config: {}, content: {} } as SetupDocument['website'] };
  let draft = structuredClone(baseline);
  let revision = 1;
  const requests: any[] = [];
  const head = () => ({ workspace: { status: 'editing' }, revision: { revision, document: draft }, messages: [], uploadReviews: [] });
  await page.route('**/api/admin/business-setup**', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (body) {
      requests.push(body);
    }
    if (body?.action === 'edit') {
      const operations = body.edit.operations.map((operation: any) => operation.type === 'staff' && operation.values.hours === null ? { ...operation, values: { ...operation.values, hours: draft.staff![0]!.hours } } : operation);
      draft = applySetupOperations(draft, operations, 'owner');
      revision++;
    }
    if (body?.action === 'review') {
      return route.fulfill({ json: { data: { revision, hash: 'synthetic-exact-team-review', changes: [{ path: 'staff', before: baseline.staff, after: draft.staff }], blockers: setupReadiness(draft), appointmentImpact: { upcomingCount: 2, outsideHoursCount: 1, staffAffectedCount: 2, fingerprint: 'synthetic-calendar' } } } });
    }
    await route.fulfill({ json: { data: head() } });
  });
  await page.route('**/api/admin/custom-sites**', route => route.fulfill({ json: { head: head(), assets: [], preferences: null, history: [], attempts: [], configured: true, payload: null, rendererOrigin: null } }));
  await page.goto('/?builder=1');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const team = page.getByRole('region', { name: 'Team booking setup' });
  await team.getByRole('textbox', { name: 'Booking name' }).fill('Alex Smith');
  await team.getByText('Working hours', { exact: true }).click();
  await team.getByRole('checkbox', { name: 'Keep this draft’s schedule' }).uncheck();
  await team.getByLabel('Alex monday starts').fill('11:00');
  await team.getByRole('button', { name: 'Save team member' }).click();

  await expect(team.getByRole('textbox', { name: 'Booking name' })).toHaveValue('Alex Smith');
  expect(draft.staff![0]).toMatchObject({ name: 'Alex Smith', serviceIds: ['gel'], hours: { monday: { open: '11:00', close: '17:00' } } });

  await page.reload();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByText('Proposed team and service choices', { exact: true }).click();

  await expect(page.getByText(/Alex Smith: accepting bookings; Gel manicure; monday: 11:00–17:00/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const directory = path.join(process.cwd(), 'artifacts/ai-credits/team');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `preview-${info.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const review = page.getByRole('region', { name: 'Review your changes' });

  await expect(review.getByText(/New bookings will use your approved settings/)).toBeVisible();
  await expect(review.getByText(/Alex: accepting bookings; Gel manicure; monday: 09:00–17:00/)).toBeVisible();
  await expect(review.getByText(/Alex Smith: accepting bookings; Gel manicure; monday: 11:00–17:00/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeDisabled();

  await review.getByRole('checkbox', { name: /I understand these existing appointments/ }).check();

  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests.filter(request => ['approve', 'publish'].includes(request.action))).toEqual([]);

  await page.screenshot({ path: path.join(directory, `review-${info.project.name}.png`), fullPage: true });
});

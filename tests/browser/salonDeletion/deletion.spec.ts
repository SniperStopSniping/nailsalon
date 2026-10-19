import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { SALON_DELETION_RETAINED } from '../../../src/models/salonDeletion';

let blockedExternalRequests = 0;

test.beforeEach(async ({ page }) => {
  blockedExternalRequests = 0;
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:3196') {
      return route.continue();
    }
    blockedExternalRequests += 1;
    return route.abort();
  });
});

test.afterEach(() => {
  expect(blockedExternalRequests).toBe(0);
});

test('shows pending cleanup, retained categories and a separately acknowledged completion', async ({ page }, testInfo) => {
  const jobId = '00000000-0000-4000-8000-000000000001';
  const pending = { jobId, status: 'pending', databaseDeleted: true, rowsDeleted: 8, mediaTotal: 2, mediaRemoved: 1, mediaRemaining: 1, reviewRequired: 0, attempts: 1, nextAttemptAt: '2026-10-19T12:00:00Z', retained: SALON_DELETION_RETAINED };
  let destructiveCalls = 0;
  let confirmation: unknown;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.url().endsWith('/impact')) {
      return route.fulfill({ json: { totalRows: 8, tables: { appointment: 4, salon_client: 3, salon: 1 } } });
    }
    if (request.method() === 'DELETE') {
      destructiveCalls += 1;

      confirmation = request.postDataJSON();

      return route.fulfill({ status: 202, json: { success: false, cleanup: pending } });
    }
    if (request.url().endsWith(`/deletion-cleanup/${jobId}`) && request.method() === 'POST') {
      return route.fulfill({ json: { cleanup: { ...pending, status: 'completed', mediaRemoved: 2, mediaRemaining: 0, nextAttemptAt: null } } });
    }
    return route.abort();
  });
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Open deletion review' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Delete Salon' });

  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2')).toBeFocused();
  await expect(dialog).not.toContainText('Remove ALL data');

  await page.keyboard.press('Tab');

  await expect(dialog.getByRole('button', { name: 'Close modal' })).toBeFocused();

  await page.keyboard.press('Shift+Tab');

  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await page.keyboard.press('Tab');

  await expect(dialog.getByRole('button', { name: 'Close modal' })).toBeFocused();

  const confirm = dialog.getByRole('button', { name: 'Delete Permanently' });

  await expect(confirm).toBeDisabled();

  await dialog.getByLabel(/to confirm permanent deletion/).fill('disposable-test-salon');
  await confirm.click();

  await expect(dialog.getByRole('status')).toContainText('Media cleanup is unfinished');
  await expect(dialog).toContainText('Database backups');
  await expect(dialog).toContainText('People’s sign-in accounts');

  const screenshotDir = path.join(os.tmpdir(), 'luster-deletion-browser-proof');
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-pending.png`), fullPage: true });
  await dialog.getByRole('button', { name: 'Check cleanup status' }).click();

  await expect(dialog.getByRole('status')).toContainText('Tracked media cleanup is complete.');
  expect(destructiveCalls).toBe(1);
  expect(confirmation).toEqual({ confirmSlug: 'disposable-test-salon' });

  await dialog.getByRole('button', { name: 'Acknowledge and close' }).click();

  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('keeps public-image review unfinished after checking status', async ({ page }, testInfo) => {
  let deletes = 0;
  const cleanup = {
    jobId: '00000000-0000-4000-8000-000000000002',
    status: 'review_required',
    databaseDeleted: true,
    rowsDeleted: 8,
    mediaTotal: 2,
    mediaRemoved: 0,
    mediaRemaining: 2,
    reviewRequired: 2,
    attempts: 0,
    nextAttemptAt: null,
    retained: SALON_DELETION_RETAINED,
  };
  await page.route('**/api/**', async (route) => {
    if (route.request().url().endsWith('/impact')) {
      return route.fulfill({ json: { totalRows: 8, tables: { appointment: 7, salon: 1 } } });
    }
    if (route.request().method() === 'DELETE') {
      deletes += 1;
    }
    return route.fulfill({ status: 202, json: { cleanup } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open deletion review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Salon' });
  await dialog.getByLabel(/to confirm permanent deletion/).fill('disposable-test-salon');
  await dialog.getByRole('button', { name: 'Delete Permanently' }).click();

  await expect(dialog.getByRole('status')).toContainText('Requiring manual review: 2.');
  await expect(dialog).toContainText('Public, shared or unverified images need an operator’s review');
  await expect(dialog).not.toContainText('Automatic retries are scheduled');

  await dialog.getByRole('button', { name: 'Check cleanup status' }).click();

  await expect(dialog.getByRole('status')).toContainText('Media cleanup is unfinished');
  expect(deletes).toBe(1);

  const screenshotDir = path.join(os.tmpdir(), 'luster-deletion-browser-proof');
  await fs.mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${testInfo.project.name}-review-required.png`), fullPage: true });
});

test('Escape closes the modal and returns focus to its opener', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Open deletion review' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Delete Salon' });

  await expect(dialog.locator('h2')).toBeFocused();

  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Escape cannot dismiss while the destructive request is pending', async ({ page }) => {
  let releaseDelete: (() => void) | undefined;
  await page.route('**/api/**', async (route) => {
    if (route.request().url().endsWith('/impact')) {
      return route.fulfill({ json: { totalRows: 8, tables: { appointment: 4, salon: 1 } } });
    }
    if (route.request().method() === 'DELETE') {
      await new Promise<void>((resolve) => {
        releaseDelete = () => {
          void route.fulfill({
            status: 202,
            json: {
              success: false,
              cleanup: {
                jobId: '00000000-0000-4000-8000-000000000003',
                status: 'pending',
                databaseDeleted: true,
                rowsDeleted: 8,
                mediaTotal: 0,
                mediaRemoved: 0,
                mediaRemaining: 0,
                reviewRequired: 0,
                attempts: 0,
                nextAttemptAt: '2026-10-19T12:00:00Z',
                retained: SALON_DELETION_RETAINED,
              },
            },
          }).then(resolve);
        };
      });
      return;
    }
    return route.abort();
  });
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Open deletion review' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Delete Salon' });
  await dialog.getByLabel(/to confirm permanent deletion/).fill('disposable-test-salon');
  await dialog.getByRole('button', { name: 'Delete Permanently' }).click();

  await expect(dialog.getByRole('button', { name: 'Delete Permanently' })).toBeDisabled();

  await page.keyboard.press('Escape');

  await expect(dialog).toBeVisible();
  await expect(opener).not.toBeFocused();

  expect(typeof releaseDelete).toBe('function');

  releaseDelete!();

  await expect(dialog.getByRole('status')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

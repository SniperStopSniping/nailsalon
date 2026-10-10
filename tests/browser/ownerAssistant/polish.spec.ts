import { expect, test } from '@playwright/test';

import { expectReadableText } from '../assert-readable';

test.beforeEach(async ({ page }) => {
  // Assert settled geometry; the sheet's entrance otherwise starts 12px low.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('compact conversation keeps mobile controls readable, reachable and functional', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const payload = btoa(JSON.stringify({ cid: 'synthetic-polish', turnCount: 1 }));
    sessionStorage.setItem('owner-assistant:v1:synthetic-assistant-salon', JSON.stringify({
      ownerRef: 'synthetic-owner',
      conversation: `${payload}.synthetic`,
      messages: [
        { id: 'q', role: 'owner', text: 'Where do I update my salon photos?' },
        {
          id: 'a',
          role: 'assistant',
          turnIndex: 0,
          text: 'Open Photos & Gallery (page_gallery) to update your profile photos.',
          links: [{ key: 'page_gallery', label: 'Photos & Gallery', href: '/en/admin/booking-page?salon=synthetic-assistant-salon&panel=gallery' }],
          checked: [{ tool: 'find_destination', label: 'where things live in Luster' }],
        },
      ],
    }));
  });
  const feedback: Record<string, unknown>[] = [];
  await page.route('**/api/admin/owner-assistant/feedback', async (route) => {
    feedback.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { feedbackId: 'synthetic-feedback', receivedAt: new Date().toISOString() } } });
  });
  await page.goto('/');
  await page.getByTestId('owner-assistant-launcher').click();

  await expect(page.getByText('Open Photos & Gallery to update your profile photos.')).toBeVisible();
  await expect(page.getByTestId('owner-assistant-thread')).not.toContainText('page_gallery');
  await expect(page.getByRole('button', { name: 'Photos & Gallery' })).toBeVisible();

  await expectReadableText(page);

  const geometry = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="owner-assistant-sheet"]')!;
    const thread = document.querySelector('[data-testid="owner-assistant-thread"]')!;
    const composer = document.querySelector('[data-testid="owner-assistant-composer-bar"]')!;
    const controls = document.querySelector('[data-testid="owner-assistant-feedback"]')!;
    return {
      overflow: sheet.scrollWidth > sheet.clientWidth || document.documentElement.scrollWidth > innerWidth,
      threadBottom: thread.getBoundingClientRect().bottom,
      composerTop: composer.getBoundingClientRect().top,
      composerBottom: composer.getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
      feedbackHeight: controls.getBoundingClientRect().height,
      fontSize: getComputedStyle(document.querySelector('textarea')!).fontSize,
      targets: [...sheet.querySelectorAll('button')].map(el => el.getBoundingClientRect().height),
    };
  });

  expect(geometry.overflow).toBe(false);
  expect(geometry.threadBottom).toBeLessThanOrEqual(geometry.composerTop + 1);
  expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.feedbackHeight).toBeLessThanOrEqual(45);
  expect(geometry.fontSize).toBe('16px');
  expect(geometry.targets.every(height => height >= 44)).toBe(true);

  await page.screenshot({ scale: 'css', path: testInfo.outputPath('assistant-conversation.png') });
  await page.getByRole('button', { name: 'Helpful', exact: true }).click();

  await expect(page.getByText('Thanks — noted.')).toBeVisible();
  expect(feedback[0]?.kind).toBe('up');
  expect(JSON.stringify(feedback)).not.toContain('update my salon photos');

  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByLabel('What went wrong?').fill('Synthetic report for a UI check');
  await page.getByRole('button', { name: 'Send report', exact: true }).click();

  await expect(page.getByText('Thanks — your report was sent.')).toBeVisible();
  expect(feedback).toHaveLength(2);

  await page.getByRole('button', { name: 'Photos & Gallery', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/panel=gallery/);
});

test('fresh conversation, multiline draft and reset retain clear mobile controls', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByTestId('owner-assistant-launcher').click();

  await expect(page.getByRole('heading', { name: 'A little help for your salon' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  await page.screenshot({ scale: 'css', path: testInfo.outputPath('assistant-empty.png') });
  const composer = page.getByLabel('Message the assistant');
  await composer.fill('My hours');
  await composer.press('Shift+Enter');
  await composer.press('A');

  await expect(composer).toHaveValue('My hours\nA');

  await page.getByRole('button', { name: 'New conversation', exact: true }).click();

  await expect(composer).toHaveValue('');

  await page.getByRole('button', { name: 'Where do I change my hours?' }).click();

  await expect(page.getByText('Open Hours & Availability to change your working hours.', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Close assistant' }).click();

  await expect(page.getByTestId('owner-assistant-launcher')).toBeFocused();
});

test('long history scrolls beneath fixed chrome without horizontal overflow', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('owner-assistant:v1:synthetic-assistant-salon', JSON.stringify({
      ownerRef: 'synthetic-owner',
      conversation: 'synthetic-history',
      messages: Array.from({ length: 12 }, (_, i) => ({
        id: `message-${i}`,
        role: i % 2 ? 'assistant' : 'owner',
        text: i % 2 ? 'Your service prices keep their starting-price wording. French Tips: $10+. Simple Nail Art: $10 per nail.' : 'Show me the current prices and how to find the service settings.',
      })),
    }));
  });
  await page.goto('/');
  await page.getByTestId('owner-assistant-launcher').click();
  const thread = page.getByTestId('owner-assistant-thread');

  await expect.poll(() => thread.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByLabel('Message the assistant')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close assistant' })).toBeVisible();

  await thread.evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));

  await expect(page.getByTestId('owner-assistant-message').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.screenshot({ scale: 'css', path: testInfo.outputPath('assistant-long-history.png') });
});

test('composer and close control remain reachable in a shortened viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('owner-assistant-launcher').click();
  await page.setViewportSize({ width: 320, height: 420 });
  await page.getByLabel('Message the assistant').fill('Where are my hours?');

  await expect(page.getByRole('button', { name: 'Close assistant' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();

  const box = await page.getByTestId('owner-assistant-composer-bar').boundingBox();

  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(420);

  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByTestId('owner-assistant-message').last()).toContainText('Hours & Availability');
});

test('closed assistant defers its sheet and preserves an unsent draft when reopened', async ({ page }) => {
  const sheets: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/OwnerAssistantSheet.tsx')) {
      sheets.push(request.url());
    }
  });
  await page.goto('/');

  await expect(page.getByTestId('owner-assistant-launcher')).toBeVisible();

  expect(sheets).toEqual([]);

  await page.getByTestId('owner-assistant-launcher').click();
  const composer = page.getByLabel('Message the assistant');
  await composer.fill('Keep this unsent question');

  expect(sheets).toHaveLength(1);

  await page.getByRole('button', { name: 'Close assistant' }).click();

  await expect(page.getByTestId('owner-assistant-launcher')).toBeFocused();

  await page.getByTestId('owner-assistant-launcher').click();

  await expect(composer).toHaveValue('Keep this unsent question');
});

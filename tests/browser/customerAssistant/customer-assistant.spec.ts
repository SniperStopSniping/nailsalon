import path from 'node:path';

import { expect, type Page, test } from '@playwright/test';

const artifactDirectory = path.resolve(__dirname, '../../../artifacts/customer-assistant');

async function installSyntheticAssistantRoutes(page: Page, responseKind: 'answer' | 'proposal' = 'proposal') {
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3130') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (url.pathname === '/api/public/customer-assistant/isla-nail-studio/session' && request.method() === 'POST') {
      await route.fulfill({ json: { conversation: 'synthetic-conversation', salon: { name: 'Isla Nail Studio' } } });
      return;
    }
    if (url.pathname === '/api/public/customer-assistant/isla-nail-studio/prices' && request.method() === 'GET') {
      await route.fulfill({ json: { salon: { name: 'Isla Nail Studio' }, catalogue: { currency: 'CAD', services: [{ id: 'gel-x', name: 'Gel-X Extensions', description: 'Flexible extensions for added length.', price: { baseDisplay: '$85.00', displayLabel: null, range: null } }] } } });
      return;
    }
    if (url.pathname === '/api/public/customer-assistant/isla-nail-studio/chat' && request.method() === 'POST') {
      if (responseKind === 'answer') {
        const selectedReply = request.postDataJSON().message === 'Classic French';
        await route.fulfill({ json: {
          conversation: 'rotated-synthetic-conversation',
          result: { kind: 'answer', message: selectedReply ? 'Got it — classic French tips.' : 'French tips would look lovely. Would you like a classic or detailed design?', options: selectedReply ? [] : ['Classic French', 'Detailed design'] },
        } });
        return;
      }
      await route.fulfill({ json: {
        conversation: 'rotated-synthetic-conversation',
        result: {
          kind: 'proposal',
          proposal: {
            selection: { baseServiceId: 'gel-x', selectedAddOns: [{ addOnId: 'removal', quantity: 1 }, { addOnId: 'french', quantity: 1 }] },
            fingerprint: 'synthetic-menu-fingerprint',
            service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
            addOns: [
              { id: 'removal', name: 'Removal', quantity: 1, priceCents: 2000 },
              { id: 'french', name: 'French', quantity: 1, priceCents: 1500 },
            ],
            currency: 'CAD',
            subtotalCents: 12000,
            durationMinutes: 150,
            expiresAt: '2026-09-18T12:00:00.000Z',
          },
        },
      } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404, json: { error: 'Unknown component-browser fixture endpoint' } });
  });
  return unexpected;
}

async function setMobileViewportAndTextZoom(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });

  expect(await page.evaluate(() => window.innerWidth)).toBe(width);
}

function syntheticProposal(addFrench = false) {
  return {
    selection: { baseServiceId: 'gel-x', selectedAddOns: addFrench ? [{ addOnId: 'french', quantity: 1 }] : [] },
    fingerprint: addFrench ? 'synthetic-gel-x-french' : 'synthetic-gel-x',
    service: { id: 'gel-x', name: 'Gel-X Extensions', priceCents: 8500 },
    addOns: addFrench ? [{ id: 'french', name: 'French tips', quantity: 1, priceCents: 1500 }] : [],
    currency: 'CAD',
    subtotalCents: addFrench ? 10000 : 8500,
    durationMinutes: addFrench ? 120 : 105,
    expiresAt: '2030-01-01T00:00:00.000Z',
  };
}

async function installNaturalConversationRoutes(page: Page) {
  const messages: string[] = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3130') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (url.pathname.endsWith('/session') && request.method() === 'POST') {
      await route.fulfill({ json: { conversation: 'natural-session', salon: { name: 'Isla Nail Studio' } } });
      return;
    }
    if (url.pathname.endsWith('/chat') && request.method() === 'POST') {
      const body = request.postDataJSON() as { message: string };
      messages.push(body.message);
      const result = body.message === 'How much is gel manicure'
        ? { kind: 'answer', message: 'Gel Manicure is $40 and takes about 60 minutes. Would you like to book one?', options: ['Book Gel Manicure'] }
        : body.message === 'What did I just ask?'
          ? { kind: 'answer', message: 'You asked how much a Gel Manicure costs. It is $40.', options: [] }
          : body.message === 'I want medium Gel-X'
            ? { kind: 'proposal', proposal: syntheticProposal() }
            : body.message === 'How long does that take?'
              ? { kind: 'answer', message: 'Medium Gel-X takes about 1 hour 45 minutes.', options: [] }
              : body.message === 'Add French'
                ? { kind: 'proposal', proposal: syntheticProposal(true) }
                : { kind: 'answer', message: 'I can help with that.', options: [] };
      await route.fulfill({ json: { conversation: `natural-${messages.length}`, result } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404, json: { error: 'Unknown component-browser fixture endpoint' } });
  });
  return { messages, unexpected };
}

test('component-browser fixture shows an authoritative proposal at 200% text zoom without horizontal overflow', async ({ page }, testInfo) => {
  const unexpected = await installSyntheticAssistantRoutes(page);
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
    }
  });

  await page.goto('/');
  await setMobileViewportAndTextZoom(page, 390);
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  await expect(page.getByRole('heading', { name: 'AI booking assistant' })).toBeVisible();

  await page.getByLabel('Tell me what you would like').fill('Long Gel-X with French and old extensions from another salon');
  await page.getByRole('button', { name: 'Send' }).tap();

  const proposal = page.getByRole('region', { name: 'Your appointment package' });

  await expect(proposal).toBeVisible();
  await expect(page.getByText('Gel-X Extensions')).toBeVisible();
  await expect(page.getByText('Removal')).toBeVisible();
  await expect(page.getByText('French', { exact: true })).toBeVisible();
  await expect(page.getByText('$120.00')).toBeVisible();
  await expect(page.getByText('2h 30m')).toBeVisible();
  await expect(page.getByRole('button', { name: /confirm booking/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue manually' })).toBeVisible();

  for (const name of ['Close assistant', 'Send', 'Continue manually']) {
    const box = await page.getByRole('button', { name }).boundingBox();

    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await expect(page.getByRole('button', { name: 'Continue manually' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Close assistant' })).toBeInViewport();
  await expect(page.getByText('$120.00')).toBeInViewport();

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-conversation-proposal-390px-200zoom.png`), fullPage: true });

  await page.addStyleTag({ content: 'html { font-size: 100%; }' });

  await expect(page.getByText('$120.00')).toBeInViewport();

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-conversation-proposal-390px-100zoom.png`), fullPage: true });

  expect(unexpected).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('component-browser fixture shows a bounded customer/assistant transcript with optional quick replies', async ({ page }, testInfo) => {
  const unexpected = await installSyntheticAssistantRoutes(page, 'answer');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();
  await page.getByLabel('Tell me what you would like').fill('I would like a gel manicure with French tips');
  await page.getByRole('button', { name: 'Send' }).tap();

  await expect(page.getByLabel('You', { exact: true })).toHaveText('I would like a gel manicure with French tips');
  await expect(page.getByLabel('Assistant', { exact: true }).last()).toContainText('French tips would look lovely.');
  await expect(page.getByRole('button', { name: 'Classic French' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Detailed design' })).toBeVisible();

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-conversation-transcript-390px-100zoom.png`), fullPage: true });

  await page.getByRole('button', { name: 'Classic French' }).tap();

  await expect(page.getByLabel('You chose: Classic French', { exact: true })).toBeVisible();
  await expect(page.getByLabel('You', { exact: true })).toHaveText('I would like a gel manicure with French tips');
  await expect(page.getByText('Got it — classic French tips.')).toBeVisible();

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-selected-quick-reply-390px.png`), fullPage: true });

  expect(unexpected).toEqual([]);
});

test('welcome actions use deterministic booking, prices, and consultation paths without chat requests', async ({ page }) => {
  const unexpected = await installSyntheticAssistantRoutes(page, 'answer');
  const chatRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/chat')) {
      chatRequests.push(request.postData() ?? '');
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  await page.getByRole('button', { name: 'See prices' }).tap();

  await expect(page.getByRole('region', { name: 'Current service prices' })).toContainText('Gel-X Extensions');
  await expect(page.getByRole('region', { name: 'Current service prices' })).toContainText('$85.00');
  expect(chatRequests).toEqual([]);

  await page.getByRole('button', { name: 'Start a new conversation' }).tap();
  await page.getByRole('button', { name: 'Help me choose', exact: true }).tap();

  await expect(page.getByText(/What are you hoping for today/)).toBeVisible();
  await expect(page.getByLabel('Tell me what you would like')).toBeFocused();
  expect(chatRequests).toEqual([]);

  await page.getByRole('button', { name: 'Start a new conversation' }).tap();
  await page.getByRole('button', { name: 'Book an appointment' }).tap();

  await expect(page).toHaveURL(/\/en\/isla-nail-studio\/book\/service/);
  expect(chatRequests).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('component-browser fixture preserves the manual escape above the booking footer at 320px and 200% text zoom', async ({ page }, testInfo) => {
  const unexpected = await installSyntheticAssistantRoutes(page);
  await page.goto('/');
  await setMobileViewportAndTextZoom(page, 320);
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  // Match the public service page's fixed z-60 footer, which is outside the
  // assistant's portal. Visibility/viewport assertions alone miss occlusion.
  await page.evaluate(() => {
    const footer = document.createElement('div');
    footer.dataset.testid = 'public-booking-footer';
    footer.textContent = 'Appointment subtotal · Continue';
    footer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:90px;z-index:60;background:white';
    document.body.append(footer);
  });
  const manual = page.getByRole('button', { name: 'Continue manually' });

  await expect(manual).toBeVisible();
  expect(await manual.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);

  const manualBox = await manual.boundingBox();

  expect(manualBox?.height).toBeGreaterThanOrEqual(44);
  await expect(manual).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-conversation-manual-320px-200zoom.png`), fullPage: true });

  await manual.tap();

  await expect(page.getByRole('heading', { name: 'AI booking assistant' })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('branded welcome, resume, start over, priced length choice, and keyboard stay usable at 320px/200%', async ({ page }, testInfo) => {
  let sessions = 0;
  const messages: string[] = [];
  const unexpected: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3130') {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    if (url.pathname.endsWith('/session') && request.method() === 'POST') {
      sessions += 1;
      await route.fulfill({ json: { conversation: `welcome-${sessions}`, salon: { name: 'A Very Long Synthetic Nail Studio Name' } } });
      return;
    }
    if (url.pathname.endsWith('/chat') && request.method() === 'POST') {
      const body = request.postDataJSON() as { message: string };
      messages.push(body.message);
      const result = body.message === 'Extensions'
        ? { kind: 'clarification', question: 'length', options: ['Medium'], choices: [{ label: 'Medium', message: 'Medium', deltaCents: 1000, subtotalCents: 8000, durationMinutes: 100, currency: 'CAD' }] }
        : { kind: 'answer', message: 'Perfect — medium it is 💅', options: [] };
      await route.fulfill({ json: { conversation: `turn-${messages.length}`, result } });
      return;
    }
    unexpected.push(`${request.method()} ${url.pathname}`);
    await route.fulfill({ status: 404 });
  });

  await page.goto('/');
  await setMobileViewportAndTextZoom(page, 320);
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  await expect(page.getByText(/Welcome to A Very Long Synthetic Nail Studio Name/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book an appointment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'See prices' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Help me choose', exact: true })).toBeVisible();

  const transcript = page.getByTestId('customer-assistant-transcript');
  const welcome = page.getByText(/Welcome to A Very Long Synthetic Nail Studio Name/);

  expect(await transcript.evaluate(element => element.scrollTop)).toBe(0);
  expect(await welcome.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(
    await page.getByRole('button', { name: 'Book an appointment' }).evaluate(element => element.getBoundingClientRect().top),
  );
  expect(await welcome.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
    await transcript.evaluate(element => element.getBoundingClientRect().bottom),
  );
  expect(sessions).toBe(1);

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-branded-welcome-320px-200zoom.png`), fullPage: true });

  const input = page.getByLabel('Tell me what you would like');
  await input.focus();

  await expect(input).toBeFocused();

  await input.fill('Extensions');

  await expect(input).toHaveValue('Extensions');

  // iOS Safari's virtual keyboard does not expose sequential Tab traversal;
  // retain the Chromium focus-order assertion while proving WebKit accepts
  // keyboard text before the customer taps the visible action.
  if (testInfo.project.name === 'mobile-chromium') {
    await page.keyboard.press('Tab');

    await expect(page.getByRole('button', { name: 'Send' })).toBeFocused();
  }

  await page.getByLabel('Close assistant').tap();
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  await expect(page.getByText(/Welcome to A Very Long Synthetic Nail Studio Name/)).toBeVisible();
  expect(sessions).toBe(1);

  // Unsent composer text is not a committed conversation selection.
  await input.fill('Extensions');
  await page.getByRole('button', { name: 'Send' }).tap();
  const medium = page.getByRole('button', { name: /Medium.*\+\$10\.00.*1h 40m/i });

  await expect(medium).toBeVisible();

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-priced-choice-320px-200zoom.png`), fullPage: true });

  await medium.tap();

  await expect.poll(() => messages.at(-1)).toBe('Medium');

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-branded-welcome-priced-choice-320px-200zoom.png`), fullPage: true });

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Start a new conversation' }).tap();

  await expect.poll(() => sessions).toBe(2);
  await expect(page.getByText(/Welcome to A Very Long Synthetic Nail Studio Name/)).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('natural text remains primary through price recall, informational detours, and close/reopen at 320px/200%', async ({ page }, testInfo) => {
  const { messages, unexpected } = await installNaturalConversationRoutes(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(() => localStorage.setItem('booking_state:v2:isla-nail-studio', JSON.stringify({
    technicianId: 'manual-tech',
    technicianSelectionSource: 'explicit',
    serviceIds: ['manual-service'],
    baseServiceId: 'manual-service',
    selectedAddOns: [],
    locationId: null,
  })));
  await page.goto('/');
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });

  expect(await page.evaluate(() => window.innerWidth)).toBe(320);

  await page.getByRole('button', { name: 'Help me choose & book' }).tap();
  const input = page.getByLabel('Tell me what you would like');
  await input.focus();
  await page.keyboard.type('How much is gel manicure');
  await page.keyboard.press('Enter');

  await expect(page.getByText('Gel Manicure is $40 and takes about 60 minutes. Would you like to book one?')).toBeVisible();

  const optionalChip = page.getByRole('button', { name: 'Book Gel Manicure' });

  await expect(optionalChip).toBeVisible();
  expect((await optionalChip.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(input).toBeFocused();

  // The customer can ignore a chip and keep talking naturally.
  await page.keyboard.type('What did I just ask?');
  await page.keyboard.press('Enter');

  await expect(page.getByText('You asked how much a Gel Manicure costs. It is $40.')).toBeVisible();
  await expect(input).toBeFocused();

  await page.getByLabel('Close assistant').tap();
  await page.getByRole('button', { name: 'Help me choose & book' }).tap();

  await expect(page.getByText('You asked how much a Gel Manicure costs. It is $40.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('booking_state:v2:isla-nail-studio'))).toContain('manual-service');

  await input.fill('I want medium Gel-X');
  await page.getByRole('button', { name: 'Send' }).tap();

  await expect(page.getByRole('region', { name: 'Your appointment package' })).toContainText('Gel-X Extensions');

  await input.fill('How long does that take?');
  await page.getByRole('button', { name: 'Send' }).tap();

  await expect(page.getByText('Medium Gel-X takes about 1 hour 45 minutes.')).toBeVisible();

  await input.fill('Add French');
  await page.getByRole('button', { name: 'Send' }).tap();

  await expect(page.getByRole('region', { name: 'Your appointment package' })).toContainText('French tips');

  const subtotal = page.getByText('$100.00');
  const proposalCard = page.getByTestId('customer-assistant-proposal');
  const transcript = page.getByTestId('customer-assistant-transcript');

  await expect(subtotal).toBeVisible();

  const [subtotalBox, proposalBox] = await Promise.all([
    subtotal.boundingBox(),
    proposalCard.boundingBox(),
  ]);

  expect(subtotalBox).not.toBeNull();
  expect(proposalBox).not.toBeNull();
  expect(subtotalBox!.x).toBeGreaterThanOrEqual(proposalBox!.x);
  expect(subtotalBox!.x + subtotalBox!.width).toBeLessThanOrEqual(proposalBox!.x + proposalBox!.width);
  expect(await proposalCard.evaluate(card => card.scrollWidth <= card.clientWidth)).toBe(true);
  expect(await transcript.evaluate(region => region.clientHeight)).toBeGreaterThan(150);

  expect(messages).toEqual([
    'How much is gel manicure',
    'What did I just ask?',
    'I want medium Gel-X',
    'How long does that take?',
    'Add French',
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.screenshot({ path: path.join(artifactDirectory, `${testInfo.project.name}-natural-conversation-320px-200zoom.png`), fullPage: true });

  expect(unexpected).toEqual([]);
});

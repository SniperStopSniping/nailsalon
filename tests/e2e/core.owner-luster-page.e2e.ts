import { expect, test } from '@playwright/test';

import { appPath, authStatePaths, e2eConfig } from './support/config';

test.use({
  storageState: authStatePaths.superAdmin,
  viewport: { width: 375, height: 812 },
});

test('luster page keeps the approved hierarchy, fits mobile, and restores on Back', async ({
  page,
}) => {
  test.slow();

  const start = await page.request.get(
    `/api/super-admin/organizations?page=1&pageSize=20&q=${encodeURIComponent(e2eConfig.salonSlug)}`,
  );
  const organizations = await start.json();
  const salon = organizations.items?.find(
    (item: { slug?: string }) => item.slug === e2eConfig.salonSlug,
  );

  expect(salon?.id, 'The configured E2E salon must exist.').toBeTruthy();

  const impersonation = await page.request.post('/api/super-admin/impersonate', {
    data: { salonId: salon.id },
  });

  expect(impersonation.ok(), await impersonation.text()).toBe(true);

  try {
    await page.goto(
      `${appPath('/admin')}?salon=${encodeURIComponent(e2eConfig.salonSlug)}`,
      { waitUntil: 'domcontentloaded' },
    );

    await page.getByTestId('owner-nav-more').click();

    await expect(page.getByTestId('owner-more-workspace')).toBeVisible();

    // Luster is the one app tile that navigates to its own route.
    await page.getByTestId('admin-app-tile-luster').click();

    await expect(page).toHaveURL(/\/admin\/luster/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Luster for Nail Artists' }),
    ).toBeVisible();

    // Approved order: Promotions → Shop → Learn.
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Promotions',
      'Shop',
      'Learn',
    ]);

    // Integrations wayfinding belongs in More → Integrations only.
    await expect(page.getByText(/google calendar/i)).toHaveCount(0);
    await expect(page.getByText(/Integrations moved to More/i)).toHaveCount(0);

    // Mobile layout must not scroll sideways at 375px.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    expect(
      overflow.scrollWidth,
      `Horizontal overflow at 375px: ${overflow.scrollWidth} > ${overflow.clientWidth}`,
    ).toBeLessThanOrEqual(overflow.clientWidth);

    // Every outbound link stays on the approved brand domain and opens safely.
    const links = await page.locator('main a[href]').evaluateAll(nodes =>
      nodes.map(node => ({
        href: node.getAttribute('href') || '',
        rel: node.getAttribute('rel') || '',
        target: node.getAttribute('target') || '',
      })),
    );

    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      expect(link.href).toMatch(/^https:\/\/lusterstudio\.ca\//);
      expect(link.href).not.toMatch(/luster\.com/);
      expect(link.rel).toContain('noopener');
      expect(link.rel).toContain('noreferrer');
      expect(link.target).toBe('_blank');
    }

    // Browser Back leaves Luster and restores the owner dashboard with the
    // salon context intact. It lands on Today rather than More because the
    // workspace tab is component state, not a URL param — pre-existing
    // behaviour of the dashboard, unrelated to the Luster hierarchy.
    await page.goBack();

    await expect(page).not.toHaveURL(/\/admin\/luster/);
    await expect(page).toHaveURL(
      new RegExp(`salon=${encodeURIComponent(e2eConfig.salonSlug)}`),
    );
    await expect(page.getByTestId('owner-today-workspace')).toBeVisible();
    await expect(page.getByTestId('owner-nav-more')).toBeVisible();
  } finally {
    await page.request.delete('/api/super-admin/impersonate');
  }
});

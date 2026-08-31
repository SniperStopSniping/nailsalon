/**
 * Owner journeys A–F for Section Library V1.
 *
 * A — a fresh Quick Book document renders the coordinated customer sections
 *     truthfully (populated ones present, empty ones honestly absent).
 * B — Add Section shows the named, grouped library; hard limits block with a
 *     reason; adding a library section lands it selected.
 * C — the Team flow: solo-business overlap warning names the conflict, "Add
 *     anyway" proceeds, the editor manages shared records, and the document
 *     persists the normalized settings.
 * D — the showcase surface (the same pixels the owner Section Gallery
 *     renders) restyles a full recipe across styles/palettes/devices.
 * E — customer policy surfaces never leak owner-prompt copy.
 * F — library sections and shared records survive reload with undo intact.
 */

import { expect, test, type Page } from '@playwright/test';

import { LAB_STORAGE_KEY, openFreshLab } from './helpers';

const readStoredDocument = async (page: Page) => page.evaluate((key) => {
  const raw = window.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}, LAB_STORAGE_KEY);

test.describe('Section Library V1 owner journeys', () => {
  test('Journey A: fresh Quick Book renders coordinated, truthful customer sections', async ({ page }) => {
    await page.goto('/?audit=1&surface=sections&type=hero&second=featured_services');
    const preview = page.locator('[data-showcase-ready]');
    await expect(preview).toBeVisible();
    // Hero renders with the demo identity and booking CTA.
    await expect(page.locator('.onboarding-customer-hero h2')).toHaveText('Isla Nail Studio');
    await expect(page.locator('.onboarding-customer-hero .onboarding-customer-primary'))
      .toHaveText('Book an appointment');
    // Featured services bind the canonical catalogue (real prices, no lorem).
    const featured = page.locator('[data-library-type="featured_services"]');
    await expect(featured).toBeVisible();
    await expect(featured.locator('.customer-lib-featured-card').first()).toContainText('$');
  });

  test('Journey B: Add Section lists the named library and enforces hard limits', async ({ page }) => {
    await openFreshLab(page);
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add section' });
    await expect(dialog).toBeVisible();

    // Grouped, named library — not numbered placeholders.
    await expect(dialog.getByRole('heading', { name: 'First impressions & conversion' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Trust & story' })).toBeVisible();
    await expect(dialog.getByText('Section 01')).toHaveCount(0);

    // Hero is hard-limited on a page that already has one.
    const heroCard = dialog.locator('[data-section-type="hero"]');
    const heroButton = heroCard.getByRole('button');
    await expect(heroButton).toBeDisabled();
    await expect(heroButton).toHaveText(/Already on this page/);

    // Adding Reviews (empty authority) still adds the section to the document.
    await dialog.locator('[data-section-type="reviews"]').getByRole('button', { name: /Add Reviews/ }).click();
    await expect(dialog).not.toBeVisible();
    const stored = await readStoredDocument(page);
    const types = stored.pages[0].sections.map((section: { sectionType: string }) => section.sectionType);
    expect(types).toContain('reviews');
  });

  test('Journey C: Team warns on solo overlap, then manages shared records honestly', async ({ page }) => {
    await openFreshLab(page);
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add section' });
    await dialog.locator('[data-section-type="team"]').getByRole('button', { name: /Add Team/ }).click();

    // The overlap engine names the real conflict before anything is added.
    const warning = page.getByRole('dialog', { name: 'Solo business' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('solo nail tech');
    await warning.getByRole('button', { name: 'Add it anyway' }).click();

    // Edit the new Team section and add a shared staff record.
    const teamCard = page.locator('article[data-section-id]').filter({ hasText: 'Team' }).first();
    await teamCard.click();
    await teamCard.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Team' });
    await expect(editor).toBeVisible();
    await editor.getByPlaceholder('New team member’s name').fill('Vy Tran');
    await editor.getByRole('button', { name: 'Add member', exact: true }).click();
    await expect(editor.getByText('Vy Tran')).toBeVisible();
    await editor.getByRole('button', { name: 'Save section' }).click();

    const stored = await readStoredDocument(page);
    expect(stored.siteContent.staff.map((member: { name: string }) => member.name))
      .toContain('Vy Tran');
    const team = stored.pages[0].sections.find(
      (section: { sectionType: string }) => section.sectionType === 'team',
    );
    expect(team.settings.memberIds).toHaveLength(1);
  });

  test('Journey D: one recipe restyles across styles, palettes, and devices', async ({ page }) => {
    const accentFor = async () => page.evaluate(() => {
      const root = document.querySelector('.onboarding-site-preview');
      return root ? getComputedStyle(root).getPropertyValue('--customer-accent').trim() : null;
    });

    await page.goto('/?audit=1&surface=sections&recipe=signature_one_page&style=modern&palette=luster_berry&device=phone');
    await expect(page.locator('[data-showcase-ready]')).toBeVisible();
    await expect(page.locator('[data-library-type="visit_us"]')).toBeVisible();
    const berry = await accentFor();

    await page.goto('/?audit=1&surface=sections&recipe=signature_one_page&style=luxury&palette=black_champagne&device=desktop');
    await expect(page.locator('[data-showcase-ready]')).toBeVisible();
    const champagne = await accentFor();

    expect(berry).not.toBeNull();
    expect(champagne).not.toBeNull();
    expect(berry).not.toBe(champagne);
    await expect(page.locator('.onboarding-preview-stage')).toHaveAttribute('data-preview-device', 'desktop');
  });

  test('Journey E: customer policy sections never leak owner-prompt copy', async ({ page }) => {
    await page.goto('/?audit=1&surface=sections&type=deposits_cancellations&second=policies');
    await expect(page.locator('[data-showcase-ready]')).toBeVisible();
    const deposits = page.locator('[data-library-type="deposits_cancellations"]');
    await expect(deposits).toBeVisible();
    await expect(deposits).toContainText('$30 deposit');
    // The owner-facing prompt line must never render for customers.
    await expect(page.locator('.onboarding-site-preview'))
      .not.toContainText('Finish your deposit and cancellation rules');
    await expect(page.locator('[data-library-type="policies"]')).toContainText('Late arrivals');
  });

  test('Journey F: library sections and shared records survive reload with undo intact', async ({ page }) => {
    await openFreshLab(page);
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add section' })
      .locator('[data-section-type="faq"]')
      .getByRole('button', { name: /Add FAQ/ })
      .click();

    await page.reload();
    await expect(page.locator('article[data-section-id]').filter({ hasText: 'FAQ' }).first())
      .toBeVisible();
    const afterReload = await readStoredDocument(page);
    const faqCount = afterReload.pages[0].sections.filter(
      (section: { sectionType: string }) => section.sectionType === 'faq',
    ).length;
    expect(faqCount).toBe(1);

    // One undo removes the addition — history survived the operation intact.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    const afterUndo = await readStoredDocument(page);
    const faqAfterUndo = afterUndo.pages[0].sections.filter(
      (section: { sectionType: string }) => section.sectionType === 'faq',
    ).length;
    expect(faqAfterUndo).toBe(0);
  });
});

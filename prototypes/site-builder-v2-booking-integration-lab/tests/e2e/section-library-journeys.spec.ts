/**
 * Owner journeys A–F for Section Library V1.
 *
 * A — a fresh Quick Book document renders the coordinated customer sections
 *     truthfully (populated ones present, empty ones honestly absent).
 * B — Add Section shows the named, grouped library; hard limits block with a
 *     reason; adding a library section lands it selected.
 * C — overlap + records: a duplicate add is warned about by name with a real
 *     "Add anyway" path, and the Team editor manages shared siteContent
 *     records that the document then persists in normalized form.
 * D — the showcase surface (the same pixels the owner Section Gallery
 *     renders) restyles a full recipe across styles/palettes/devices.
 * E — customer policy surfaces never leak owner-prompt copy.
 * F — a library section survives reload (with history honestly reset), and
 *     one Undo reverses an in-session add.
 */

import { expect, test, type Page } from '@playwright/test';

import { chooseStarter, LAB_STORAGE_KEY, openFreshLab, waitForSaved } from './helpers';

/** Opens the Add Section dialog from whichever affordance is on screen. */
const openAddSection = async (page: Page) => {
  const insertion = page.locator('button.final-insertion:visible').last();
  if (await insertion.isVisible()) {
    await insertion.click();
  } else {
    await page.getByRole('button', { name: 'Add section', exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: 'Add section' });
  await expect(dialog).toBeVisible();
  return dialog;
};

const startBuilder = async (page: Page) => {
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
};

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
    await startBuilder(page);
    const dialog = await openAddSection(page);

    // Grouped, named library — not numbered placeholders.
    await expect(dialog.getByRole('heading', { name: 'First impressions & conversion' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Trust & story' })).toBeVisible();
    await expect(dialog.getByText('Section 01')).toHaveCount(0);

    // Hero is hard-limited on a page that already has one. The available
    // action explains the conflict and takes the owner to the existing Hero;
    // it never creates a second engine/singleton section.
    const heroCard = dialog.locator('[data-section-type="hero"]');
    const heroButton = heroCard.getByRole('button');
    await expect(heroButton).toBeEnabled();
    await expect(heroButton).toHaveText('Go to Hero');
    await expect(heroButton).toHaveAttribute('aria-haspopup', 'dialog');
    await heroButton.click();
    const blocker = page.getByRole('dialog', { name: 'Hero is already on Home' });
    await expect(blocker).toContainText('only once per page');
    await blocker.getByRole('button', { name: 'Go to Hero' }).click();
    await expect(blocker).not.toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Salon intro on Home' })
      .locator('.section-card__select-surface')).toHaveAttribute('aria-pressed', 'true');

    // Adding Reviews (empty authority) still adds the section to the document.
    const reopenedDialog = await openAddSection(page);
    await reopenedDialog.locator('[data-section-type="reviews"]')
      .getByRole('button', { name: /Add Reviews/ })
      .click();
    await expect(reopenedDialog).not.toBeVisible();
    await waitForSaved(page);
    const stored = await readStoredDocument(page);
    const types = stored.pages[0].sections.map((section: { sectionType: string }) => section.sectionType);
    expect(types).toContain('reviews');
  });

  test('Journey C: duplicate adds are warned by name, and Team manages shared records', async ({ page }) => {
    await startBuilder(page);

    // First Team add is unremarkable — no warning, no interruption.
    const firstAdd = await openAddSection(page);
    await firstAdd.locator('[data-section-type="team"]').getByRole('button', { name: /Add Team/ }).click();
    await expect(firstAdd).not.toBeVisible();
    await waitForSaved(page);

    // A second Team add names the existing one and offers a real way through.
    const secondAdd = await openAddSection(page);
    await secondAdd.locator('[data-section-type="team"]').getByRole('button', { name: /Add Team/ }).click();
    const warning = page.getByRole('dialog', { name: 'Team is already on your site' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Home');
    await warning.getByRole('button', { name: 'Cancel' }).click();
    await expect(warning).not.toBeVisible();
    // Cancelling the resolution closes the modal flow and returns to Builder
    // without adding another Team section.
    await expect(secondAdd).not.toBeVisible();
    await waitForSaved(page);
    const afterCancel = await readStoredDocument(page);
    expect(afterCancel.pages[0].sections.filter(
      (section: { sectionType: string }) => section.sectionType === 'team',
    )).toHaveLength(1);

    // Edit the Team section and add a shared staff record. The Builder shows
    // its edit affordance in the card toolbar or the selected-section toolbar
    // depending on viewport, exactly as the Booking flows do.
    const teamCard = page.locator('[data-section-label="Team"]').first();
    await teamCard.scrollIntoViewIfNeeded();
    // Adding a section already selects it; clicking the card would toggle the
    // selection off, so only select when the owner controls are not showing.
    const toolbar = page.getByRole('complementary', { name: 'Team owner controls' });
    if (!(await toolbar.isVisible().catch(() => false))) {
      await teamCard.click();
    }
    await expect(toolbar).toBeVisible();
    // The toolbar parks in an "away" state while the selected card is out of
    // view; its return control brings the card and its controls back.
    const returnToSection = toolbar.getByRole('button', { name: 'Back to Team' });
    if (await returnToSection.isVisible().catch(() => false)) {
      await returnToSection.click();
    }
    const selectedEdit = toolbar.getByRole('button', { name: 'Edit', exact: true });
    await expect(selectedEdit).toBeVisible();
    await selectedEdit.click();
    const editor = page.getByRole('dialog', { name: 'Edit Team' });
    await expect(editor).toBeVisible();
    await editor.getByPlaceholder('New team member’s name').fill('Vy Tran');
    await editor.getByRole('button', { name: 'Add member', exact: true }).click();
    // The new record appears with its own include control, ticked on.
    await expect(editor.getByRole('checkbox', { name: 'Show Vy Tran in this section' }))
      .toBeChecked();
    await editor.getByRole('button', { name: 'Save section' }).click();
    await waitForSaved(page);

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

  test('Journey F: a library section survives reload and one Undo reverses an add', async ({ page }) => {
    await startBuilder(page);
    const dialog = await openAddSection(page);
    await dialog.locator('[data-section-type="faq"]')
      .getByRole('button', { name: /Add FAQ/ })
      .click();
    await waitForSaved(page);

    // One Undo reverses the add within the session.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await waitForSaved(page);
    const afterUndo = await readStoredDocument(page);
    expect(afterUndo.pages[0].sections.filter(
      (section: { sectionType: string }) => section.sectionType === 'faq',
    )).toHaveLength(0);

    // Redo, then reload: the section persists and history honestly resets.
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await waitForSaved(page);
    await page.reload();
    await expect(page.locator('[data-section-label="FAQ"]').first()).toBeVisible();
    const afterReload = await readStoredDocument(page);
    expect(afterReload.pages[0].sections.filter(
      (section: { sectionType: string }) => section.sectionType === 'faq',
    )).toHaveLength(1);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  });

  for (const viewport of [
    { height: 568, label: 'narrow portrait', width: 320 },
    { height: 844, label: 'standard portrait', width: 390 },
    { height: 390, label: 'phone landscape', width: 844 },
  ]) {
    test(`mobile service details stay in the visible viewport at ${viewport.label}`, async ({ page }) => {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await page.goto('/?audit=1&surface=sections&recipe=signature_one_page&device=phone&full=1');

      await expect(page.locator('[data-showcase-ready]')).toBeVisible();

      const service = page.getByRole('button', {
        name: /View details for Gel Manicure, 1 hr, \$50/,
      }).first();
      await service.scrollIntoViewIfNeeded();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await service.click();

      const detail = page.getByTestId('service-detail-dialog');
      const backdrop = page.getByTestId('service-detail-dialog-backdrop');

      await expect(detail).toBeVisible();

      await expect(detail.getByRole('button', { name: 'Close service details' })).toBeFocused();

      const [detailBox, backdropBox] = await Promise.all([
        detail.boundingBox(),
        backdrop.boundingBox(),
      ]);

      expect(detailBox).not.toBeNull();

      expect(backdropBox).not.toBeNull();

      expect(detailBox!.y).toBeGreaterThanOrEqual(0);

      expect(detailBox!.y + detailBox!.height).toBeLessThanOrEqual(viewport.height + 1);

      expect(backdropBox!.y).toBe(0);

      expect(Math.abs(backdropBox!.height - viewport.height)).toBeLessThanOrEqual(1);

      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      await detail.getByRole('button', { name: 'Close service details' }).click();

      await expect(detail).toHaveCount(0);

      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

      await page.evaluate(() => new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      }));
      await service.focus();

      await expect(service).toBeFocused();

      const keyboardScrollBefore = await page.evaluate(() => window.scrollY);
      await page.keyboard.press('Enter');

      await expect(detail).toBeVisible();

      await expect(detail.getByRole('button', { name: 'Close service details' })).toBeFocused();
      await page.keyboard.press('Escape');

      await expect(detail).toHaveCount(0);

      await expect(service).toBeFocused();

      await expect.poll(() => page.evaluate(() => window.scrollY))
        .toBe(keyboardScrollBefore);
    });
  }
});

import { expect, type Locator, type Page, test } from '@playwright/test';

import { MOVE_COMPLETION_SHIELD_DURATION_MS } from '../../src/ui/move-completion-shield';
import {
  chooseStarter,
  expectNoDocumentOverflow,
  openBookingSettings,
  openFreshLab,
  openMoveForBooking,
  openPagesAndStructure,
  selectBooking,
  selectPageFromStructure,
  type StarterName,
  startRuntimeMonitor,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let runtimeMonitor: ReturnType<typeof startRuntimeMonitor>;

test.beforeEach(async ({ page }) => {
  runtimeMonitor = startRuntimeMonitor(page);
});

test.afterEach(async () => {
  runtimeMonitor.assertClean();
  runtimeMonitor.stop();
});

const MOVE_VIEWPORTS = [
  { height: 500, width: 320 },
  { height: 600, width: 320 },
  { height: 500, width: 375 },
  { height: 600, width: 375 },
  { height: 844, width: 390 },
  { height: 600, width: 430 },
] as const;

const SETTINGS_VIEWPORTS = [
  { height: 800, width: 920 },
  { height: 800, width: 1024 },
  { height: 800, width: 1179 },
  { height: 800, width: 1180 },
  { height: 800, width: 1280 },
  { height: 768, width: 1440 },
  { height: 900, width: 1440 },
] as const;

const INITIAL_SCROLL_VIEWPORTS = [
  { height: 800, width: 920 },
  { height: 800, width: 1180 },
  { height: 768, width: 1440 },
  { height: 900, width: 1440 },
] as const;

const STARTERS = [
  'Quick Book',
  'One-page website',
  'Multi-page website',
] as const satisfies readonly StarterName[];

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function settlePaint(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  }));
}

async function selectPlaceholder(
  page: Page,
  sectionName: string,
): Promise<void> {
  const card = page.getByRole('listitem', {
    name: `${sectionName} on Home`,
  });
  await card.scrollIntoViewIfNeeded();
  if (!(await card.evaluate(element => element.classList.contains('is-selected')))) {
    await card.locator('.section-card__select-surface').click();
  }

  await expect(card).toHaveClass(/is-selected/);
}

async function openMoveForPlaceholder(
  page: Page,
  sectionName: string,
): Promise<Locator> {
  await selectPlaceholder(page, sectionName);
  await page
    .getByRole('group', { name: `${sectionName} actions` })
    .getByRole('button', { name: 'Move', exact: true })
    .click();
  const move = page.getByRole('dialog', { name: `Move ${sectionName}` });

  await expect(move).toBeVisible();

  return move;
}

async function expectMoveGeometry(
  page: Page,
  move: Locator,
  title: string,
): Promise<void> {
  const header = move.locator('.dialog-header');
  const close = header.getByRole('button', { name: `Close ${title}` });
  const footer = move.getByRole('group', { name: 'Move actions' });
  const scrollRegion = move.locator('.section-move-panel__scroll');

  await expect(header.getByRole('heading', { name: title, exact: true }))
    .toBeVisible();
  await expect(header.locator('p')).toBeVisible();
  await expect(close).toBeVisible();
  await expect(footer.getByRole('button', { name: 'Cancel', exact: true }))
    .toBeVisible();
  await expect(footer.getByRole('button', { name: 'Done', exact: true }))
    .toBeVisible();

  const geometry = await move.evaluate((sheet) => {
    const headerElement = sheet.querySelector<HTMLElement>('.dialog-header');
    const copy = headerElement?.querySelector<HTMLElement>(':scope > div');
    const subtitle = headerElement?.querySelector<HTMLElement>('p');
    const closeButton = headerElement?.querySelector<HTMLElement>('.icon-button');
    const panel = sheet.getBoundingClientRect();
    const headerBounds = headerElement?.getBoundingClientRect();
    const closeBounds = closeButton?.getBoundingClientRect();
    const style = copy ? window.getComputedStyle(copy) : null;
    const subtitleStyle = subtitle ? window.getComputedStyle(subtitle) : null;
    const hitPoints = closeBounds && closeButton
      ? [
          [closeBounds.left + closeBounds.width / 2, closeBounds.top + closeBounds.height / 2],
          [closeBounds.left + 9, closeBounds.top + 9],
          [closeBounds.right - 9, closeBounds.top + 9],
          [closeBounds.left + 9, closeBounds.bottom - 9],
          [closeBounds.right - 9, closeBounds.bottom - 9],
        ].map(([x, y]) => {
          const hit = document.elementFromPoint(x ?? 0, y ?? 0);
          return hit === closeButton || Boolean(hit && closeButton.contains(hit));
        })
      : [];
    return {
      close: closeBounds && {
        bottom: closeBounds.bottom,
        height: closeBounds.height,
        left: closeBounds.left,
        right: closeBounds.right,
        top: closeBounds.top,
        width: closeBounds.width,
      },
      copyMinWidth: style?.minWidth,
      headerClientWidth: headerElement?.clientWidth ?? -1,
      headerScrollWidth: headerElement?.scrollWidth ?? -1,
      headerBounds: headerBounds && {
        left: headerBounds.left,
        right: headerBounds.right,
      },
      hitPoints,
      panel: {
        clientWidth: sheet.clientWidth,
        left: panel.left,
        right: panel.right,
        scrollWidth: sheet.scrollWidth,
      },
      subtitle: subtitle && {
        clientWidth: subtitle.clientWidth,
        scrollWidth: subtitle.scrollWidth,
        whiteSpace: subtitleStyle?.whiteSpace,
        wordBreak: subtitleStyle?.wordBreak,
      },
    };
  });

  expect(geometry.panel.scrollWidth).toBeLessThanOrEqual(geometry.panel.clientWidth);
  expect(geometry.headerScrollWidth).toBeLessThanOrEqual(geometry.headerClientWidth);
  expect(geometry.copyMinWidth).toBe('0px');
  expect(geometry.close).not.toBeNull();
  expect(geometry.headerBounds).not.toBeNull();

  if (geometry.close && geometry.headerBounds) {
    expect(geometry.close.left).toBeGreaterThanOrEqual(geometry.headerBounds.left);
    expect(geometry.close.right).toBeLessThanOrEqual(geometry.headerBounds.right);
    expect(geometry.close.left).toBeGreaterThanOrEqual(geometry.panel.left);
    expect(geometry.close.right).toBeLessThanOrEqual(geometry.panel.right);
    expect(geometry.close.height).toBeGreaterThanOrEqual(44);
    expect(geometry.close.width).toBeGreaterThanOrEqual(44);
  }

  expect(geometry.hitPoints).toEqual([true, true, true, true, true]);
  expect(geometry.subtitle?.scrollWidth)
    .toBeLessThanOrEqual(geometry.subtitle?.clientWidth ?? -1);
  expect(geometry.subtitle?.whiteSpace).toBe('normal');
  expect(geometry.subtitle?.wordBreak).toBe('normal');

  await scrollRegion.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(footer).toBeVisible();

  const footerGeometry = await footer.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const panel = element.closest<HTMLElement>('.dialog-panel')?.getBoundingClientRect();
    return {
      bottom: bounds.bottom,
      clientWidth: element.clientWidth,
      panelBottom: panel?.bottom ?? -1,
      panelTop: panel?.top ?? -1,
      scrollWidth: element.scrollWidth,
      top: bounds.top,
    };
  });

  expect(footerGeometry.scrollWidth).toBeLessThanOrEqual(footerGeometry.clientWidth);
  expect(footerGeometry.top).toBeGreaterThanOrEqual(footerGeometry.panelTop);
  expect(footerGeometry.bottom).toBeLessThanOrEqual(footerGeometry.panelBottom + 1);

  await expectNoDocumentOverflow(page);
}

async function waitForMoveShield(page: Page): Promise<void> {
  await page.waitForTimeout(MOVE_COMPLETION_SHIELD_DURATION_MS + 80);
}

async function exerciseMoveDismissals(
  page: Page,
  openMove: () => Promise<Locator>,
  title: string,
): Promise<void> {
  let move = await openMove();
  await expectMoveGeometry(page, move, title);
  await move.getByRole('button', { name: `Close ${title}` }).click();

  await expect(move).toHaveCount(0);

  move = await openMove();
  await move.locator('[data-move-target-row="true"]').focus();
  await page.keyboard.press('Escape');

  await expect(move).toHaveCount(0);

  move = await openMove();
  await page.getByTestId('dialog-backdrop').filter({ has: move }).click({
    position: { x: 3, y: 3 },
  });

  await expect(move).toHaveCount(0);

  move = await openMove();
  await move.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(move).toHaveCount(0);

  await waitForMoveShield(page);

  move = await openMove();
  await move.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(move).toHaveCount(0);

  await waitForMoveShield(page);
}

for (const viewport of MOVE_VIEWPORTS) {
  test(`F1 Move stays contained and fully dismissible at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');

    await exerciseMoveDismissals(
      page,
      () => openMoveForPlaceholder(page, 'Announcement Bar'),
      'Move Announcement Bar',
    );
    await exerciseMoveDismissals(
      page,
      () => openMoveForBooking(page, 'Home'),
      'Move Booking',
    );
  });
}

type ScaffoldRecord = {
  avatarBackground: string;
  avatarColor: string;
  avatarContrast: number;
  chipBackground: string;
  chipColor: string;
  chipContrast: number;
  eyebrowColor: string;
  eyebrowContrast: number;
  placeholderBackground: string;
  tokens: Record<string, string>;
};

async function scaffoldRecord(page: Page): Promise<ScaffoldRecord> {
  return page.evaluate(() => {
    const avatar = document.querySelector<HTMLElement>('.client-brand > span');
    const eyebrow = document.querySelector<HTMLElement>('.client-page__heading > span');
    const chip = document.querySelector<HTMLElement>('.preview-section__number');
    const placeholder = document.querySelector<HTMLElement>(
      '.preview-section:not(.preview-section--booking)',
    );
    if (!avatar || !eyebrow || !chip || !placeholder) {
      throw new Error('Preview scaffold is incomplete.');
    }
    const parseRgb = (value: string): [number, number, number] => {
      const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) {
        throw new Error(`Unable to parse ${value}.`);
      }
      return channels as [number, number, number];
    };
    const luminance = (value: string) => {
      const channels = parseRgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * (channels[0] ?? 0))
        + (0.7152 * (channels[1] ?? 0))
        + (0.0722 * (channels[2] ?? 0));
    };
    const contrast = (foreground: string, background: string) => {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const avatarStyle = window.getComputedStyle(avatar);
    const eyebrowStyle = window.getComputedStyle(eyebrow);
    const chipStyle = window.getComputedStyle(chip);
    const placeholderStyle = window.getComputedStyle(placeholder);
    const clientStyle = window.getComputedStyle(
      document.querySelector<HTMLElement>('.client-site') ?? document.documentElement,
    );
    const canvas = clientStyle.getPropertyValue('--final-canvas').trim();
    const canvasProbe = document.createElement('span');
    canvasProbe.style.color = canvas;
    document.body.append(canvasProbe);
    const canvasColor = window.getComputedStyle(canvasProbe).color;
    canvasProbe.remove();
    return {
      avatarBackground: avatarStyle.backgroundColor,
      avatarColor: avatarStyle.color,
      avatarContrast: contrast(avatarStyle.color, avatarStyle.backgroundColor),
      chipBackground: chipStyle.backgroundColor,
      chipColor: chipStyle.color,
      chipContrast: contrast(chipStyle.color, chipStyle.backgroundColor),
      eyebrowColor: eyebrowStyle.color,
      eyebrowContrast: contrast(eyebrowStyle.color, canvasColor),
      placeholderBackground: placeholderStyle.backgroundImage,
      tokens: Object.fromEntries([
        '--final-accent',
        '--final-blush',
        '--final-canvas',
        '--final-chrome',
        '--final-ink',
        '--final-muted',
      ].map(token => [token, clientStyle.getPropertyValue(token).trim()])),
    };
  });
}

function expectWarmScaffold(record: ScaffoldRecord): void {
  expect(record.tokens).toEqual({
    '--final-accent': '#9b2454',
    '--final-blush': '#f7edf0',
    '--final-canvas': '#fffdfa',
    '--final-chrome': '#f6f2ed',
    '--final-ink': '#2c2222',
    '--final-muted': '#766a69',
  });
  expect(record.avatarBackground).toBe('rgb(155, 36, 84)');
  expect(record.avatarColor).toBe('rgb(255, 255, 255)');
  expect(record.eyebrowColor).toBe('rgb(118, 106, 105)');
  expect(record.chipBackground).toBe('rgb(44, 34, 34)');
  expect(record.chipColor).toBe('rgb(255, 255, 255)');
  expect(record.placeholderBackground).toContain('rgb(255, 253, 250)');
  expect(record.placeholderBackground).toContain('rgb(246, 242, 237)');

  const oldCoolTokens = /rgb\((?:92, 62, 232|65, 38, 196|79, 70, 229|99, 102, 241|15, 23, 42|30, 41, 59|51, 65, 85|71, 85, 105)\)/;

  expect(JSON.stringify(record)).not.toMatch(oldCoolTokens);
  expect(record.avatarContrast).toBeGreaterThanOrEqual(4.5);
  expect(record.chipContrast).toBeGreaterThanOrEqual(4.5);
  expect(record.eyebrowContrast).toBeGreaterThanOrEqual(4.5);
}

test('F2 Preview scaffold uses the warm Luster token family in every simulated device and real mobile', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  const devices = page.getByRole('group', { name: 'Preview viewport' });
  for (const device of ['Phone', 'Tablet', 'Desktop'] as const) {
    await devices.getByRole('button', { name: device }).click();

    await expect(page.getByTestId('preview-stage')).toHaveClass(
      new RegExp(`preview-stage--${device === 'Phone' ? 'mobile' : device.toLowerCase()}`),
    );
    await expect(page.locator('.client-header')).toBeVisible();
    await expect(page.locator('.client-page__heading')).toBeVisible();
    // Quick Book's Home holds 6 sections and Booking renders through its own
    // renderer, so 5 scaffold sections remain.
    await expect(page.locator('.preview-section:not(.preview-section--booking)'))
      .toHaveCount(5);

    expectWarmScaffold(await scaffoldRecord(page));
  }

  const declarations = await page.evaluate(() => {
    const collected: Array<{ selector: string; value: string }> = [];
    const visit = (rules: CSSRuleList) => {
      for (const rule of [...rules]) {
        if (rule instanceof CSSStyleRule) {
          collected.push({ selector: rule.selectorText, value: rule.style.cssText });
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    for (const sheet of [...document.styleSheets]) {
      visit(sheet.cssRules);
    }
    return collected;
  });

  expect(declarations.find(rule => rule.selector.includes('.client-brand > span'))?.value)
    .toContain('var(--final-accent)');
  expect(declarations.find(rule => rule.selector === '.preview-section__number')?.value)
    .toContain('var(--final-ink)');
  expect(declarations.find(rule => rule.selector === '.final-hybrid-preview .preview-section')?.value)
    .toContain('var(--final-chrome)');

  await page.getByRole('button', { name: 'Back to editor' }).click();
  await page.setViewportSize({ height: 844, width: 390 });
  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await expect(page.getByTestId('preview-stage')).toHaveClass(/preview-stage--mobile/);
  await expect(devices).toBeHidden();

  expectWarmScaffold(await scaffoldRecord(page));
});

async function openDesktopSettingsVia(
  page: Page,
  input: 'keyboard' | 'pointer',
): Promise<{ settings: Locator; trigger: Locator }> {
  await selectBooking(page, 'Home');
  const trigger = page
    .getByTestId('selected-section-toolbar')
    .getByRole('button', { name: 'Edit', exact: true });

  await expect(trigger).toBeVisible();

  if (input === 'keyboard') {
    await trigger.focus();
    await page.keyboard.press('Enter');
  } else {
    await trigger.click();
  }
  const settings = page.getByRole('dialog', { name: 'Booking settings' });

  await expect(settings).toBeVisible();

  return { settings, trigger };
}

async function expectSettingsHeadingTreatment(
  settings: Locator,
  keyboardVisible: boolean,
): Promise<number> {
  const heading = settings.getByRole('heading', { name: 'Booking', exact: true });

  await expect(heading).toBeFocused();
  expect(await heading.evaluate(element => element.matches(':focus-visible')))
    .toBe(keyboardVisible);

  const treatment = await heading.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const panel = element.closest<HTMLElement>('.final-booking-settings-drawer')
      ?.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      borderStyle: style.borderStyle,
      className: element.className,
      display: style.display,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      panelWidth: panel?.width ?? 0,
      width: bounds.width,
    };
  });

  expect(treatment.className).toContain('final-booking-settings-drawer__title');
  expect(treatment.className).not.toMatch(/(?:form-field|input|textarea)/i);
  expect(treatment.display).toBe('inline-block');
  expect(treatment.borderStyle).toBe('none');

  if (keyboardVisible) {
    expect(treatment.outlineStyle).toBe('solid');
    expect(Number.parseFloat(treatment.outlineWidth)).toBeGreaterThanOrEqual(2);
  }

  expect(treatment.width).toBeLessThan(treatment.panelWidth / 2);

  return treatment.width;
}

async function expectHideSettingsVariant(
  settings: Locator,
  docked: boolean,
): Promise<void> {
  const hide = settings.getByRole('button', { name: 'Hide settings', exact: true });

  await expect(hide).toHaveCount(1);
  await expect(hide).toBeVisible();

  const record = await hide.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const header = element.closest<HTMLElement>('header')?.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      gridColumnStart: style.gridColumnStart,
      gridRowStart: style.gridRowStart,
      headerWidth: header?.width ?? 0,
      height: bounds.height,
      width: bounds.width,
    };
  });

  expect(record.height).toBeGreaterThanOrEqual(44);

  if (docked) {
    expect(record.gridColumnStart).toBe('2');
    expect(record.gridRowStart).toBe('1');
    expect(record.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(record.width).toBeLessThan(record.headerWidth / 2);
  } else {
    expect(record.gridColumnStart).toBe('1');
    expect(record.gridRowStart).toBe('2');
    expect(record.width).toBeGreaterThan(record.headerWidth * 0.8);
  }
}

for (const [index, viewport] of SETTINGS_VIEWPORTS.entries()) {
  test(`F3/F7 focused heading and responsive Hide control at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openFreshLab(page);
    await chooseStarter(page, 'Quick Book');
    const input = index % 2 === 0 ? 'pointer' : 'keyboard';
    const { settings, trigger } = await openDesktopSettingsVia(
      page,
      input,
    );

    await expectSettingsHeadingTreatment(settings, input === 'keyboard');
    await expectHideSettingsVariant(settings, viewport.width >= 1180);

    await expect(page.getByRole('button', { name: 'Hide settings', exact: true }))
      .toHaveCount(1);

    const hide = settings.getByRole('button', { name: 'Hide settings', exact: true });
    await hide.click();

    await expect(settings).toBeHidden();
    await expect(trigger).toBeFocused();

    if (input === 'pointer') {
      await trigger.click();
    } else {
      await trigger.focus();
      await page.keyboard.press('Enter');
    }

    await expect(settings).toBeVisible();

    await expectSettingsHeadingTreatment(settings, input === 'keyboard');

    if (viewport.width === 1440 && viewport.height === 900) {
      // At this tall viewport the selected Booking card itself intersects both
      // the true top and bottom of the document, so there is no honest away
      // state to summon. The five shorter matrix cases exercise Show settings.
      await page.keyboard.press('Escape');

      await expect(settings).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement
          && active !== document.body
          && active !== document.documentElement;
      })).toBe(true);

      return;
    }

    await hide.click();
    await page.evaluate(() => window.scrollTo({ behavior: 'auto', top: 0 }));
    const awayToolbar = page.getByTestId('selected-section-toolbar');

    await expect(awayToolbar).toHaveClass(/is-away/);

    const show = awayToolbar.getByRole('button', {
      name: 'Show Booking settings',
    });

    await expect(show).toBeVisible();

    await show.click();

    await expect(settings).toBeVisible();

    await expectSettingsHeadingTreatment(settings, false);

    await page.keyboard.press('Escape');

    await expect(settings).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement
        && active !== document.body
        && active !== document.documentElement;
    })).toBe(true);
  });
}

test('F3 Page name remains visually distinct from the intrinsic focused settings heading', async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1180 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const { settings } = await openDesktopSettingsVia(page, 'keyboard');
  const headingWidth = await expectSettingsHeadingTreatment(settings, true);
  await page.keyboard.press('Escape');

  await expect(settings).toHaveCount(0);

  const structure = await openPagesAndStructure(page);
  await structure.getByRole('button', { name: 'Page settings for Home' }).click();
  const pageSettings = page.getByRole('dialog', { name: 'Home settings' });
  const input = pageSettings.getByLabel('Page name');
  await input.focus();

  await expect(input).toBeFocused();

  const inputTreatment = await input.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      borderStyle: style.borderStyle,
      outlineStyle: style.outlineStyle,
      tagName: element.tagName,
      width: bounds.width,
    };
  });

  expect(inputTreatment.tagName).toBe('INPUT');
  expect(inputTreatment.borderStyle).toBe('solid');
  expect(inputTreatment.outlineStyle).toBe('solid');
  expect(inputTreatment.width).toBeGreaterThan(headingWidth * 2);

  await page.keyboard.press('Escape');

  await expect(pageSettings).toHaveCount(0);

  await page.keyboard.press('Escape');

  await expect(structure).toHaveCount(0);
});

test('F5 both three-step owner scales say Compact, Comfortable, Spacious', async ({
  page,
}) => {
  await page.setViewportSize({ height: 600, width: 320 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const { settings } = await openBookingSettings(page, 'Home');
  const expected = ['Compact', 'Comfortable', 'Spacious'];
  for (const label of ['Booking spacing', 'Visual Grid density']) {
    const group = settings.getByRole('group', { name: label });

    await expect(group).toBeVisible();
    expect(await group.getByRole('button').allTextContents()).toEqual(expected);
    await expect(group.getByRole('button', { name: 'Comfortable', exact: true }))
      .toHaveCount(1);
    await expect(group.getByRole('button', { name: 'Comfort', exact: true }))
      .toHaveCount(0);

    const widths = await group.getByRole('button').evaluateAll(elements => (
      elements.map(element => element.getBoundingClientRect().width)
    ));

    expect(widths.every(width => width > 0)).toBe(true);
  }
});

async function chooseCategoryMenu(page: Page): Promise<void> {
  const { settings } = await openBookingSettings(page, 'Home');
  const option = settings.locator('[data-layout-option="category_menu"]');
  await option.click();

  await expect(option).toHaveAttribute('aria-pressed', 'true');

  const desktopClose = settings.getByRole('button', { name: 'Close Booking settings' });
  if (await desktopClose.isVisible()) {
    await desktopClose.click();
  } else {
    await settings.getByRole('button', { name: 'Close Booking' }).click();
  }

  await expect(settings).toHaveCount(0);
}

async function selectCategoryService(
  page: Page,
  serviceName: string,
): Promise<Locator> {
  const renderer = page.getByTestId('booking-section-preview');
  const search = renderer.getByRole('searchbox', { name: 'Search services' });
  await search.fill(serviceName);
  const exactName = escapeRegExp(serviceName);
  const row = renderer.getByRole('button', {
    name: new RegExp(`^View details for ${exactName},`),
  });

  await expect(row).toHaveCount(1);

  await row.click();
  const detail = page.getByTestId('service-detail-dialog');

  await expect(detail).toBeVisible();

  await detail.getByRole('button', { name: 'Keep browsing' }).click();
  const selected = renderer.getByRole('button', {
    name: new RegExp(`^Change options for ${exactName},.*selected$`),
  });

  await expect(selected).toHaveAttribute('data-selected', 'true');

  return selected;
}

async function expectSelectedCategoryRow(
  row: Locator,
  serviceName: string,
): Promise<void> {
  const name = row.locator('.category-row-service-name');
  const badgeContainer = row.locator('.category-row-selected');
  const badge = badgeContainer.getByText('Selected', { exact: true });

  await expect(name).toHaveText(serviceName);
  await expect(badge).toBeVisible();
  await expect(row).toHaveAttribute('aria-label', /selected$/);

  const record = await row.evaluate((element, expectedName) => {
    const nameElement = element.querySelector<HTMLElement>('.category-row-service-name');
    const badgeElement = element.querySelector<HTMLElement>('.category-row-selected');
    const metaElements = [...element.querySelectorAll<HTMLElement>(
      '.category-row-meta, .category-desktop-meta',
    )].filter((candidate) => {
      const style = window.getComputedStyle(candidate);
      const bounds = candidate.getBoundingClientRect();
      return style.display !== 'none' && bounds.width > 0 && bounds.height > 0;
    });
    if (!nameElement || !badgeElement || nameElement.textContent !== expectedName) {
      throw new Error(`Selected row for ${expectedName} is incomplete.`);
    }
    const textNode = nameElement.firstChild;
    if (!textNode) {
      throw new Error('Service name text node is missing.');
    }
    const wordRectCounts = [...expectedName.matchAll(/\S+/g)].map((match) => {
      const range = document.createRange();
      const start = match.index ?? 0;
      range.setStart(textNode, start);
      range.setEnd(textNode, start + match[0].length);
      return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).length;
    });
    const nameBounds = nameElement.getBoundingClientRect();
    const badgeBounds = badgeElement.getBoundingClientRect();
    const style = window.getComputedStyle(nameElement);
    const badgeStyle = window.getComputedStyle(badgeElement);
    return {
      badgeDisplay: badgeStyle.display,
      badgeBounds: {
        bottom: badgeBounds.bottom,
        left: badgeBounds.left,
        right: badgeBounds.right,
        top: badgeBounds.top,
      },
      badgeTop: badgeBounds.top,
      boxShadow: window.getComputedStyle(element).boxShadow,
      hyphens: style.hyphens,
      meta: metaElements.map((meta) => {
        const bounds = meta.getBoundingClientRect();
        return {
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          text: meta.textContent?.trim() ?? '',
          top: bounds.top,
        };
      }),
      nameBottom: nameBounds.bottom,
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      wordRectCounts,
    };
  }, serviceName);

  expect(record.hyphens).toBe('none');
  expect(record.overflowWrap).toBe('normal');
  expect(record.wordBreak).toBe('normal');
  expect(record.wordRectCounts.every(count => count === 1)).toBe(true);
  expect(record.badgeDisplay).toBe('block');
  expect(record.badgeTop).toBeGreaterThanOrEqual(record.nameBottom - 1);
  expect(record.boxShadow).not.toBe('none');
  expect(record.meta.length).toBeGreaterThan(0);
  expect(record.meta.every(meta => meta.text.length > 0)).toBe(true);

  for (const meta of record.meta) {
    const separated = record.badgeBounds.bottom <= meta.top + 1
      || meta.bottom <= record.badgeBounds.top + 1
      || record.badgeBounds.right <= meta.left + 1
      || meta.right <= record.badgeBounds.left + 1;

    expect(separated, `Selected badge must not overlap ${meta.text}`).toBe(true);
  }
}

test('F4 selected Category Menu rows preserve whole words at phone widths and simulated Tablet', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.setViewportSize({ height: 900, width: 1440 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  await chooseCategoryMenu(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const devices = page.getByRole('group', { name: 'Preview viewport' });
  await devices.getByRole('button', { name: 'Phone' }).click();

  const viewports = [
    { device: 'Phone', height: 600, width: 320 },
    { device: 'Phone', height: 600, width: 375 },
    { device: 'Phone', height: 844, width: 390 },
    { device: 'Phone', height: 932, width: 430 },
    { device: 'Tablet', height: 900, width: 1440 },
  ] as const;
  const services = [
    'French',
    'Gel Manicure',
    'Russian Manicure',
    'Complimentary Nail Consultation',
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width });
    if (viewport.device === 'Tablet') {
      await devices.getByRole('button', { name: 'Tablet' }).click();
    }

    await expect(page.getByTestId('preview-stage')).toHaveClass(
      new RegExp(`preview-stage--${viewport.device.toLowerCase() === 'phone' ? 'mobile' : 'tablet'}`),
    );

    for (const serviceName of services) {
      await test.step(`${viewport.width}x${viewport.height} ${serviceName}`, async () => {
        const selected = await selectCategoryService(page, serviceName);
        await expectSelectedCategoryRow(selected, serviceName);
      });
    }
  }
});

async function expectInitialEditorTop(page: Page): Promise<void> {
  await settlePaint(page);
  const samples = await page.evaluate(async () => {
    const values: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      values.push(window.scrollY);
      await new Promise(resolve => window.setTimeout(resolve, 40));
    }
    return values;
  });

  expect(samples).toEqual(Array.from({ length: 8 }, () => 0));

  const geometry = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.final-topbar');
    const clientHeader = document.querySelector<HTMLElement>('.canvas-client-header');
    const pageTitle = document.querySelector<HTMLElement>('.final-page-heading h1');
    const toolbarBounds = toolbar?.getBoundingClientRect();
    const headerBounds = clientHeader?.getBoundingClientRect();
    const titleBounds = pageTitle?.getBoundingClientRect();
    return {
      headerTop: headerBounds?.top ?? -1,
      scrollY: window.scrollY,
      titleTop: titleBounds?.top ?? -1,
      toolbarBottom: toolbarBounds?.bottom ?? -1,
    };
  });

  expect(geometry.scrollY).toBe(0);
  expect(geometry.headerTop).toBeGreaterThanOrEqual(geometry.toolbarBottom);
  expect(geometry.titleTop).toBeGreaterThan(geometry.toolbarBottom);
}

for (const viewport of INITIAL_SCROLL_VIEWPORTS) {
  test(`F6 every starter opens at the true top at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.setViewportSize(viewport);
    for (const starter of STARTERS) {
      await openFreshLab(page);
      await page.evaluate(() => window.scrollTo({
        behavior: 'auto',
        top: document.documentElement.scrollHeight,
      }));

      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      await chooseStarter(page, starter);
      await expectInitialEditorTop(page);
    }
  });
}

test('F6 page switching preserves later scroll while an explicit starter reset restores top', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await openFreshLab(page);
  await chooseStarter(page, 'Multi-page website');
  await page.evaluate(() => window.scrollTo({ behavior: 'auto', top: 260 }));
  const beforeSwitch = await page.evaluate(() => window.scrollY);

  expect(beforeSwitch).toBeGreaterThan(0);

  await selectPageFromStructure(page, 'Services / Book');
  const afterSwitch = await page.evaluate(() => window.scrollY);

  expect(afterSwitch).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo({ behavior: 'auto', top: 520 }));
  await page.getByRole('button', { name: 'More site options' }).click();
  const more = page.getByRole('dialog', { name: 'More' });
  await more.getByRole('button', { name: 'Reset to starter kit' }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'Reset to the starting point?',
  });
  await confirmation.getByRole('button', { name: 'Reset to starter' }).click();
  await expectInitialEditorTop(page);
});

test('F7 the live 1179-to-1180 transition moves one Hide control into the header row', async ({
  page,
}) => {
  await page.setViewportSize({ height: 800, width: 1179 });
  await openFreshLab(page);
  await chooseStarter(page, 'Quick Book');
  const { settings } = await openDesktopSettingsVia(page, 'pointer');
  await expectHideSettingsVariant(settings, false);
  await page.setViewportSize({ height: 800, width: 1180 });

  await expect(settings).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide settings', exact: true }))
    .toHaveCount(1);

  await expectHideSettingsVariant(settings, true);
  await page.setViewportSize({ height: 800, width: 1179 });
  await expectHideSettingsVariant(settings, false);
});

test('Warm Ground / White Band hierarchy stays editor-only and preserves starter motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ height: 900, width: 1440 });
  await openFreshLab(page);

  const quickBook = page.getByRole('button', { name: /^Quick Book/ });
  const quickBookPreview = page.getByTestId('starter-preview-quick_book');
  const starterTreatment = await page.evaluate(() => {
    const screen = document.querySelector<HTMLElement>('.final-starter-screen');
    const card = document.querySelector<HTMLElement>('.final-starter-card');
    if (!screen || !card) {
      throw new Error('Starter chooser surfaces are missing.');
    }
    const screenStyle = window.getComputedStyle(screen);
    const cardStyle = window.getComputedStyle(card);
    return {
      cardBackground: cardStyle.backgroundColor,
      cardBorderWidth: cardStyle.borderTopWidth,
      cardRadius: cardStyle.borderRadius,
      cardShadow: cardStyle.boxShadow,
      screenBackground: screenStyle.backgroundColor,
    };
  });

  expect(starterTreatment).toMatchObject({
    cardBackground: 'rgb(255, 255, 255)',
    cardBorderWidth: '1px',
    cardRadius: '22px',
    screenBackground: 'rgb(247, 242, 236)',
  });
  expect(starterTreatment.cardShadow).not.toBe('none');

  await quickBook.hover();

  await expect(quickBookPreview).toHaveAttribute('data-preview-active', 'true');
  await expect.poll(() => quickBookPreview.locator('.final-starter-preview__track')
    .evaluate(element => window.getComputedStyle(element).animationName))
    .toBe('final-starter-quick-scroll');

  await chooseStarter(page, 'One-page website');
  // The first two sections of the One-page starter's Home page.
  const sectionOne = page.getByRole('listitem', { name: 'Announcement Bar on Home' });
  const sectionTwo = page.getByRole('listitem', { name: 'Welcome on Home' });

  await expect(page.locator('.booking-editor-preview__fade')).toHaveCount(1);

  const editorTreatment = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('.final-hybrid-app');
    const booking = document.querySelector<HTMLElement>('.section-card--booking');
    const frame = document.querySelector<HTMLElement>('.final-canvas-frame');
    const canvas = document.querySelector<HTMLElement>('.final-site-canvas');
    const fade = document.querySelector<HTMLElement>('.booking-editor-preview__fade');
    const insertion = document.querySelector<HTMLElement>(
      '.final-insertion:not(.final-insertion--top)',
    );
    const list = document.querySelector<HTMLElement>('.final-sections-list');
    const section = document.querySelector<HTMLElement>('.section-card');
    const placeholder = section?.querySelector<HTMLElement>('.placeholder-grid');
    const placeholderCard = placeholder?.querySelector<HTMLElement>('span');
    if (
      !app || !booking || !frame || !canvas || !fade || !insertion || !list
      || !section || !placeholder || !placeholderCard
    ) {
      throw new Error('Editor hierarchy surfaces are missing.');
    }
    const appStyle = window.getComputedStyle(app);
    const bookingStyle = window.getComputedStyle(booking);
    const frameStyle = window.getComputedStyle(frame);
    const canvasStyle = window.getComputedStyle(canvas);
    const fadeStyle = window.getComputedStyle(fade);
    const insertionStyle = window.getComputedStyle(insertion);
    const listStyle = window.getComputedStyle(list);
    const sectionStyle = window.getComputedStyle(section);
    const placeholderStyle = window.getComputedStyle(placeholder);
    const placeholderCardStyle = window.getComputedStyle(placeholderCard);
    return {
      bookingBackground: bookingStyle.backgroundColor,
      canvasBackground: canvasStyle.backgroundColor,
      fadeBackground: fadeStyle.backgroundImage,
      frameBackground: frameStyle.backgroundColor,
      frameRadius: frameStyle.borderRadius,
      frameShadow: frameStyle.boxShadow,
      insertionMarginBottom: insertionStyle.marginBottom,
      insertionMarginTop: insertionStyle.marginTop,
      listDisplay: listStyle.display,
      listGap: listStyle.gap,
      placeholderBackground: placeholderCardStyle.backgroundImage,
      placeholderBorderColor: placeholderCardStyle.borderTopColor,
      placeholderBorderWidth: placeholderCardStyle.borderTopWidth,
      placeholderOpacity: placeholderStyle.opacity,
      sectionBackground: sectionStyle.backgroundColor,
      sectionBorderBottom: sectionStyle.borderBottomWidth,
      sectionBorderLeft: sectionStyle.borderLeftWidth,
      sectionBorderTop: sectionStyle.borderTopWidth,
      sectionRadius: sectionStyle.borderRadius,
      sectionShadow: sectionStyle.boxShadow,
      tokens: Object.fromEntries([
        '--edit-card-line',
        '--edit-ground',
        '--edit-gutter',
        '--edit-section',
        '--edit-section-line',
        '--edit-section-line-strong',
      ].map(token => [token, appStyle.getPropertyValue(token).trim()])),
    };
  });

  expect(editorTreatment.tokens).toEqual({
    '--edit-card-line': 'rgba(64, 43, 44, 0.08)',
    '--edit-ground': '#f7f1eb',
    '--edit-gutter': '8px',
    '--edit-section': '#fff',
    '--edit-section-line': 'rgba(64, 43, 44, 0.12)',
    '--edit-section-line-strong': 'rgba(64, 43, 44, 0.26)',
  });
  expect(editorTreatment).toMatchObject({
    bookingBackground: 'rgb(255, 255, 255)',
    canvasBackground: 'rgb(247, 241, 235)',
    frameBackground: 'rgb(247, 241, 235)',
    frameRadius: '3px',
    insertionMarginBottom: '0px',
    insertionMarginTop: '0px',
    listDisplay: 'flex',
    listGap: '8px',
    placeholderBorderColor: 'rgba(64, 43, 44, 0.08)',
    placeholderBorderWidth: '1px',
    placeholderOpacity: '0.8',
    sectionBackground: 'rgb(255, 255, 255)',
    sectionBorderBottom: '1px',
    sectionBorderLeft: '0px',
    sectionBorderTop: '1px',
    sectionRadius: '0px',
    sectionShadow: 'none',
  });
  expect(editorTreatment.frameShadow).not.toBe('none');
  expect(editorTreatment.canvasBackground).not.toBe(editorTreatment.sectionBackground);
  expect(editorTreatment.placeholderBackground)
    .toContain('rgb(241, 234, 231)');
  expect(editorTreatment.placeholderBackground)
    .toContain('rgb(247, 242, 238)');
  expect(editorTreatment.fadeBackground).toContain('rgb(255, 255, 255)');

  await sectionTwo.hover();

  await expect.poll(() => sectionTwo.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const chip = element.querySelector<HTMLElement>('.section-card__number');
    return {
      border: style.borderTopColor,
      chip: chip ? window.getComputedStyle(chip).backgroundColor : '',
    };
  })).toEqual({
    border: 'rgba(64, 43, 44, 0.26)',
    chip: 'rgb(248, 233, 238)',
  });

  await sectionOne.locator('.section-card__select-surface').click();

  await expect(sectionOne).toHaveClass(/is-selected/);
  await expect.poll(() => sectionOne.evaluate(element => (
    window.getComputedStyle(element).boxShadow
  ))).toContain('rgb(155, 36, 84)');

  const selectedTreatment = await sectionOne.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      background: style.backgroundColor,
      boxShadow: style.boxShadow,
      outlineWidth: style.outlineWidth,
    };
  });

  expect(selectedTreatment.background).toBe('rgb(255, 255, 255)');
  expect(selectedTreatment.boxShadow).toContain('rgb(155, 36, 84)');
  expect(selectedTreatment.boxShadow).toContain('rgb(255, 255, 255)');
  expect(selectedTreatment.outlineWidth).toBe('2px');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();

  await expect(page.getByTestId('preview-stage')).toBeVisible();

  const previewBoundary = await page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>('.final-hybrid-preview');
    const clientSite = document.querySelector<HTMLElement>('.client-site');
    if (!preview || !clientSite) {
      throw new Error('Customer Preview is missing.');
    }
    const previewStyle = window.getComputedStyle(preview);
    const clientStyle = window.getComputedStyle(clientSite);
    return {
      clientBackground: clientStyle.backgroundColor,
      editGround: previewStyle.getPropertyValue('--edit-ground').trim(),
      editSection: previewStyle.getPropertyValue('--edit-section').trim(),
      editorLists: document.querySelectorAll('.final-sections-list').length,
      editorSections: document.querySelectorAll('.section-card').length,
    };
  });

  expect(previewBoundary).toEqual({
    clientBackground: 'rgb(255, 253, 250)',
    editGround: '',
    editSection: '',
    editorLists: 0,
    editorSections: 0,
  });
});

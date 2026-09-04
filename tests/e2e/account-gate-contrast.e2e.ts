import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, type Locator, test } from '@playwright/test';

const stylesheetPath = path.join(
  process.cwd(),
  'src/features/onboarding-v1-integration/account-gate/account-gate.css',
);
// DOMRect subtraction noise is smaller than a layout subpixel (1/64px).
const DOM_RECT_EPSILON = 0.0001;

// Match GateShell and the provider row in AccountGate.tsx, without loading Clerk.
const providerMarkup = `
  <main class="onboarding-integration-owner is-account">
    <div class="onboarding-gate">
      <div class="onboarding-gate__glow" aria-hidden="true"></div>
      <div class="onboarding-gate__column">
        <section class="onboarding-gate__hero" aria-label="Save your site">
          <div class="onboarding-gate__actions" data-entrance="4">
            <button type="button" class="onboarding-gate__provider is-google"><span>Continue with Google</span></button>
            <button type="button" class="onboarding-gate__provider is-apple"><span>Continue with Apple</span></button>
            <button type="button" class="onboarding-gate__provider is-email"><span>Continue with email</span></button>
          </div>
        </section>
      </div>
    </div>
  </main>
`;

async function readProviderAppearance(button: Locator) {
  return button.evaluate((element) => {
    const buttonStyle = getComputedStyle(element);
    const textStyle = getComputedStyle(element.querySelector('span')!);
    const parseColor = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      if (channels.length < 3 || (channels[3] ?? 1) !== 1) {
        throw new Error(`Contrast measurement requires opaque RGB colors: ${value}`);
      }
      return channels.slice(0, 3);
    };
    const luminance = (color: string) => parseColor(color).reduce((sum, channel, index) => {
      const normalized = channel / 255;
      const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
    }, 0);
    const text = luminance(textStyle.color);
    const background = luminance(buttonStyle.backgroundColor);
    const bounds = element.getBoundingClientRect();
    return {
      backgroundColor: buttonStyle.backgroundColor,
      backgroundImage: buttonStyle.backgroundImage,
      color: textStyle.color,
      contrast: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
      height: bounds.height,
      minimumHeight: buttonStyle.minHeight,
      opacity: buttonStyle.opacity,
      width: bounds.width,
    };
  });
}

test.use({ reducedMotion: 'reduce' });

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`account providers retain readable default and hover states at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    // This is a static CSS regression: no app, provider, or fixture requests.
    await page.route('**/*', route => route.abort('blockedbyclient'));
    await page.setContent(providerMarkup);
    await page.addStyleTag({ content: await readFile(stylesheetPath, 'utf8') });

    for (const provider of ['Google', 'Apple', 'email']) {
      const button = page.getByRole('button', { name: `Continue with ${provider}`, exact: true });
      await page.mouse.move(0, 0);

      await expect(button).toBeVisible();

      const resting = await readProviderAppearance(button);

      expect(resting.opacity).toBe('1');
      expect(resting.backgroundImage).toBe('none');
      expect(resting.contrast, `${provider} default text contrast`).toBeGreaterThanOrEqual(4.5);
      expect(resting.minimumHeight).toBe('52px');
      expect(resting.height + DOM_RECT_EPSILON, `${provider} default target height`).toBeGreaterThanOrEqual(52);
      expect(resting.width + DOM_RECT_EPSILON, `${provider} default target width`).toBeGreaterThanOrEqual(52);

      await button.hover();

      await expect.poll(async () => (await readProviderAppearance(button)).backgroundColor, {
        message: `${provider} must reach its real hover styling`,
      }).not.toBe(resting.backgroundColor);

      const hovered = await readProviderAppearance(button);

      expect(hovered.backgroundImage).toBe('none');
      expect(hovered.opacity).toBe('1');
      expect(hovered.contrast, `${provider} hover text contrast`).toBeGreaterThanOrEqual(4.5);
      expect(hovered.minimumHeight).toBe('52px');
      expect(hovered.height + DOM_RECT_EPSILON, `${provider} hover target height`).toBeGreaterThanOrEqual(52);
      expect(hovered.width + DOM_RECT_EPSILON, `${provider} hover target width`).toBeGreaterThanOrEqual(52);
    }
  });
}

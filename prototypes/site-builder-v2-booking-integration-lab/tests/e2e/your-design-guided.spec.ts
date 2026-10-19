import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, type Page, test } from '@playwright/test';

test('uploads an original, adds booking/contact links by hand, previews and resumes', async ({ page }, testInfo) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) {
      apiRequests.push(new URL(request.url()).pathname);
    }
  });
  await page.goto('/');
  await page.getByRole('button', { name: /^Your Design Upload your design/ }).click();
  const upload = page.getByRole('dialog', { name: 'Upload a Canva design' });

  await expect(upload.getByRole('list', { name: 'Your Design steps' })).toBeVisible();
  await expect(upload.getByRole('radio', { name: 'Full width' })).toBeHidden();
  await expect(upload.getByRole('button', { name: 'Save Canva design' })).toHaveCount(0);

  const original = await readFile(new URL('../../../../public/assets/images/services/manicure-french.webp', import.meta.url));
  await upload.getByLabel('Choose images').setInputFiles({ name: 'my-design.webp', mimeType: 'image/webp', buffer: original });
  await upload.getByRole('button', { name: 'Add clickable links' }).click();
  let links = page.getByRole('dialog', { name: 'Make your design clickable' });

  await expect(links.getByRole('button', { name: 'Internal Luster page or section', exact: true })).toHaveCount(0);

  await links.getByRole('button', { name: 'Place button on design' }).click();
  await links.getByRole('button', { name: 'Place in centre' }).click();

  await expect(links.getByLabel('Show as a raised button')).not.toBeChecked();

  await links.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(upload.getByRole('heading', { name: '1 link added' })).toBeVisible();

  await upload.getByRole('button', { name: 'Edit clickable links' }).click();
  links = page.getByRole('dialog', { name: 'Make your design clickable' });
  await links.getByRole('button', { name: 'Add another clickable area' }).click();
  await links.getByRole('button', { name: 'Instagram', exact: true }).click();
  await links.getByLabel('Instagram username').fill('@manual.studio');
  await links.getByRole('button', { name: 'Place button on design' }).click();
  const image = links.getByRole('img', { name: 'Design being edited' });

  await expect(image).toBeVisible();

  const imageBox = await image.boundingBox();
  if (!imageBox) {
    throw new Error('The uploaded artwork is not visible.');
  }
  await links.getByRole('button', { name: 'Place button here' }).click({ position: { x: imageBox.width * 0.5, y: imageBox.height * 0.2 } });
  await links.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(upload.getByRole('heading', { name: '2 links added' })).toBeVisible();
  await expect(upload.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(upload.getByRole('button', { name: 'Save Canva design' })).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath('01-guided-upload.png') });
  await upload.getByRole('button', { name: 'Preview website' }).click();

  const preview = page.getByRole('dialog', { name: 'Preview your design & links' });
  const artwork = preview.locator('.custom-design-customer-image');

  await expect(artwork).toBeVisible();

  const bytes = await artwork.evaluate(async element => Array.from(new Uint8Array(await (await fetch((element as HTMLImageElement).src)).arrayBuffer())));

  expect(Buffer.from(bytes)).toEqual(original);

  const instagram = preview.getByRole('link', { name: 'Instagram @manual.studio', exact: true });

  await expect(instagram).toHaveAttribute('href', 'https://www.instagram.com/manual.studio/');
  await expect(instagram).toHaveAttribute('rel', 'noopener noreferrer');

  const booking = preview.locator('button.custom-design-area-link[aria-label="Book appointment"]');

  await expect(booking).toBeVisible();
  await expect(booking).not.toHaveClass(/custom-design-area-link--button/);

  await booking.click();

  await expect(preview.locator('[data-preview-target="booking"]')).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('02-booking-preview.png') });
  await preview.getByRole('button', { name: 'Return to setup' }).click();

  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit design & links' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Edit design & links' }).click();

  await expect(upload.getByRole('heading', { name: '2 links added' })).toBeVisible();
  await expect(upload.getByText('my-design.webp', { exact: true })).toBeVisible();

  await upload.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(upload).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit design & links' })).toBeVisible();
  expect(apiRequests).toEqual([]);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth));
});

test('rejects an unsafe link while retaining the uploaded artwork', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Your Design Upload your design/ }).click();
  const upload = page.getByRole('dialog', { name: 'Upload a Canva design' });
  await upload.getByLabel('Choose images').setInputFiles(fileURLToPath(new URL('../../../../public/assets/images/services/manicure-french.webp', import.meta.url)));
  await upload.getByRole('button', { name: 'Add clickable links' }).click();
  const links = page.getByRole('dialog', { name: 'Make your design clickable' });
  await links.getByRole('button', { name: 'Website', exact: true }).click();
  await links.getByLabel('Secure URL').fill('javascript:alert(document.cookie)');

  await expect(links.getByRole('button', { name: 'Place button on design' })).toBeDisabled();

  await links.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(upload.getByRole('button', { name: 'Add clickable links' })).toBeVisible();
  await expect(upload.getByText('manicure-french.webp', { exact: true })).toBeVisible();
});

// Synthetic images exercise shape/alpha and link alignment. These fixtures are
// not AI-generated websites or proof of source-image visual fidelity.
async function imageFixture(page: Page, size: { name: string; width: number; height: number }) {
  const dataUrl = await page.evaluate(({ width, height, name }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas fixture creation is unavailable.');
    }
    if (name !== 'transparent') {
      context.fillStyle = '#fbe8ef';
      context.fillRect(0, 0, width, height);
    }
    context.fillStyle = '#8f3852';
    context.fillRect(width * 0.1, height * 0.1, width * 0.8, height * 0.2);
    return canvas.toDataURL('image/png');
  }, size);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

const imageSizes = [
  { name: 'portrait', width: 1200, height: 1800, mode: 'poster', smallNotice: 0, wideNotice: 0, longNotice: 0, maxDesktopWidth: 780 },
  { name: 'square', width: 1200, height: 1200, mode: 'poster', smallNotice: 0, wideNotice: 0, longNotice: 0, maxDesktopWidth: 780 },
  { name: 'landscape', width: 1920, height: 1080, mode: 'contained', smallNotice: 0, wideNotice: 0, longNotice: 0, maxDesktopWidth: 1120 },
  { name: 'very-wide', width: 2400, height: 300, mode: 'contained', smallNotice: 0, wideNotice: 1, longNotice: 0, maxDesktopWidth: 1120 },
  { name: 'very-long', width: 600, height: 9000, mode: 'poster', smallNotice: 1, wideNotice: 0, longNotice: 1, maxDesktopWidth: 780 },
  { name: 'tiny', width: 180, height: 280, mode: 'poster', smallNotice: 1, wideNotice: 0, longNotice: 0, maxDesktopWidth: 271 },
  { name: 'transparent', width: 1200, height: 1200, mode: 'full_width', smallNotice: 0, wideNotice: 0, longNotice: 0, maxDesktopWidth: Infinity },
] as const;

for (const size of imageSizes) {
  test(`fits ${size.name} artwork, saves its background and keeps booking linked`, async ({ page }, testInfo) => {
    await page.goto('/');
    const original = await imageFixture(page, size);
    await page.getByRole('button', { name: /^Your Design Upload your design/ }).click();
    const upload = page.getByRole('dialog', { name: 'Upload a Canva design' });
    await upload.getByLabel('Choose images').setInputFiles({ name: `${size.name}.png`, mimeType: 'image/png', buffer: original });
    await upload.getByRole('button', { name: 'Add clickable links' }).click();
    const links = page.getByRole('dialog', { name: 'Make your design clickable' });
    await links.getByRole('button', { name: 'Place button on design' }).click();
    await links.getByRole('button', { name: 'Place in centre' }).click();
    await links.getByRole('button', { name: 'Done', exact: true }).click();
    await upload.getByText('Size & background', { exact: true }).click();
    await upload.locator(`input[name="canva-display"][value="${size.mode}"]`).check();
    await upload.getByRole('button', { name: 'Use cream background' }).click();

    await expect(upload.getByRole('button', { name: 'Use cream background' })).toHaveAttribute('aria-pressed', 'true');
    expect(await upload.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

    await expect(upload.getByRole('status').filter({ hasText: 'Small images can look blurry' })).toHaveCount(size.smallNotice);
    await expect(upload.getByText(/Wide artwork stays in proportion/)).toHaveCount(size.wideNotice);
    await expect(upload.getByText(/long design will scroll naturally/)).toHaveCount(size.longNotice);

    await page.screenshot({ path: testInfo.outputPath(`${size.name}-settings.png`) });
    await upload.getByRole('button', { name: 'Preview website' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview your design & links' });
    const previewModes: Record<string, string> = { 'desktop-chromium': 'Desktop', 'phone-chromium': 'Phone', 'phone-webkit': 'Phone', 'small-phone-webkit': 'Phone' };
    await preview.getByRole('button', { name: previewModes[testInfo.project.name], exact: true }).click();
    const artwork = preview.locator('.custom-design-customer-image');

    await expect(artwork).toBeVisible();
    await expect(artwork).toHaveJSProperty('naturalWidth', size.width);
    await expect(artwork).toHaveJSProperty('naturalHeight', size.height);

    const metrics = await artwork.evaluate((element) => {
      const image = element as HTMLImageElement;
      const style = getComputedStyle(image);
      return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, objectFit: style.objectFit };
    });

    expect(metrics.naturalWidth).toBe(size.width);
    expect(metrics.naturalHeight).toBe(size.height);
    expect(metrics.width / metrics.height).toBeCloseTo(size.width / size.height, 2);
    expect(metrics.objectFit).toBe('contain');

    const widthLimits: Record<string, number> = { 'desktop-chromium': size.maxDesktopWidth, 'phone-chromium': Infinity, 'phone-webkit': Infinity, 'small-phone-webkit': Infinity };

    expect(metrics.width).toBeLessThanOrEqual(widthLimits[testInfo.project.name]!);

    const section = preview.locator('.custom-design-customer-section');

    await expect(section).toHaveAttribute('data-display-mode', size.mode);
    await expect(section).toHaveAttribute('data-background-mode', 'custom');
    await expect(section).toHaveCSS('background-color', 'rgb(255, 248, 240)');

    const bytes = await artwork.evaluate(async element => Array.from(new Uint8Array(await (await fetch((element as HTMLImageElement).src)).arrayBuffer())));

    expect(Buffer.from(bytes)).toEqual(original);

    const booking = preview.locator('button.custom-design-area-link[aria-label="Book appointment"]');
    const originalRect = await booking.evaluate(element => ({ x: element.style.left, y: element.style.top, width: element.style.width, height: element.style.height }));

    await page.screenshot({ path: testInfo.outputPath(`${size.name}-preview.png`) });
    await booking.click();

    await expect(preview.locator('[data-preview-target="booking"]')).toBeVisible();

    await preview.getByRole('button', { name: 'Return to setup' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Edit design & links' }).click();
    await upload.getByText('Size & background', { exact: true }).click();

    await expect(upload.locator(`input[name="canva-display"][value="${size.mode}"]`)).toBeChecked();
    await expect(upload.getByRole('button', { name: 'Use cream background' })).toHaveAttribute('aria-pressed', 'true');

    await upload.getByRole('button', { name: 'Preview website' }).click();

    expect(await preview.locator('button.custom-design-area-link[aria-label="Book appointment"]').evaluate(element => ({ x: element.style.left, y: element.style.top, width: element.style.width, height: element.style.height }))).toEqual(originalRect);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate(element => element.clientWidth));
  });
}

test('shows optional size suggestions without requiring a particular image shape', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Your Design Upload your design/ }).click();
  const upload = page.getByRole('dialog', { name: 'Upload a Canva design' });

  await expect(upload.getByRole('table', { name: 'Suggested image sizes' })).toBeHidden();

  await upload.getByText('Get a sharp Canva export', { exact: true }).click();

  await expect(upload.getByRole('table', { name: 'Suggested image sizes' })).toBeVisible();
  await expect(upload.getByText(/There is no required shape/)).toBeVisible();
  expect(await upload.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: testInfo.outputPath('optional-image-size-guide.png') });
  await upload.getByText('Get a sharp Canva export', { exact: true }).click();

  await expect(upload.getByRole('table', { name: 'Suggested image sizes' })).toBeHidden();
  await expect(upload.getByLabel('Choose images')).toBeAttached();
});

test('keeps mixed image sizes and their booking link together after refresh', async ({ page }, testInfo) => {
  await page.goto('/');
  const sizes = [imageSizes[0], imageSizes[2], imageSizes[5]];
  const files = await Promise.all(sizes.map(async size => ({ name: `${size.name}.png`, mimeType: 'image/png', buffer: await imageFixture(page, size) })));
  await page.getByRole('button', { name: /^Your Design Upload your design/ }).click();
  const upload = page.getByRole('dialog', { name: 'Upload a Canva design' });
  await upload.getByLabel('Choose images').setInputFiles(files);

  await expect(upload.locator('.custom-design-owner-image-row')).toHaveCount(3);

  await upload.locator('.custom-design-owner-image-row').first().getByRole('button', { name: 'Make something clickable' }).click();
  const links = page.getByRole('dialog', { name: 'Make your design clickable' });
  await links.getByRole('button', { name: 'Place button on design' }).click();
  await links.getByRole('button', { name: 'Place in centre' }).click();
  await links.getByRole('button', { name: 'Done', exact: true }).click();
  await upload.getByText('Size & background', { exact: true }).click();
  await upload.getByRole('radio', { name: 'Fit to screen' }).check();
  await upload.getByRole('button', { name: 'Use dark background' }).click();
  await upload.getByRole('button', { name: 'Preview website' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview your design & links' });
  const artwork = preview.locator('.custom-design-customer-image');

  await expect(artwork).toHaveCount(3);
  await expect(preview.locator('.custom-design-customer-section')).toHaveCSS('background-color', 'rgb(35, 30, 34)');

  for (const [index, size] of sizes.entries()) {
    const image = artwork.nth(index);

    await expect(image).toHaveJSProperty('naturalWidth', size.width);
    await expect(image).toHaveJSProperty('naturalHeight', size.height);

    const renderedRatio = await image.evaluate(element => element.getBoundingClientRect().width / element.getBoundingClientRect().height);

    expect(renderedRatio).toBeCloseTo(size.width / size.height, 2);

    const bytes = await image.evaluate(async element => Array.from(new Uint8Array(await (await fetch((element as HTMLImageElement).src)).arrayBuffer())));

    expect(Buffer.from(bytes)).toEqual(files[index]?.buffer);
  }
  await page.screenshot({ path: testInfo.outputPath('mixed-sizes-preview.png') });
  await preview.locator('button.custom-design-area-link[aria-label="Book appointment"]').click();

  await expect(preview.locator('[data-preview-target="booking"]')).toBeVisible();

  await preview.getByRole('button', { name: 'Return to setup' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Edit design & links' }).click();

  await expect(upload.locator('.custom-design-owner-image-row')).toHaveCount(3);

  await upload.getByText('Size & background', { exact: true }).click();

  await expect(upload.getByRole('button', { name: 'Use dark background' })).toHaveAttribute('aria-pressed', 'true');
  expect(await upload.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});

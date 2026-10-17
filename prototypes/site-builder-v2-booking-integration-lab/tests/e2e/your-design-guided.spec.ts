import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

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

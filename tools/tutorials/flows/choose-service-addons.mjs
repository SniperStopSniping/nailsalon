/* eslint-disable unicorn/prefer-dom-node-text-content -- UI recordings read rendered text, excluding hidden templates. */
import { readFile } from 'node:fs/promises';

export async function prepare({
  page,
  tap,
  ready,
  post,
}) {
  const {
    saved,
  } = JSON.parse(await readFile('docs/tutorials/verification/add-service-evidence.json', 'utf8'));
  await tap(page.getByTestId('owner-nav-services'));
  await tap(page.getByTestId(`service-row-${saved.id}`));
  await tap(page.getByTestId('service-addons-summary-manage'));
  await ready(page.getByTestId('service-addon-picker'));
  for (const suffix of ['french-tips', 'chrome', 'glitter', 'outside-removal']) {
    const c = page.getByTestId(`service-addon-option-video-demo-solo-addon-${suffix}`);
    if ((await c.getAttribute('aria-checked')) === 'true') {
      await tap(c);
    }
  }
  await post(() => tap(page.getByTestId('service-addon-picker-save')), `/api/salon/services/${saved.id}/add-ons`);
  await page.getByTestId('service-addon-picker').waitFor({
    state: 'hidden',
  });
}
export default async ({
  page,
  tap,
  ready,
  step,
  evidence,
}) => {
  const saved = JSON.parse(await readFile('docs/tutorials/verification/add-service-evidence.json', 'utf8')).saved;
  if (!saved?.id) {
    throw new Error('Verified Luster Gel Manicure prerequisite missing');
  }
  await step('Open Luster Gel Manicure', 'Offer useful extras alongside the main treatment.', async () => {
    await tap(page.getByTestId('owner-nav-services'));
    await tap(page.getByTestId(`service-row-${saved.id}`));
    await ready(page.getByTestId('service-addons-summary-manage'));
  });
  await step('Choose its optional extras', 'Only offer add-ons that suit this treatment.', async () => {
    await tap(page.getByTestId('service-addons-summary-manage'));
    await ready(page.getByTestId('service-addon-picker'));
  });
  await step('Add French tips and chrome', 'Let clients choose their preferred finish.', async () => {
    await tap(page.getByTestId('service-addon-option-video-demo-solo-addon-french-tips'));
    await tap(page.getByTestId('service-addon-option-video-demo-solo-addon-chrome'));
  });
  await step('Include glitter and removal', 'Allow time for art and removal from another salon.', async () => {
    await tap(page.getByRole('checkbox', {
      name: /^Glitter/,
    }));
    await tap(page.getByRole('checkbox', {
      name: /^Removal from Another Salon/,
    }));
  });
  await step('Save the selected add-ons', 'Your service now shows these saved optional extras.', async () => {
    await tap(page.getByTestId('service-addon-picker-save'));
    await ready(page.getByTestId('service-addons-summary-names'));
  }, 2500);
  evidence.names = await page.getByTestId('service-addons-summary-names').innerText();
  for (const name of ['French Tips', 'Chrome', 'Glitter', 'Removal from Another Salon']) {
    if (!evidence.names.includes(name)) {
      throw new Error(`Missing add-on: ${name}`);
    }
  }
  await page.goto('http://localhost:3149/en/admin?salon=atelier-nail-demo');
  await tap(page.getByTestId('owner-nav-services'));
  await tap(page.getByTestId(`service-row-${saved.id}`));
  await tap(page.getByTestId('service-addons-summary-manage'));
  await ready(page.getByTestId('service-addon-picker'), false);
  for (const suffix of ['french-tips', 'chrome', 'glitter', 'outside-removal']) {
    if ((await page.getByTestId(`service-addon-option-video-demo-solo-addon-${suffix}`).getAttribute('aria-checked')) !== 'true') {
      throw new Error(`Selection did not survive reload: ${suffix}`);
    }
  }
  evidence.reloadVerification = 'All four actual selected relationships persisted after reopening the service.';
};

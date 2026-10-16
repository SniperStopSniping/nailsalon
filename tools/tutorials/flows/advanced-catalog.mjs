export default async ({
  page,
  tap,
  fill,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Open advanced service rules', 'Keep special booking rules separate from your daily menu.', async () => {
    await tap(page.getByTestId('owner-nav-services'));
    await tap(page.getByRole('button', {
      name: 'Advanced Settings',
      exact: true,
    }));
    await tap(page.getByTestId('services-tab-catalog'));
    await tap(page.getByTestId('catalog-section-rules'));
    await ready(page.getByTestId('rule-create-open'));
  });
  await step('Choose the rule you need', 'Required extras are different from optional add-ons.', async () => {
    await tap(page.getByTestId('rule-create-open'));
    await tap(page.getByTestId('rule-intent-limit_add_on_quantity'));
    await ready(page.locator('#rule-subject-id'));
  });
  await step('Choose the service and extra', 'This example limits Chrome on Luster Gel Manicure.', async () => {
    await tap(page.locator('#rule-subject-id'));
    await page.locator('#rule-subject-id').selectOption({
      label: 'Luster Gel Manicure',
    });
    await tap(page.locator('#rule-addon-id'));
    await page.locator('#rule-addon-id').selectOption({
      label: 'Chrome',
    });
    await fill(page.locator('#rule-max-quantity'), '1');
    await tap(page.locator('#rule-scope-service'));
    await page.locator('#rule-scope-service').selectOption({
      label: 'Luster Gel Manicure',
    });
  });
  await step('Review the rule sentence', 'Check the exact rule before it affects new bookings.', async () => {
    await page.getByTestId('rule-sentence-preview').scrollIntoViewIfNeeded();
  }, 2400);
  await step('Save the booking rule', 'Chrome stays optional, with a maximum quantity of one.', async () => {
    await post(() => tap(page.getByTestId('rule-save')), '/api/salon/catalog-rules');
    await page.getByTestId('rule-form-dialog').waitFor({
      state: 'hidden',
    });
    await ready(page.getByText(/Chrome.*1|1.*Chrome/).first());
  }, 2500);
  evidence.rules = await api('/api/salon/catalog-rules?salonSlug=atelier-nail-demo');
  if (!JSON.stringify(evidence.rules).includes('max_quantity')) {
    throw new Error('Quantity rule not saved');
  }
  evidence.scope = 'Actual scoped quantity-limit rule on an isolated synthetic service. Required/add-on engine semantics unchanged; no production menu changed.';
};

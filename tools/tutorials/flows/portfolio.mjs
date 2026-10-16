export default async ({
  page,
  tap,
  ready,
  step,
  post,
  api,
  evidence,
}) => {
  await step('Organize your portfolio', 'Keep your salon’s nail-work examples easy to browse.', async () => {
    await tap(page.getByTestId('owner-nav-more'));
    await tap(page.getByRole('button', {
      name: /^Portfolio/,
    }));
    await ready(page.getByRole('button', {
      name: 'Demo nail design 1',
      exact: true,
    }));
  });
  await step('Select the photos to tag', 'Update several related photos together.', async () => {
    await tap(page.getByRole('button', {
      name: 'Demo nail design 1',
      exact: true,
    }));
    await tap(page.getByRole('button', {
      name: 'Demo nail design 2',
      exact: true,
    }));
  });
  await step('Choose the treatment type', 'Use a service category that matches the work.', async () => {
    await ready(page.getByRole('region', {
      name: 'Batch tagging',
    }));
    await post(() => tap(page.getByRole('region', {
      name: 'Batch tagging',
    }).getByRole('button', {
      name: 'Manicure',
      exact: true,
    })), '/api/admin/portfolio');
  });
  await step('Check the saved photo tags', 'Your selected photos now show their service category.', async () => {
    await page.getByRole('region', {
      name: 'Batch tagging',
    }).waitFor({
      state: 'hidden',
    });
    await ready(page.getByText('Manicure', {
      exact: true,
    }).first());
  }, 2400);
  evidence.saved = await api('/api/admin/portfolio?salonSlug=atelier-nail-demo');
  const photos = evidence.saved.data?.photos ?? evidence.saved.photos;
  if (!photos?.filter(p => ['video-library-portfolio-0', 'video-library-portfolio-1'].includes(p.id)).every(p => p.serviceFamily === 'manicure')) {
    throw new Error('Portfolio tags not saved');
  }
  evidence.scope = 'Actual organization of insert-only synthetic example photos drawn from existing repository service assets. Cloud upload and public/Discover publication not demonstrated.';
};

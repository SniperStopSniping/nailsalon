import frenchPhoto from '../../../public/assets/images/services/manicure-french.webp';
import gelPhoto from '../../../public/assets/images/services/manicure-gel-nude.webp';

export function installReviewApi() {
  const nativeFetch = window.fetch.bind(window);
  let reads = 0;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.origin !== window.location.origin) {
      throw new Error('External requests are disabled in this isolated review.');
    }
    if (!url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const query = new URLSearchParams(window.location.search);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (method !== 'GET') {
      if (query.get('failure') === 'network') {
        throw new Error('Synthetic interrupted request');
      }
      return json({ error: { message: 'This change could not be saved. Please try again.' } }, 503);
    }
    if (url.pathname !== '/api/admin/portfolio') {
      return json({}, 404);
    }
    reads += 1;
    if (query.get('state') === 'error' && reads === 1) {
      return json({ error: { message: 'Your portfolio could not be loaded. Try again.' } }, 503);
    }
    const photos = query.get('state') === 'empty'
      ? []
      : [
          { id: 'review-french', imageUrl: frenchPhoto, altText: 'French manicure review photo' },
          { id: 'review-gel', imageUrl: gelPhoto, altText: 'Nude gel review photo' },
        ].map(photo => ({ ...photo, publicId: `review/${photo.id}`, width: 800, height: 1000, ownerVisible: true, discoverIncluded: true, serviceFamily: 'manicure', nailLength: 'short', crop: null, eligibility: null }));
    return json({
      usage: { stored: photos.length, max: 10, remaining: 10 - photos.length, overAllowance: false, plan: 'pro', source: 'plan' },
      readiness: { discoverEligiblePhotos: photos.length, retainedOverAllowance: 0, missingCrop: 0, missingServiceFamily: 0, missingNailLength: 0, unbookableFamily: 0 },
      bookableFamilies: ['manicure', 'builder_gel'],
      photos,
    });
  };
}

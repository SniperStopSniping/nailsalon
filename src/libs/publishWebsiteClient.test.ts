import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishSalon } from './publishWebsiteClient';

const fetcher = vi.fn();
const fallback = 'We could not confirm that your website is live. Your saved setup is safe. Please try again.';

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => vi.unstubAllGlobals());

describe('publishSalon', () => {
  it('requires a successful response that actually confirms publication', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ data: { publicationStatus: 'published', hasDraftChanges: false } })));

    expect(await publishSalon('test studio')).toEqual({ publicationStatus: 'published', hasDraftChanges: false });
    expect(fetcher).toHaveBeenCalledWith('/api/admin/salon/publish?salonSlug=test%20studio', { method: 'POST' });
  });

  it.each([
    ['DESIGN_IMAGES_PENDING', 'Your design images have not finished saving.'],
    ['DESIGN_PUBLICATION_UNAVAILABLE', 'Your Canva design is not ready to go live yet.'],
    ['SAVED_DESIGN_INVALID', 'Your saved website could not be checked.'],
    ['SETUP_REVIEW_REQUIRED', 'Review your website and business setup together before publishing.'],
  ])('preserves an actionable explanation for %s without showing raw diagnostics', async (code, message) => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code, message: 'Internal diagnostic that must stay private' } }), { status: 409 }));

    await expect(publishSalon('test-studio')).rejects.toThrow(message);
  });

  it('does not expose an unknown server failure', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNKNOWN', message: 'Internal diagnostic that must stay private' } }), { status: 503 }));

    await expect(publishSalon('test-studio')).rejects.toThrow(fallback);
  });

  it('does not report a successful HTTP response with an unpublished result as success', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ data: { publicationStatus: 'draft' } })));

    await expect(publishSalon('test-studio')).rejects.toThrow(fallback);
  });

  it('treats a lost response as unconfirmed without an automatic second write', async () => {
    fetcher.mockRejectedValue(new TypeError('Internal network diagnostic'));

    await expect(publishSalon('test-studio')).rejects.toThrow(fallback);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

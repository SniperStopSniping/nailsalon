/* eslint-disable import/first */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  renderBookServicePage,
} = vi.hoisted(() => ({
  renderBookServicePage: vi.fn(),
}));

vi.mock('@/app/(unauth)/book/service/BookServicePageServer', () => ({
  renderBookServicePage,
}));

import { OwnerDraftPreviewChrome } from './OwnerDraftPreviewChrome';
import OwnerBookingPagePreview from './page';

const TARGET_SLUG = 'target-salon';

async function renderPreview({
  routeSlug = TARGET_SLUG,
  searchParams = {},
}: {
  routeSlug?: string;
  searchParams?: Record<string, string | string[]>;
} = {}) {
  return OwnerBookingPagePreview({
    params: Promise.resolve({ locale: 'en', slug: routeSlug }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe('private Owner booking-page DRAFT preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderBookServicePage.mockResolvedValue('CANONICAL_BOOKING_PAGE');
  });

  /*
   * AG-hub-publish-08 wraps this route in owner chrome, so the canonical
   * renderer's output is now the chrome's `children` rather than the route's
   * own return value. Both assertions below still pin the property that
   * matters: exactly one call into the one canonical renderer, in
   * required-DRAFT mode, with the route slug authoritative — and its output
   * passed through untouched.
   */
  it('invokes the one canonical server renderer in required-DRAFT mode', async () => {
    const element = await renderPreview();

    expect(renderBookServicePage).toHaveBeenCalledWith({
      params: { locale: 'en', slug: TARGET_SLUG },
      searchParams: {},
    }, { requireOwnerDraftPreview: true });
    expect(element.type).toBe(OwnerDraftPreviewChrome);
    expect(element.props.children).toBe('CANONICAL_BOOKING_PAGE');
  });

  it('keeps the route slug authoritative over a conflicting salonSlug query', async () => {
    const element = await renderPreview({ searchParams: { salonSlug: 'other-salon' } });

    expect(renderBookServicePage).toHaveBeenCalledWith(expect.objectContaining({
      params: { locale: 'en', slug: TARGET_SLUG },
      searchParams: { salonSlug: 'other-salon' },
    }), { requireOwnerDraftPreview: true });
    expect(element.props.children).toBe('CANONICAL_BOOKING_PAGE');
  });

  it('sends the owner back to the hub and offers a chrome-free width frame', async () => {
    const element = await renderPreview();

    expect(element.props.editorUrl).toBe('/en/admin/website?salon=target-salon#preview-draft');
    expect(element.props.frameSrc).toBe('/admin/booking-page/preview/target-salon?ownerChrome=0');
  });

  /*
   * The two embedded uses of this same route must stay byte-identical to what
   * they were: the editor's live-preview iframe and the width frames the
   * chrome itself mounts. Chrome inside either would nest an owner bar in a
   * preview of the customer page.
   */
  it.each([
    ['the editor live preview', { builderPreview: '7' }],
    ['a width frame it mounted itself', { ownerChrome: '0' }],
    ['a repeated ownerChrome parameter', { ownerChrome: ['0', '0'] }],
  ])('renders the customer page alone for %s', async (_case, searchParams) => {
    await expect(renderPreview({ searchParams })).resolves.toBe('CANONICAL_BOOKING_PAGE');
  });
});

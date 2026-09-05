import { loadPublicSalonJsonLd } from '@/libs/publicSalonMetadata.server';

import BookServicePage from '../../../../(unauth)/book/service/page';

export { generatePublicSalonMetadata as generateMetadata } from '@/libs/publicSalonMetadata.server';

/**
 * The tenant service step — the page an owner's shared booking link lands on.
 * Renders the canonical `(unauth)/book/service` page unchanged, plus the
 * `LocalBusiness` JSON-LD for this salon (AG-w2-public-quick-book-03).
 *
 * The JSON-LD address comes from `buildPublicSalonJsonLd`, which redacts
 * through the same `applyLocationDisplayMode` choke point the visible page
 * uses: a `city_only` or `after_booking` salon publishes a city and nothing
 * more. `loadPublicSalonJsonLd` returns null for a draft/suspended salon, so an
 * owner preview emits no structured data at all.
 */
export default async function TenantBookServicePage(
  props: Parameters<typeof BookServicePage>[0],
) {
  const params = await props.params;
  // Structured data is decoration: if the lookup fails, the booking page still
  // renders. It must never be able to 500 the step a customer is booking on.
  const jsonLd = await loadPublicSalonJsonLd(params.locale ?? 'en', params.slug ?? '')
    .catch(() => null);
  // Awaited rather than mounted as <BookServicePage />: it is an async server
  // component, and rendering it as an element makes React treat it as an async
  // CLIENT component wherever this route is rendered outside the RSC runtime.
  const page = await BookServicePage({ searchParams: props.searchParams, params: props.params });

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          // Server-resolved salon fields only; `<` is escaped so a name that
          // contains markup cannot close the script element.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</gu, '\\u003c') }}
        />
      )}
      {page}
    </>
  );
}

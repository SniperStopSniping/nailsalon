# Public salon owner-preview context (Q04)

Date: October 8, 2026. References: F11, S90, S133; shared public salon and booking routes.

## Observed gap

The public tenant layout already checks an owner's verified identity and exact salon membership before selecting draft configuration or admitting an unpublished salon. On ordinary public salon routes, middleware did not initialize the Clerk request context consumed by that check. The earlier runtime review recorded missing-context exceptions, even though the public recovery pages rendered. This is a request-context defect, not evidence that all authentication or booking is broken.

## Scoped change

- Establish Clerk request context on public salon and shared booking-step routes only when the recognized session-cookie form is present and no legacy session takes precedence.
- Include enabled tenant-subdomain rewrites and default-locale URLs without a locale prefix.
- Mark session-bearing public salon responses private and non-cacheable. The existing tenant layout remains force-dynamic.
- Share the legacy cookie name through a small database-independent module; its value and existing export remain unchanged.

Cookie presence only selects the authentication path. The SDK still verifies identity, and the existing server gate still checks salon membership, publication status and signed impersonation. The original failure logging remains. Public visitors do not gain an authentication requirement. Locale routing, rewrites, query strings, canonical owner redirects, root management links and APIs retain their existing behavior.

## Evidence and limits

The unchanged runtime failed 34 of the 65 new middleware cases and all 11 initial composed middleware/layout cases; the pre-existing eight layout cases still passed. After the fix, the expanded 16-suite matrix passed 255 cases, including 21 layout cases backed by isolated PGlite fixtures.

Coverage includes bare and instance-suffixed session cookies, anonymous visitors, matching and wrong-salon owners, unpublished salons, published live/draft selection, SDK-rejected sessions, legacy-session precedence, tenant-host rewrites, authorized-party forwarding and private cache headers. No external fetch is allowed in the middleware unit suite.

The production build, explicit route type generation/TypeScript check, scoped lint and whitespace check passed. The tree/generated-client secret scan passed. An initial explicit typecheck caught two optional-cookie fixture typing errors; the helper was corrected without changing runtime code or assertions, and the full 255-case selection, lint and typecheck passed again. All six middleware suites also passed 101 cases (overlapping the focused selection).

These tests compose the actual middleware with the real layout, database-backed authorization and provider context; the Clerk SDK and Next request boundary are mocked in that composition. They do not prove actual hosted token validation, a complete Next request lifecycle or authenticated owner acceptance. The existing 43-case owner-preview authorization matrix is also included unchanged. No real owner credentials, customer data or provider transactions were used.

## Hosted acceptance still required

On the exact Preview commit, use an approved owner and an isolated salon fixture. Confirm its public root and booking routes show its draft; confirm signed-out and wrong-owner requests cannot see an unpublished salon or draft configuration; confirm session-bearing responses are private/no-store; confirm normal guest booking/recovery routing still renders. Check default-locale, localized and enabled tenant-host paths. Do not weaken authorization or publication guards to make a fixture accessible.

This change has no visual redesign or schema migration. Source, CI, Preview and production acceptance must be recorded separately. No release is implied by these local test results.

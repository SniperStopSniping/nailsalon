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

## Current-main refresh — 9 October 2026

Refreshed without conflicts from protected main `5b0ff4605b815ffd572aed9d749b9bf550964c92`. All 255 focused cases across 16 suites pass on each of Node 20.20.2 and Node 24.19.0. The 21 composed layout cases and existing 43-case owner-preview matrix remain included. The production build and 19 repository guards also pass.

The prior shared dependency link was preserved; this worktree now uses an isolated copy of the current installation with matching package and lockfile hashes. No new runtime, dependency, schema or authentication behavior was added during this refresh. Fresh hosted CI and the approved real-session/published-draft Preview matrix above remain release requirements under B11/B12.

Fresh route generation, TypeScript, scoped/project lint, protected-surface checks, secret scanning, commit validation and whitespace checks passed. Local results retain the mocked SDK/request-boundary limitation described above.


## Real Development-session acceptance — 9 October 2026

On Preview commit `d699c3c88313d62ab2374583b64cabf723c871d6` (refreshed against main `00c2c8f7e65d750daf223ca1b2727c0ff37ea30a`), an ordinary synthetic Clerk Development owner can open its unpublished salon and see the private draft banner and service menu. The previous Preview returned 404 for the same signed-in owner. The draft response has private/no-store cache headers. Signed-out access and an authenticated unrelated test identity are denied. The unrelated identity did not finish application workspace provisioning; this is nonmember denial evidence, not a completed second-salon owner journey.

The browser also exposed a second defect: navigating from service selection to time selection after lingering on the public page returned 404, with an expired-session diagnostic. Signing in again and repeating the transition within seven seconds succeeded. Public routes lacked the frontend Clerk provider that renews the short-lived token; dashboard and authentication routes already have one.

The follow-up change mounts Clerk only when a recognized Clerk session cookie exists and no legacy admin session takes precedence. It covers the salon-slug layout and both shared booking layouts. These route branches do not nest, so the SDK mounts once per entry. Anonymous and legacy sessions retain their existing paths. The provider does not authorize access: unchanged server-side identity, membership, publication and impersonation checks still decide every request.

The expanded local matrix passes 266 cases across 17 suites on both Node 20.20.2 and Node 24.19.0. Eleven new cases cover provider selection and shared/localized layout wiring; the composed tenant-layout cases verify one provider for a Clerk owner and none for legacy login. SDK behavior remains mocked in these tests. A fresh hosted browser test must leave the owner on the service page beyond the token lifetime, then verify navigation still succeeds; local tests alone do not establish renewal.

Time selection on the unpublished fixture also shows an availability error because the availability API denies unpublished salons. No appointment was submitted and no publication guard was bypassed. This remains a separate preview limitation to diagnose, not evidence that published customer bookings fail.

Pre-follow-up hosted CI run `37980641306` encountered a Next Google-font loader error in the Node 20 application build. Local and Vercel builds for that commit succeeded; the cause of the hosted font response has not been established. Required hosted checks and the full authenticated matrix remain release gates. No production deployment, customer messages or payment actions are implied by this evidence.

The follow-up also passes production build, explicit route generation and TypeScript, scoped/project lint, 19 repository guards, protected-surface checks, commit validation and whitespace checks. The first new table-driven unit test had an incorrectly nested test fixture; its table shape was corrected, and the complete 266-case selection passed on both runtimes. No runtime behavior was changed to accommodate the fixture.

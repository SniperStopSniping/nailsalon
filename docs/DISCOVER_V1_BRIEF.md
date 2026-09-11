# Luster Discover V1 — Production Implementation Master Plan

**Revision 2 (repo-grounded). Supersedes every earlier Discover draft.**
Repository baseline verified read-only against `origin/main` `34efe525335bd417fbd9a1e60de95fb77d60a9d3` (v1.60.0, 2026-08-17).

---

## 0. Authority and Working Agreement

This document is the authoritative implementation specification for Luster Discover V1.

It does **not** authorize autonomous execution of all five PRs. Each PR requires separate explicit authorization, review, and approval before the next PR begins. The docs-only task that creates this file must not modify application source code.

Cross-track authority:

* `docs/luster-billing-communications-rev-2-2.md` remains **authoritative for billing, communications, and plan architecture**. Its §5 is binding here: the new billing domain must not write `salon.plan` or feature entitlements, the legacy plan system remains authoritative for feature access, and feature-matrix migration is a separately approved future track. Discover integrates with that domain but must not silently redefine it.
* The owner's Revision 7.1 contract and its approved Gate outcomes remain authoritative for the L1 catalog/booking track (in-repo baseline: `docs/luster-implementation-handoff.md`).
* Any conflict between this brief and either track is escalated as **`CROSS-TRACK CONFLICT — OWNER REVIEW REQUIRED`** — never resolved by an architectural rewrite inside a Discover PR.

Do not create a separate application, a second booking system, a second business profile system, a second service catalogue, or a parallel media library. Extend the existing Luster platform using its real architecture as documented in §6.

---

## 1. Product Mission

Build a lightweight consumer discovery feature called **Luster Discover** with two main client experiences:

1. **Nails Near Me**
2. **Find Your Perfect Nails**

The client can:

1. Share or enter their approximate location.
2. Browse nearby nail businesses.
3. See the approximate distance to each business in kilometres.
4. See the business name and several nail photos.
5. Filter nail photos by service family, length, and travel distance.
6. Swipe through local nail photos.
7. Pass photos they do not like.
8. Heart and save photos they like.
9. Review saved photos later.
10. Open the business's minimal public profile.
11. Book through the existing Luster booking flow from there.

Client value proposition: **Find nail work you love from nail businesses near you.**

Business value proposition: **Upload your portfolio once and let nearby clients discover your work.**

---

## 2. Core V1 Journey

Open Discover → choose Nails Near Me or Find Your Perfect Nails → set location → choose Gel-X, Long, 10 km → swipe → heart favourites → open Saved Nails → View Profile → see the business's portfolio and services → Book Appointment → existing Luster booking flow.

The profile step is deliberate: someone who just hearted a photo should land on a small salon profile — more of the work, who did it, where, and a Book button — not directly inside a service picker.

Anything that does not directly improve this journey is presumed out of scope.

---

## 3. Product Principles

### 3.1 Keep the client experience extremely simple

Swipe setup asks only: **service family, length, maximum travel distance.** Do not require colour, shape, art style, price, availability, appointment date, business type, or any client profile information.

### 3.2 Browsing does not require an account

Anonymous clients must be able to browse, swipe, pass, save, open Saved Nails, and view profiles without signing in. This matches the platform: booking is guest-only today, and client sessions are permanently disabled by design (`src/libs/clientAuth.ts` returns `null` unconditionally — a documented security floor; `src/libs/clientApiGuards.ts` returns 410 for every client-session route). Do not recreate the retired client portal or introduce client authentication for this feature.

For V1:

* Saved photo IDs live in versioned `localStorage`; details are always re-fetched from the server.
* Swipe UI-restoration state lives in versioned `sessionStorage` (see §32 for exactly what the browser may hold — never coordinates, never authoritative pass history).
* The interface says **Saved on this device** where appropriate. Cross-device syncing is not promised.

### 3.3 The photo is the primary interface

The nail photo dominates the swipe card. No long descriptions, menus, policies, schedules, comments, follower counts, or badge collections.

### 3.4 Heart means save for later

Actions are Pass, Heart/save, View Profile. Hearting advances immediately, shows a small non-blocking animation, never opens a modal, never notifies the business. There is no mutual matching.

### 3.5 Discovery and direct booking remain separate

Never show competitors on a business's own pages: not on its profile, and not during service selection, checkout, deposits, confirmation, rescheduling, or appointment management. A business must be able to share its own Luster URL without Luster redirecting its clients to competitors. Clients enter the marketplace only by opening Discover.

### 3.6 Higher plans provide more portfolio capacity, not better ranking

A higher plan allows more stored photos. It must never buy top placement, higher organic ranking, more first-position appearances, or impressions. Exposure stays fair (§18).

### 3.7 Never silently loosen filters

Every displayed photo satisfies the client's exact filters. When supply is insufficient, say so and let the client explicitly relax a filter (§15). Never quietly insert non-matching or untagged photos to pad a deck.

---

## 4. Explicit V1 Scope

Build:

* Discover landing page with the two entry choices
* Client location setup with manual area/postal-code fallback
* Opaque server-side Discover location session (§10)
* Nails Near Me: up to 10 eligible businesses per page, Show More pagination
* Approximate distance in kilometres
* **Minimal public salon profile page** (§12) — net-new
* **Canonical salon portfolio system** (§21) — net-new
* Durable publication-rights confirmation on every portfolio upload
* Service-family, length, and distance filters
* Minimum-supply gate with production and pilot thresholds
* Fair business interleaving with a server-owned swipe session
* Swipe/pass/heart interactions with visible accessible controls and a saved counter
* Saved Nails with anonymous local persistence and server rehydration
* Owner tagging, batch tagging, Discover crops, Discover opt-in, Preview Discover
* Portfolio photo limit as a centralized entitlement with per-salon override
* PostHog analytics behind a thin Luster wrapper
* Admin kill switches, pilot allowlist, readiness diagnostics
* Accessibility, privacy protections, feature-flagged local pilot

## 5. Explicitly Out of Scope

Do not build: native apps; map views; driving distance or travel time; AI tagging, scoring, or recommendations; Instagram import or scraping; comments, public like counts, followers, messaging, matching, or notifications for hearts; stories/reels/boards/polls/social sharing; Google/Yelp review importing; **any rating or review display (V1 shows no stars anywhere — see §6.6)**; a new review-submission system; price/availability/colour/shape/complexity filters; "Book This Look" or photo-specific pricing/duration/preselection; commissions, sponsored listings, or paid ranking; Smart Fit integration; referral programs; client accounts for favourite syncing; nationwide SEO landing pages; a bio/description field (none exists — do not add one for Discover); percentage-based rollout (the repo has no such mechanism); "promote appointment photo to portfolio" (post-V1 — requires a real client-consent model); the verified-review system (explicitly post-V1: completed Luster appointment → review request → verified review — it must not delay Discover).

Do not create speculative architecture for future features. Create clean extension points only where V1 naturally produces them.

---

## 6. Repository Ground Truth

The blind repository audit is done; its findings are baked in below and were re-verified against the baseline SHA above. Spot-check any fact that looks drifted before relying on it, but do not re-audit from scratch.

### 6.1 Tenancy, routes, and the missing profile page

* The salon **is** the tenant (`salonSchema` in `src/models/Schema.ts`; ~40 tables cascade on `salonId`). `organizationSchema` is vestigial boilerplate.
* **There is no public salon profile page.** `src/app/[locale]/[slug]/page.tsx` re-exports the booking entry — `/{locale}/{slug}` lands in the booking flow. Nothing public renders `salon.logoUrl`, `salon.coverImageUrl`, a portfolio, or reviews. There is no bio/description column.
* Tenant resolution: `src/libs/tenant.ts` (`resolveSalonSlug`: route param → query param → `__active_salon_slug` cookie), slug rules in `src/libs/tenantSlug.ts`, URL builders in `src/libs/publicUrl.ts` / `src/libs/bookingParams.ts`. `/book` is the stable external booking entry.
* Eleven legacy client-account routes are dead `notFound()` stubs; `src/app/(unauth)/gallery/GalleryContent.tsx` is unreachable but polished swipe/lightbox UI (framer-motion, haptics) — the best in-repo visual precedent for Discover cards, alongside `src/components/admin/SwipeablePages.tsx` and the staff `SwipeableCard`.
* There is no persistent public header/nav/footer. Discover introduces Luster's first cross-tenant public chrome and its **first anonymous cross-tenant read surface** — every existing `/api/public/*` route is token-scoped. Expect and welcome review scrutiny on this.

### 6.2 Location

* **No geo exists.** No latitude/longitude columns, no geocoding provider, no PostGIS, no distance code anywhere. Address fields on `salonSchema` and `salonLocationSchema` are nullable free text. The only mapping code is `src/libs/directions.ts` (a Google Maps directions URL).
* `salon_location` is **canonical** for addresses: the owner address editor updates only `salon_location`, never `salon.*` (which holds stale onboarding data). All Discover location work reads/extends `salon_location`.
* Multi-location is modeled but effectively off (`maxLocations` default 1; CRUD is super-admin-only; `technician.primaryLocationId` has no FK). **V1 treats every business as having one primary location** while keeping photo→location association schema-compatible with a multi-location future.
* The anonymous booking confirm step currently reveals the exact street address pre-booking. This is a pre-existing behavior with consequences for Discover (§11).

### 6.3 Media

* **There is no salon portfolio.** No portfolio/gallery/media table exists. What exists must not be repurposed:
  * `appointment_photo` — per-appointment before/after shots keyed to a client's phone number. Its `isPublic` column is dormant (never written true). **These are client records, not marketing assets. Leave them completely alone** (§21).
  * `appointment_artifacts` — 1:1 workflow gate photos. `service.imageUrl` — one hero image per service row.
* Uploads are **Cloudinary-only**; `next.config.mjs` `images.remotePatterns` allows exactly `res.cloudinary.com`. Cloudinary and Redis are fail-closed dependencies on the presign path (503 when unconfigured).
* The hardened upload precedent to imitate is `src/libs/serviceImageStorage.server.ts`: signed upload preset, sharp-based magic-byte/format sniffing, dimension and pixel caps, EXIF dropped on re-encode, pending→active state machine with HMAC finalize tokens, GC cleanup route, and a Redis Lua presign rate limit (`src/libs/serviceImagePresignRateLimit.server.ts`). The legacy appointment-photo path validates MIME only by client-declared `file.type` — do not copy it.
* A 4:5 transform already exists: `getInstagramSafeUrl()` in `src/core/autopost/cloudinaryUrl.ts` (`w_1080,ar_4:5,c_fill,g_auto,f_auto,q_auto`) — exactly the swipe-card ratio.
* The autopost pipeline (`autopost_queue`) independently consumes "after" appointment photos for social posting. Autopost and Discover are **independent systems over different photo sets**: posting to Instagram implies nothing about Discover, and vice versa.

### 6.4 Service taxonomy

* Three taxonomies exist: `serviceCategoryEnum` (admin), `bookingCategoryEnum` + `VISIBLE_BOOKING_CATEGORIES = ['manicure','pedicure','combo']` (client-facing, with an explicit policy comment that these are the only main categories any user-facing surface may show — `src/libs/bookingCategory.ts`), and `SERVICE_TEMPLATE_CATEGORIES` (owner library shelves in `src/libs/serviceTemplateCatalog.ts`).
* Gel-X/Acrylic/Builder Gel exist today only as `templateKey` values. `src/libs/serviceImage.ts` carries the closest thing to a nail-style taxonomy (templateKey→family mapping with longest-prefix matching and a name-based classifier). Discover's photo taxonomy builds on these semantics (§14) and **consciously amends** the `bookingCategory.ts` policy comment rather than silently violating it.

### 6.5 Plans, billing, entitlements

* Legacy feature plans: `SALON_PLANS = ['free','single_salon','multi_salon','enterprise']` on `salon.plan`, mapped to tiers in `src/libs/featureTiers.ts` and limits in `src/libs/planLimits.ts` (only `maxTechs`/`maxLocations` exist; only the technician limit is actually enforced, via a **non-race-safe** count-then-insert — do not copy it for photos).
* The commercial catalogue (Free / Starter / Pro / Elite) lives in the billing track (`docs/luster-billing-communications-rev-2-2.md`, `src/libs/billing/`). Per that contract's §5: the billing domain never writes `salon.plan` or features; **feature entitlements remain on the legacy system**; a salon may be `starter_2026_08` for billing while legacy `single_salon` for features. The Stripe webhook does not write `salon.plan` — the field is set by Super Admin. Discover must key its entitlement on the legacy system (§25) and never read or write `billing_subscription` for feature access.
* Entitlement architecture: `src/libs/featureGating.ts` (three layers — Super Admin entitlement in `salon.features`, admin enable in `settings.modules`, staff visibility; `effective = entitled && adminEnabled`), registry in `src/libs/salonFeatureRegistry.ts`, per-salon override precedent (`override ?? planDefault`, with audit provenance) in `src/libs/featureEntitlements.ts`, numeric per-salon override precedent `salon.maxLocations`. A `photoUploads` entitlement exists but is enforced nowhere.
* Founding/promo precedent: `salon.freeSoloEnabled` + invite metadata.

### 6.6 Reviews and ratings — why V1 shows none

The in-app review system is dead code: the submit route requires the permanently disabled client session (410 for every caller), the submit UI is imported nowhere, and the `review` table has no production writer. The numbers displayed publicly today are `technician.rating`/`technician.reviewCount` — **hand-entered by salon staff** in an admin "Public Reputation" section, and seeded for the flagship tenant by a checked-in script. There is no salon-level rating and no provenance flag separating seeded from earned.

Surfacing salon-authored numbers beside competing salons would present them as Luster-verified social proof. Discover V1 therefore shows **no stars and no review counts anywhere**. The formatter `getPublicTechnicianRatingDisplay()` (`src/libs/technicianRating.ts`) exists if a verified system ever changes this.

### 6.7 Analytics

**No product-analytics stack exists** — no PostHog/Segment/GA/anything; "analytics" in-repo means owner revenue dashboards. Existing server-side primitives: structured pino logging with a PII denylist (`src/core/logging/logger.ts`) and the typed append-only audit log (`src/libs/auditLog.ts`, explicit no-raw-PII rules). Discover introduces PostHog behind a thin wrapper (§35).

### 6.8 Redis, rate limiting, DTOs, guards

* Redis: `ioredis` singleton (`src/core/redis/redisClient.ts`, `null` when `REDIS_URL` unset), key/TTL registry and owner-checked Lua lock scripts in `src/core/redis/keys.ts`.
* `src/libs/rateLimit.ts` is **in-memory, per-instance** — effectively no limit on Vercel. It is **forbidden** for Discover endpoints. The model to extend is `src/libs/publicBookingRateLimit.server.ts`: hardened trusted-proxy IP extraction (Vercel-aware, rightmost-first), multi-window atomic Lua limits, hashed identifiers (no raw IPs in Redis), scoped degradation logging.
* DTO discipline: whitelist construction per `src/libs/redact.ts` ("hidden fields do not appear at all") and `mapPublicTechnician()` in `src/libs/publicBookingTechnicians.ts` as the public-preview template. Enumeration-resistant byte-identical responses per the public recovery route.
* Guards: discriminated-union families — `requireAdminSalon()` (`src/libs/adminAuth.ts`), composite `src/libs/routeAccessGuards.ts`, `checkSalonStatus()`/`guardSalonApiRoute` (`src/libs/salonStatus.ts`), first-class super-admin with per-salon entitlement routes.

### 6.9 Tests, CI, migrations, conventions

* Unit tests colocated `src/**/*.test.ts(x)` against in-memory PGlite; real-Postgres suites use `*.integration.test.ts` naming with dedicated env-gated CI jobs and zero-skip assertions; Playwright gate suite follows `tests/e2e/core.<actor>-<capability>.e2e.ts`; e2e fixtures default to salon `nail-salon-no5` / tech `Daniela`; `vitest-fail-on-console` fails on any console output; local `npm test`/`npm run lint` are changed-files-only (`test:all`/`lint:all` for full runs).
* **Migrations are hand-written SQL plus a manual `migrations/meta/_journal.json` entry; `drizzle-kit generate` is deliberately banned.** Do not pin migration numbers in planning documents — use the next available number at implementation time (0069/0070 were consumed by the billing/communications track).
* House conventions: Zod on every route body; `{ error: { code, message } }` error shape; `export const dynamic = 'force-dynamic'`; `import 'server-only'` in `*.server.ts`; nanoid text PKs; conventional commits + semantic-release; `AGENTS.md` and `docs/AI_RULES.md` are binding.
* Accessibility tooling is lint-time only (eslint jsx-a11y); there is no axe runtime testing. Sentry has **no `beforeSend` PII scrubbing** — keeping coordinates out of Sentry is a discipline requirement (§31), optionally hardened with a narrow `beforeSend`.

---

## 7. Implementation Gotchas (binding)

1. **Reserve the slug.** `RESERVED_PUBLIC_SEGMENTS` in `src/libs/tenantSlug.ts` does not include `discover`; a salon could claim it today, and adding the static route would silently 404 that salon. PR2 adds `discover` to the set and updates `tenantSlug.test.ts`.
2. **Ignore the tenant cookie.** Middleware writes a 30-day `__active_salon_slug` cookie on nearly every request. Discover routes must resolve tenants explicitly and never fall back to this cookie, or a stale tenant bleeds into the anonymous surface.
3. **Caching is opt-in.** The locale/slug layouts are `force-dynamic`; every Discover request hits the DB unless caching is designed explicitly.
4. **Explicit eligibility predicates.** `getSalonBySlug()` filters only `isActive` — not `deletedAt`, `publicationStatus`, or `status`. A naive listing query returns soft-deleted, draft, and suspended tenants. All Discover queries use the explicit predicates in §26.
5. **In-memory rate limiting is forbidden** on Discover endpoints (§6.8).
6. **`salon.plan` is manually curated** (§6.5). Do not "fix" billing sync inside Discover PRs — `CROSS-TRACK CONFLICT — OWNER REVIEW REQUIRED` if it blocks.
7. **Purge wiring.** Every new table must be wired into `src/libs/salonPurge.ts` (as `appointment_photo` is) or tenant deletion and its integration suite break.
8. **Cloudinary-only images**; new hosts require a `next.config.mjs` change and review.
9. **No console output in tests**; local test/lint scripts are change-scoped.
10. **`salon_audit_log.action` is untyped free text** — new audit actions there get no compile-time safety; prefer the typed `AUDIT_LOG_ACTIONS` table.

---

## 8. Working Method — Five Separately Authorized PRs

Implement through five tightly scoped, individually reviewable PRs. Each starts from a verified current base, includes tests, documents migrations, avoids unrelated refactoring, preserves existing booking/payment behavior, and ends as a draft PR. **Do not begin a PR until the previous PR is approved or merged and the next PR is separately authorized.**

### PR1 — Portfolio foundation and plan limits

Net-new canonical portfolio system:

* Hand-written migration (next available number) + `_journal.json` entry: portfolio media table + business discovery settings.
* Hardened Cloudinary upload path modeled on `serviceImageStorage.server.ts` (signed preset, content sniffing, dimension caps, pending→active finalize, GC, presign rate limit).
* **Durable publication-rights evidence** on every upload (§21).
* Discover service-family tag + length tag (taxonomy per §14, including the conscious `bookingCategory.ts` policy amendment).
* Owner visibility, Discover inclusion, crop/focal-point data, sort order, alt text.
* Batch tagging (§22), reordering, delete/hide, business-level Discover opt-in, Preview Discover foundation (§21).
* Central **Portfolio photo limit** entitlement + per-salon numeric override + race-safe server enforcement + non-destructive downgrade (§25).
* `salonPurge.ts` wiring. Unit + integration tests.
* `appointment_photo` is not touched, migrated, or referenced.

### PR2 — Minimal public profile and analytics foundation

* Dedicated profile route (§12) — existing `/{locale}/{slug}` booking behavior unchanged.
* Profile content: logo if available, name, public area, portfolio grid (`profileEligible` photos), up to ~3 service-family labels derived from active bookable services, sticky Book Appointment → existing booking flow. No ratings, no bio, no map, no staff directory, no availability.
* Discover-context approximate distance shown only when the visitor holds an active Discover location session.
* PostHog installation + thin `analytics` wrapper, anonymous-only configuration (§35); initial profile events.
* Reserve `discover` in `RESERVED_PUBLIC_SEGMENTS` + test update.

### PR3 — Location foundation and Nails Near Me

* `salon_location` geo fields with the private/public split (§11), privacy mode, public area label, geocoding status.
* Narrow geocoding abstraction (no provider exists — provider choice documented with env vars; geocode on save/update, never per search; admin/white-glove backfill path for messy nullable addresses).
* Opaque Redis-backed client location session (§10), ~2h TTL via the `keys.ts` registry.
* Bounding-box prefilter + tested Haversine; privacy-safe distance formatting.
* Public-safe nearby DTO (§29); up to 10 eligible businesses per page + Show More (§13); explicit eligibility predicates (§26).
* Redis-backed anonymous rate limiting (§30); Discover routes ignore `__active_salon_slug`.

### PR4 — Swipe and Saved Nails

* Three-filter setup; minimum-supply gate with production + pilot thresholds (§15).
* Server-issued swipe session in Redis as the **single deduplication source** (§18); adaptive business round-robin; opaque cursor.
* 4:5 optimized card images (reusing the `getInstagramSafeUrl` transform pattern), preloading (§19).
* Pass/heart with gestures, visible buttons, keyboard support; saved counter in the swipe header (§17).
* View Profile with full UI restoration on return (§32).
* Saved Nails: versioned localStorage IDs, capped server rehydration, empty/completed states (§20, §34). No silent filter relaxation anywhere.

### PR5 — Hardening and pilot

* Remaining analytics events; booking attribution through completion where safely possible (§36).
* Env kill switch, per-salon entitlement gating, pilot allowlist (§43).
* Preview Discover polish; admin eligibility/readiness diagnostics (§39).
* Accessibility verification; mobile performance verification with recorded measurements (§40).
* Storybook stories for reusable Discover presentation components (nearby card, swipe card, saved item, profile grid, loading/empty states) — not route wrappers. Checkly smoke check using the `*.check.e2e.ts` convention.
* Production-like E2E supply seeds; full e2e suite (§41); pilot readiness report including the home-studio launch gate (§11) and the explicit content-reporting decision (§39).

---

## 9. Public Information Architecture

Follow existing route conventions. Conceptual routes (adapt if the repo suggests better):

* `/{locale}/discover` — landing
* `/{locale}/discover/nearby`
* `/{locale}/discover/swipe`
* `/{locale}/discover/saved`
* `/{locale}/{slug}/profile` — minimal public salon profile (§12)

The landing page contains only the two primary choices:

> **Find your perfect nails** — Choose what you like and swipe through nail work near you. → *Start Swiping*
> **Nails near you** — Browse local nail businesses, distance, and recent work. → *Browse Nearby*

No trend sections, blog content, featured businesses, stories, videos, map previews, or marketing clutter.

---

## 10. Location Experience

### 10.1 Permission

Never auto-trigger browser geolocation on load. Show **Use My Location**; request permission only after the tap. Explain: *"We use your location to show nail businesses and nail photos within your travel distance."*

### 10.2 Manual fallback

On denial/unavailability: **Enter a city, area, or postal code.** Resolves to an approximate search point — never a full home address. No geocoding provider exists (§6.2): introduce a narrow abstraction, isolate provider code, document env vars, fail gracefully when unconfigured, and never depend on an unofficial public endpoint.

### 10.3 Opaque server-side location session (binding)

1. Client submits geolocation or a manual area to a POST endpoint (never query strings).
2. Server validates ranges and creates a short-lived **opaque Discover location token**.
3. Location state lives server-side in Redis (registered in `src/core/redis/keys.ts`); the browser stores only the opaque token in `sessionStorage`.
4. Nearby and swipe requests carry the token. TTL ≈ 2 hours (adapt to repo conventions).
5. Manual fallback resolves to the same session type.

Coordinate rules:

* **Exact client coordinates never persist in the database** and never appear in browser storage, URLs, PostHog, Sentry contexts, or application logs — the server-side ephemeral store is the only place they exist, briefly.
* **Exact private-studio coordinates may exist only in protected operational location fields** (the private appointment location, §11) and must never appear in public Discover DTOs, browser storage, analytics, Sentry contexts, or logs.

### 10.4 Radius

Choices: 5 / 10 / 20 / 50 km. Default 10 km. 50 km is the server-enforced maximum. No worldwide search.

### 10.5 Distance calculation

Tested Haversine over a bounding-box prefilter; no driving-route APIs. Commercial display: one decimal below 10 km ("2.4 km away"), whole kilometres at/above 10 km. Private-studio display per §11.

---

## 11. Home and Private Studio Privacy

Keeping exact coordinates server-side is necessary but not sufficient — repeated distance queries can triangulate a private studio. The location model distinguishes:

**Private appointment location** — exact address and coordinates, used by authorized booking/operations flows only. Never used directly in public Discover responses.

**Public discovery location** — an intentionally approximate point: neighbourhood/postal-area centroid, owner-selected approximate point, privacy-adjusted or grid-snapped point. Discover computes all public distances for private/home studios from this point.

For private/home studios: show "Approx. 3 km away" (nearest whole km), "Under 1 km" instead of precise sub-kilometre values, and only a public area label. Never return exact coordinates or the private address. Rate-limit repeated location probing (§30). Commercial storefronts may use their true public storefront coordinates under existing public-address rules. Owners must be able to preview exactly what clients see.

Field naming must make misuse difficult — private and public coordinates never share an ambiguous column.

### Binding public-rollout gate

> A private or home-studio business must not be enabled in a public Discover rollout while the existing anonymous booking flow reveals its exact address before the authorized disclosure point. Before enabling a private studio, either the address-disclosure issue is corrected in a **separately authorized security/privacy PR**, or the business remains excluded from Discover. Commercial storefronts with intentionally public addresses are unaffected.

The booking-confirm address reveal (§6.2) is documented, pre-existing behavior; fixing it is **out of scope for the five Discover PRs** and is tracked as a separately authorized follow-up. This gate appears again in pilot eligibility (§38), the PR5 readiness report, the Definition of Done (§44), and Known Limitations (§46). Isla's commercial location can still be the first pilot.

---

## 12. Minimal Public Salon Profile

A small canonical profile — not a website builder, not the future customizable Luster site.

Contains only:

* Business logo when available (`salon.logoUrl` — currently rendered nowhere; this is its first surface)
* Business name
* Public area / neighbourhood label
* Approximate distance **only when the visitor holds an active Discover location session** (no session → no distance line)
* Portfolio photo grid (`profileEligible` photos, owner order)
* Up to ~3 service-family labels **derived from the business's currently active, publicly bookable services** (never from historical photo tags alone)
* Sticky **Book Appointment** CTA → the existing `/{slug}/book` flow via `buildBookingUrl`/`appendSalonSlug`

Does not contain: ratings, reviews, a bio (no field exists; do not add one), maps, staff directory, availability calendar, pricing tables, policies, social feeds, or competitor content of any kind.

Routing: a dedicated route (conceptually `/{locale}/{slug}/profile`). **Existing `/{locale}/{slug}` behavior — redirect into booking — is preserved.** Do not repurpose existing public URLs; any future change to `/{slug}` root behavior requires explicit gating and separate owner approval. If repository routing constraints make the dedicated route unworkable, document the alternative and require explicit approval before touching `/{slug}` semantics.

The profile page must resolve its tenant from the route slug explicitly (never the `__active_salon_slug` cookie) and apply the §26 business-eligibility predicates plus `checkSalonStatus()` semantics.

---

## 13. Nails Near Me

### 13.1 Result identity

Each result is a business's primary location (single-location V1, §6.2). Distance is calculated to that location's public discovery point; the card links to that business's profile.

### 13.2 Pagination

Return **up to 10 eligible businesses per page** — a page with six eligible businesses is valid. **Show More** loads the next page. No infinite scroll. Pagination is deterministic, duplicate-free, stable under distance ties, cursor-based (opaque, server-capped, expiring).

### 13.3 Sorting

Distance ascending, then a stable deterministic tie-breaker. Never influenced by plan, photo count, popularity, or spend.

### 13.4 Card contents

* Business name
* Public area / neighbourhood
* Approximate distance (privacy-formatted per §11)
* Up to three cropped square thumbnails (`discoverEligible` photos)
* Up to three service-family labels derived from active bookable services
* **View Profile** CTA

Example:

> **Isla Nail Studio**
> Scarborough · 2.3 km away
> [Photo] [Photo] [Photo]
> Builder Gel · Gel-X · Hard Gel
> *View Profile*

No ratings, full menus, full addresses, descriptions, policies, pricing, staff lists, availability, or more than three images.

### 13.5 Photo eligibility on cards

Three or more `discoverEligible` photos → show three; two → two; one → one. Never duplicate a photo to fill slots. Never serve original high-resolution uploads as thumbnails. A business with zero `discoverEligible` photos does not appear in Discover.

---

## 14. Find Your Perfect Nails — Filters and Taxonomy

Ask only three questions; defaults let the client start immediately.

### 14.1 Service family

The Discover **service family** is photo-level browsing metadata. It is explicitly **not** a booking category and **not** the authoritative service identity — the service catalogue remains in control of what is bookable. PR1 amends the `VISIBLE_BOOKING_CATEGORIES` policy comment in `src/libs/bookingCategory.ts` so the codebase no longer claims manicure/pedicure/combo are the only user-facing categories anywhere, and documents the Discover taxonomy as a deliberate, separate browsing dimension.

The initial family list must be **derived from the real service catalogue** — `templateKey` semantics in `src/libs/serviceTemplateCatalog.ts` and the family/prefix logic in `src/libs/serviceImage.ts` — not invented. Likely candidates: Gel-X, Acrylic, Builder Gel / BIAB, Hard Gel, Gel Manicure, Natural Manicure, plus Any/UNSPECIFIED as query semantics. The final enum is ratified in PR1 review.

**Tags must map to current offerings (binding):** a photo's service-family tag must correspond to at least one currently active, publicly bookable service of that business. Owners can only select families valid for their active catalogue. If the last corresponding service becomes inactive or unbookable, affected photos become Discover-ineligible (they remain profile-visible if otherwise eligible) until the service is restored or the photos are retagged. This prevents a client filtering "Acrylic" from discovering a business that no longer offers acrylic.

### 14.2 Length

Any / Short / Medium / Long / XL (stored: SHORT, MEDIUM, LONG, XL, UNSPECIFIED).

### 14.3 Distance

5 / 10 / 20 / 50 km, default 10.

### 14.4 Filter behavior

A compact Filters control exists after swiping begins. Changing filters creates a new deck (new server session), preserves saved photos, and clearly shows when nothing matches. Untagged (UNSPECIFIED) photos may appear only under Any+Any if product policy allows, never for specific filters, and never count toward minimum supply for a filter they cannot satisfy. No additional filters in V1.

---

## 15. Minimum-Supply Gate

Do not open a swipe deck without useful variety.

* **Production/default thresholds (configurable, not scattered magic numbers):** at least 12 eligible photos from at least 4 distinct eligible business locations.
* **Pilot/internal mode (explicit, config-driven):** lower thresholds so Isla alone can be manually tested behind the allowlist.
* **Automated E2E tests must seed production-like supply** and exercise the production thresholds and fairness behavior — never a one-business special-case configuration.

When thresholds are not met, never silently relax filters. Show *"We don't have enough matching nails nearby yet."* with explicit choices: Show Any Length · Choose Any Service · Increase to 20 km · Browse Nails Near Me. The client chooses the relaxation.

**Market-level public launch gate:** do not publicly promote Discover in a market before roughly 10 active participating business locations, 100 eligible cropped photos, coverage across major service families, working profiles and booking links, and no serious image-performance problems. The internal pilot may begin far smaller; the public launch may not.

---

## 16. Swipe Card

The photo dominates. A card contains only:

* Large 4:5 nail image
* Business name
* Approximate distance (privacy-formatted)
* Service-family tag · Length tag
* Pass control · Heart control
* View Profile control

No ratings, captions, comments, save counts, prices, availability, policy text, engagement stats, or tag clouds.

---

## 17. Swipe Actions

### 17.1 Pass

Swipe left / Pass button / keyboard Left Arrow. Advances immediately. A pass is session-scoped (server session, §18): the photo does not reappear in the current deck, the business is not penalized, and nothing is stored permanently.

### 17.2 Save

Swipe right / heart / keyboard Right Arrow. Saves the public photo ID locally, shows a small non-blocking confirmation, advances immediately. No modal, no navigation, no business notification, no sign-in.

### 17.3 Saved counter

The swipe header shows a small live counter (e.g. **❤️ 6**) reflecting locally saved favourites. It updates immediately, never interrupts swiping, is accessible (visible text + ARIA), requires no sign-in, and tapping it opens Saved Nails. No further social mechanics.

### 17.4 View Profile

Opens the business's profile (§12) with a safe attribution marker (§36), preserving deck state. Returning restores filters, location session, position, and loaded cards (§32). Back never restarts the deck.

---

## 18. Fair Swipe Sequencing

A business with 75 photos must not drown a business with 10.

**Adaptive business-level round-robin (required):**

1. Apply the exact service-family, length, and radius filters; exclude ineligible photos (§26).
2. Group eligible photos by business location.
3. Shuffle eligible businesses with a stable server-issued session seed.
4. Shuffle photos within each business group with the same seed.
5. Take one photo from each business per round; start a new round only after every currently eligible business has had an opportunity.
6. Never show the same business twice consecutively when at least two eligible businesses remain.
7. Continue until the batch fills or inventory is exhausted.

No other spacing constants. Never weight by plan, portfolio size, spend, headcount, or revenue.

**Server session is the single deduplication source (binding):** the server/Redis session owns the seed, already-served photo IDs, deck progression, cursor state, and TTL (keys registered in `src/core/redis/keys.ts`). The browser owns UI restoration only (§32) and **never** sends a growing excluded-photo list; the opaque cursor is server-referenced (or signed/encrypted), capped, and expiring, and prevents duplicates across batches.

---

## 19. Swipe Batching and Image Loading

Fetch modest batches (~20 cards initially, ~20 per continuation; tune after measuring payloads). Never load a full portfolio into the browser. Preload the current and next image (optionally one more) — never dozens. Use responsive variants, explicit dimensions, stable 4:5 aspect-ratio containers, CDN caching, and lazy loading. The next card should feel instant on a normal mobile connection.

---

## 20. Saved Nails

A simple locally persisted list, labeled **Saved on this device**.

Each item: current photo, business name, public area, approximate distance when a location session exists, service-family + length tags, View Profile, Remove. No ratings.

**Storage:** versioned localStorage key holding ordered public photo IDs (+ timestamps if useful), capped (~100). Never store addresses, coordinates, contact data, or full business DTOs.

**Rehydration:** send the capped ID list to the server; the server returns current public-safe data for photos that are `discoverEligible` (if product policy later allows saved photos to remain visible while merely Discover-excluded, that policy must be explicitly documented and tested — the default is `discoverEligible`). Stale IDs are pruned from localStorage. Deleted/hidden/suspended/over-limit content disappears. Local data is never authoritative.

---

## 21. Owner Portfolio Experience

**This is Luster's first canonical salon portfolio — a net-new system** (§6.3). One photo library per business, powering the profile grid, nearby thumbnails, and the swipe deck. Do not create per-surface libraries.

**Photo supply is fresh owner uploads only.** `appointment_photo` records are client before/after records tied to phone numbers: do not migrate them, do not auto-publish them, do not infer consent from them, and do not build "promote appointment photo" in V1 (post-V1, requires a real client-consent model).

**Publication-rights confirmation (binding):** every upload requires the owner to confirm — *"I confirm I have permission to publicly display this image."* — and the confirmation must create **durable, attributable evidence**, not merely a UI checkbox: confirming actor, confirmation timestamp, and confirmation text/version (conceptually `publicationRightsConfirmedAt` / `publicationRightsConfirmedBy` / `publicationRightsVersion`; adapt names to repo conventions). This is a small durable record, not a legal-consent platform.

Authorized business users can: upload, delete, hide, reorder; set service-family and length tags; include/exclude each photo from Discover; create/adjust the Discover crop; improve alt text; optionally attribute a technician where existing architecture supports it.

**Discover business setting:** "Show my work in Luster Discover." Existing businesses default off. Existing content is never auto-published. Turning Discover off removes the business from Discover without touching its profile or booking pages. Individual photos can stay excluded while business-level Discover is on. Admin can suspend Discover independently of booking.

**Guided preparation (a focused checklist, not an onboarding system):** select photos → apply tags → create crops → preview → publish.

**Preview Discover (required):** before/after enabling Discover, the owner can preview exactly how their business appears as a nearby card, a swipe card, and the profile — reusing the real presentation components where practical — so bad crops, wrong tags, wrong area labels, and missing content are caught by the owner, not by clients. Not a design editor.

---

## 22. Batch Tagging

Required for V1 — a tech with 30–75 photos must not tag one by one. Owners can select multiple photos and, in one save: apply one service-family tag, apply one length tag, include/exclude from Discover. Individual edits can override later. Never require colour/shape/complexity/occasion/price/duration tagging.

Owner-facing prompt for untagged photos: *"Tag your photos to help the right clients discover your work."* Untagged behavior per §14.4.

---

## 23. Discover Image Presentation

Do not force portrait-only uploads. Preserve the original, let the owner position/crop for Discover, store normalized crop/focal-point data, and serve:

* Swipe card: 4:5 (reuse the `getInstagramSafeUrl` Cloudinary transform pattern — §6.3)
* Nearby thumbnail: 1:1
* Profile grid: consistent optimized variant

Use Cloudinary URL transforms; do not duplicate physical files when transforms suffice.

**Quality validation:** warn/reject on too-low resolution, corrupt files, unsupported formats, un-croppable images, or size-cap violations — following the `serviceImageStorage.server.ts` precedent: signed preset, content-sniffed MIME (never filename/`file.type` alone), dimension/pixel caps, EXIF (including embedded GPS) stripped on processing, pending→active finalize, failed-upload GC, public-access invalidation on delete. No AI scoring — for the pilot, Luster manually helps founding businesses pick and crop their strongest photos.

## 24. Alternative Text

Generate a safe default from known metadata — *"Long Gel-X nail set by Isla Nail Studio"* — and let owners improve it. Never generic values ("image", "photo", filenames). No AI descriptions in V1.

---

## 25. Portfolio Photo Limit

Portfolio capacity is a centralized entitlement: the **Portfolio photo limit** (also acceptable: "stored portfolio photo allowance"). **The limit controls the number of non-deleted photos stored in the business portfolio. Public visibility and Discover inclusion do not affect whether a photo consumes a slot.** Hidden, Discover-excluded, and retained-over-allowance photos all count; failed uploads, expired reservations, and fully deleted records do not. Deleting frees a slot.

### Proposed allowances (product proposal — see cross-track note)

| Plan family | Portfolio photo limit |
|---|---|
| Free / entry | 10 |
| Starter / solo paid | 30 |
| Pro / growth | 75 |
| Elite / salon team | 200, business-wide |

The allowance belongs to the business tenant (a 10-tech salon on 200 shares 200), with technician attribution still possible.

### Enforcement architecture

* Resolve through the **legacy entitlement system** (§6.5): tier defaults keyed off `salon.plan` via the existing resolvers, plus a per-salon numeric override column (precedent: `salon.maxLocations`), with audit provenance per the existing override pattern. Founding/promo businesses get an explicit override (proposed: 75).
* **Cross-track note:** commercial plan naming/pricing belongs to `docs/luster-billing-communications-rev-2-2.md`; per its §5 the feature side stays legacy until the separately approved feature-matrix migration. The exact legacy-plan→limit mapping is ratified in PR1 review; any disagreement is `CROSS-TRACK CONFLICT — OWNER REVIEW REQUIRED`. Never key this limit on `billing_subscription`, and never claim upgrading buys Discover exposure.
* **Server-side and race-safe:** authorize the actor, resolve tenant + effective entitlement + override, count non-deleted photos, and prevent concurrent uploads from exceeding the limit via a repository-appropriate atomic strategy (transaction + lock, advisory lock, or upload-slot reservation — the Redis lock/idempotency patterns in `src/core/redis/keys.ts` are in-repo precedent). Do **not** copy the existing technician count-then-insert, which is not race-safe. Return a typed limit error; leave no orphaned storage objects or unauthorized records. A disabled upload button is not enforcement.
* **Owner meter:** "8 of 10 portfolio photos used"; at the limit, an upgrade path to the existing billing surface — with no exposure claims.

### Downgrades (non-destructive, binding)

Never delete photos on downgrade, and never rewrite owner-controlled flags. A downgrade changes **only `planEligible`** (§26):

1. All media and records are preserved; owner visibility and Discover-inclusion values are untouched.
2. The first N photos in owner-managed order remain plan-eligible; the rest become **retained but over allowance** (excluded from profile and Discover by the predicates, not by flag rewrites).
3. The owner can reorder to choose which photos stay active; new uploads are blocked while stored count exceeds the new allowance.
4. Upgrading (or deleting enough) restores eligibility automatically — the owner's intent was never lost.
5. The over-limit state is explained clearly in the portfolio UI.

---

## 26. Eligibility Model (binding)

Two separate predicates. A single formula is wrong: a tech may want a photo on her profile but out of the swipe feed, and downgrades must not masquerade as owner choices.

```
profileEligible  = ownerVisible && planEligible && moderationAllowed && businessEligible

discoverEligible = profileEligible
                   && businessDiscoverEnabled
                   && discoverIncluded
                   && discoverMetadataComplete   // service-family maps to an active bookable service, length set
                   && discoverCropReady
                   && locationEligible           // within radius, usable public discovery point
```

* **Profile grid** uses `profileEligible`.
* **Nearby thumbnails, swipe deck, and Saved Nails rehydration** use `discoverEligible` (§20 documents the only permitted variation).
* Downgrades change only `planEligible`. Owner visibility and Discover inclusion are owner-owned. Moderation state can disable a photo everywhere or Discover-only.

A business location is eligible for Discover surfaces only when, explicitly (never inferred from `getSalonBySlug`, §7.4): business active, published, not soft-deleted, not suspended; Discover enabled and not admin-suspended; a usable public discovery point exists; at least one `discoverEligible` photo exists; existing publication/status rules (`checkSalonStatus()` semantics) allow public display. The profile page applies the same business predicates minus the Discover-specific ones.

This split must be visible in the data model, the public queries, the downgrade logic, the integration tests, and the Definition of Done.

---

## 27. Conceptual Data Model

Semantics, not mandated names — adapt to repo conventions (nanoid text PKs, timestamps, index naming).

**Portfolio media:** internal ID; public ID; business ID; location association (single primary in V1, schema-compatible with multi); optional technician ID; Cloudinary object reference; original width/height; MIME; file size; owner sort order; owner visibility; Discover inclusion; service-family tag; length tag; crop/focal-point data; alt text; moderation state (everywhere vs Discover-only disable); publication-rights evidence (actor, timestamp, version); created/updated/deleted timestamps (soft delete).

**Business discovery settings:** business ID; Discover enabled; administrative suspension; updated-by/at.

**Location discovery fields (on `salon_location`):** private appointment latitude/longitude (protected operational fields); public discovery latitude/longitude; public area label; location privacy mode (commercial vs private/home); geocoding status + timestamp. Naming must keep private and public coordinates unmistakably distinct.

**Favourites:** no database table for anonymous V1 — local persistence + server rehydration only.

## 28. Migration and Backfill Rules

Hand-written forward-only SQL + manual `_journal.json` entries (§6.9), next available numbers at implementation time. Non-destructive defaults: existing businesses Discover-disabled; existing photos nonexistent in the new system (nothing to backfill — the portfolio starts empty); existing locations have no public discovery point until configured; all existing public pages and booking flows remain operational. Nothing is published without consent. Geocoding backfill is an admin/white-glove path over messy nullable address data, not an automatic mass job.

---

## 29. Public DTO Contracts

No raw rows. Whitelist-constructed, versioned public DTOs per the `redact.ts` / `mapPublicTechnician()` discipline — omitted fields do not appear at all.

**Nearby business card DTO:** public business/location ID, display name, profile URL, public area label, approximate distance (privacy-formatted), up to three thumbnail references, up to three service-family labels (from active bookable services).

**Swipe photo DTO:** public photo ID, optimized 4:5 image reference, dimensions/aspect, alt text, public business ID, business name, profile URL, public area label, approximate distance, service-family tag, length tag.

**Saved-photo rehydration DTO:** same public-safe semantics; saving an ID earlier grants no extra data.

Must never include: exact addresses, any exact coordinates, owner contact data, internal plan/billing state, entitlement internals, staff data, moderation evidence, private notes, or rating fields (none exist in V1 surfaces).

## 30. Public Endpoint Design

Follow existing server-action/API conventions. Conceptual endpoints: create location session; fetch nearby page; start swipe deck; continue swipe deck; rehydrate saved IDs.

* POST whenever location data is involved; coordinates never in query strings.
* Zod-validate everything: latitude/longitude ranges, radius (≤50 km), family/length enums, cursor, page size (≤10 nearby, capped swipe batch), saved-ID count (≤ cap), token expiry.
* **Rate limiting (binding):** Redis-backed, modeled on `publicBookingRateLimit.server.ts` — trusted Vercel-aware IP extraction, identifiers hashed before storage (no raw IPs in Redis), multi-window atomic Lua limits, optionally keyed additionally by the opaque session token. For this scrapeable anonymous surface, **deny on Redis unavailability** (unlike booking's fail-open). The in-memory `src/libs/rateLimit.ts` is forbidden.
* **Redis failure scope (binding):** Discover's deny-on-unavailable applies to Discover endpoints and session state only. A Redis outage must never degrade or disable existing booking functionality — booking keeps its own failure posture untouched.
* Enumeration-resistant error shapes; `{ error: { code, message } }` convention; no internals in messages.

## 31. Security and Tenant Integrity

Verify: actor belongs to the business with portfolio permission (existing guard families, §6.8); no cross-tenant media/location manipulation; photo limits unbypassable via direct API; deleted media unrevivable by ID games; hidden/deleted/over-limit/suspended content never public; private addresses and exact coordinates never in public DTOs; client coordinates never in analytics or logs; upload filenames untrusted and MIME content-verified; rate limits resist triangulation; public responses never contain plan/billing data. Keep coordinates out of Sentry contexts by discipline (no `beforeSend` exists — §6.9); a narrow Discover-scoped `beforeSend` scrub is a welcome hardening if added deliberately.

## 32. Session Restoration

The browser's versioned `sessionStorage` holds **UI restoration state only**: opaque location token, opaque swipe-session ID, filters, current card index, a temporary render cache of loaded cards, timestamp, schema version. Saved-heart IDs live in versioned `localStorage`. The browser holds no coordinates and no authoritative pass/served history — the server session owns dedup (§18). State expires, survives same-tab navigation (View Profile → Back restores the deck), tolerates corrupt/versioned-out data by resetting gracefully, and never grows unboundedly.

## 33. Accessibility

Swiping is never the only method: visible Pass/Heart/View Profile buttons always. Support touch, mouse, keyboard (Left = Pass, Right = Save, Enter = View Profile on a focused card), screen readers (ARIA announcements for pass/save, labeled buttons, logical focus order, focus restoration on return), reduced motion (respect `prefers-reduced-motion`), large touch targets, no color-only information. Vertical scrolling must not trigger horizontal swipes; gesture thresholds must be deliberate. Repo tooling is lint-only (§6.9) — PR5's accessibility verification is manual + e2e keyboard coverage; adding axe checks for the new pages is welcome but not assumed infrastructure.

## 34. Loading, Empty, and Error States

Deliberate states, with stable skeletons and reserved 4:5 layout (no CLS):

* No location: "Set your location to see nail businesses near you."
* Permission denied: "Location access was declined. Enter your city, area, or postal code instead."
* Location unavailable: "We couldn't determine your location. Try again or enter it manually."
* No nearby businesses: "No nail businesses were found within 10 km." → Increase distance / Change location.
* Insufficient supply: §15 message and explicit actions.
* Completed deck: "You've seen all matching nails." → View Saved Nails / Change Filters / Start Again.
* Network failure: retry without losing filters, location session, saved photos, or deck position.
* Deleted saved photo: silent removal or a small non-disruptive notice.

---

## 35. Analytics

PostHog, introduced behind **one thin Luster wrapper** (conceptually `analytics.track(event, properties)`) — never `posthog.capture()` scattered through components, so the provider stays swappable.

**Anonymous-only configuration (binding):** no session replay, no autocapture, no `identify()` or person profiles, no exact location collection, no private coordinates, no phone/email, no sensitive-URL capture. Only the approved events with safe properties (radius bucket, service family, length, public business/photo IDs, area/market label, anonymous session reference).

**Approved V1 events (all `discover_`-prefixed):**

`discover_opened` · `discover_nearby_opened` · `discover_business_card_impression` · `discover_profile_opened` · `discover_swipe_started` · `discover_photo_impression` · `discover_photo_passed` · `discover_photo_saved` · `discover_saved_opened` · `discover_filters_changed` · `discover_supply_insufficient` · `discover_deck_completed` · `discover_book_clicked` · `discover_booking_started` · `discover_booking_completed`

Document env vars; fail silent-and-safe when unconfigured. No giant analytics operation — these events, nothing speculative.

## 36. Booking Attribution

Concrete V1 contract:

1. The client enters a profile holding an opaque anonymous Discover session.
2. Tapping **Book Appointment** records a short-lived opaque attribution token via a server action or redirect handler — **preferred transport: a short-lived HttpOnly SameSite=Lax cookie, or existing server-side booking-session metadata.** Not a public query string, unless existing infrastructure requires it and security review approves.
3. The token contains no coordinates, no salon-private data, no phone number, no permanent client identity.
4. The booking flow reads it **for analytics only**: `discover_booking_started` / `discover_booking_completed` reference the opaque attribution. It never alters prices, eligibility, availability, deposit logic, or appointment state — authoritative booking code paths are not modified for attribution.
5. The token expires and is cleared after completion or TTL.

## 37. Product Metrics

Landing→swipe-start rate; photo impressions per session; save rate per impression; profile-open rates (swipe, saved); nearby CTR; no-results and insufficient-supply rates; average eligible businesses/photos per deck; Discover-attributed booking starts and completions; share of participating businesses receiving profile visits; setup-completion rate. North star: **Discover-attributed completed bookings per active participating business.** Never optimize raw swipe count.

---

## 38. Market Readiness and Pilot Operations

Software is half the launch; supply is the other half. For each founding business: obtain Discover consent; verify profile, location, and privacy mode; select strongest photos; tag; crop; preview; confirm image speed, profile, and booking journey. **White-glove offer:** *"Send us 10–20 of your best nail photos and we'll set your Discover portfolio up."* Daniela/Isla first.

Pilot sequence: internal test data → Isla Nail Studio → five invited local businesses → ten-to-twenty → closed Scarborough/Toronto client test → public local release only after §15's market gate. **Pilot eligibility honors the §11 home-studio gate:** no private/home studio enters a public rollout while the anonymous booking flow reveals exact addresses pre-disclosure. Never launch empty markets.

## 39. Admin and Operational Controls

Reuse existing admin surfaces. Required: global env kill switch (tri-state `z.enum(['true','false']).optional()` per `src/libs/Env.ts` conventions — read as an explicit **opt-in** for Discover, absent = disabled); per-salon `discoverable` entitlement in `src/libs/salonFeatureRegistry.ts` (Super Admin entitles, admin enables — §6.5); pilot allowlist; per-business Discover suspension; per-photo admin disable (everywhere or Discover-only); eligibility inspection ("why is this photo/business not showing?").

Lightweight readiness view or script: eligible business/photo counts, missing crops/tags/discovery locations, counts by family and length, businesses over allowance. Not a marketplace admin platform.

**Content reporting (binding decision):** the vetted private/local pilot may launch without client-facing reporting. **Before broad public rollout, either a simple "Report photo" flow ships, or explicit owner approval to launch without it is obtained and the operational moderation process is documented.** Admin-disable tooling alone is not an inbound reporting mechanism, and "pilot only" must not silently become the public production assumption.

## 40. Performance Requirements

No multi-megabyte originals in cards; explicit image sizes; reserved 4:5 layout; one-to-two image preload; lazy nearby thumbnails; cursor pagination; small DTOs; no full-portfolio downloads; CDN-cacheable public images; no per-search geocoding (geocode on save); no precise location in client-visible cache keys. Test with mobile throttling, cold/warm cache, varied photo counts, low-memory devices where practical. **Record measured results — "performance looks good" is not evidence.**

## 41. Required Tests

Follow repo conventions (§6.9): colocated unit tests (PGlite), `*.integration.test.ts` Postgres suites, `core.*.e2e.ts` Playwright gate naming, mocked geolocation, production-like supply seeds (§15).

**Unit:** Haversine + bounding box + radius boundaries; commercial vs private-studio distance formatting; location-token expiry; family/length filter matching incl. untagged behavior; supply thresholds (production + pilot); entitlement resolution + founding override + business-wide pool; downgrade active-photo selection and owner-order behavior; **`profileEligible` vs `discoverEligible` split**; round-robin fairness, stable seeded order, no-consecutive-business rule; cursor continuation; DTO sanitization; saved rehydration; corrupt local/session state recovery.

**Integration:** cross-tenant photo/location manipulation blocked; direct API cannot bypass the photo limit; concurrent final-slot uploads cannot both succeed; failed upload leaves no active orphan; delete frees capacity; downgrade deletes nothing and rewrites no owner flags; over-limit photos excluded publicly while profile-eligible photos under the limit remain; **a photo excluded from Discover stays on the profile; a hidden photo disappears from both**; reordering changes the plan-eligible set; Discover-disabled/suspended businesses excluded; admin Discover-only disable vs everywhere-disable; specific filters never receive unspecified photos and are never silently relaxed; family tags with no active bookable service are Discover-ineligible; private address/coordinates absent from every public response; nearby cursor deduplicates locations; swipe cursor deduplicates photos; rehydration caps IDs; expired/invalid location tokens rejected; radius >50 km rejected; no plan/billing data in public responses; rights-evidence fields persisted on upload.

**End-to-end (minimum):** anonymous open → Use My Location (mocked) → nearby list ≤10 with km distances → Show More without duplicates → filter setup (Gel-X, Long, 10 km) → qualifying deck → pass via button → heart via button (immediate advance) → heart via gesture → saved counter increments → Saved Nails rehydrates → remove one → View Profile shows logo/name/area/grid/labels and no ratings → Book Appointment enters the existing booking flow → Back restores deck position → deck completion state → impossible filters show the supply gate un-relaxed → explicit relaxation builds a new deck → location-denied manual fallback works → private-studio exact address and coordinates absent from all network responses → owner at limit blocked in UI and via direct API → owner batch-tags and crops → owner disables Discover and vanishes from results while `/{slug}` booking still works → direct business pages show no competitors.

## 42. Manual Verification

Physical iPhone where practical; mobile Safari + Chrome mobile viewport + desktop; touch/mouse/keyboard-only; screen reader and reduced motion where practical; slow network; location granted/denied/manual; no-results and insufficient-supply; one-photo and three-photo businesses; private home studio vs commercial storefront; business at limit and downgraded-over-limit. Confirm: no accidental passes while scrolling; deliberate swipe thresholds; instant hearts; sharp photos; zero layout shift; consistent crops; legible name/distance; deck restoration on Back; "Saved on this device" clarity; no private data in browser traffic; competitor-free direct pages.

## 43. Feature Flags, SEO, i18n, Release Safety

* Rollout controls: global env kill switch (explicit opt-in), `discoverable` entitlement, pilot allowlist, market-level control, immediate kill. **No percentage rollout** (no such mechanism exists). Never auto-enable existing businesses; never publish unapproved photos.
* **SEO:** Discover and profile routes are `noindex` during the pilot; no sitemap additions; profile SEO expansion is not part of V1.
* **i18n:** preserve `[locale]` routing; hardcoded English strings are acceptable for V1 (that matches every product surface today); no translation-system expansion in Discover V1.
* Do not claim production readiness until tests pass, privacy is verified, mobile performance is measured, pilot supply is prepared, flags are confirmed, and existing booking flows remain healthy.

---

## 44. Definition of Done

**Client:** anonymous Discover works end-to-end; location requested only on tap; manual fallback works; browser stores only the opaque location token — client coordinates never persist in the database and never appear in browser storage, URLs, PostHog, Sentry contexts, or logs; nearby shows up to 10 eligible businesses per page (a six-business page is valid); filters work and are never silently relaxed; supply gate messaging with explicit relaxation; pass/save/buttons/keyboard all work; save advances immediately; saved counter visible and live; View Profile → minimal profile → Book Appointment → existing booking; Back restores the deck; Saved Nails rehydrates, removes, and says "Saved on this device."

**Profile:** dedicated minimal profile exists (logo/name/area/grid/≤3 active-service labels/sticky Book CTA); session-gated distance only; no ratings, no bio field added, no map/staff/availability; existing `/{locale}/{slug}` direct-booking behavior preserved unless explicitly gated and separately approved.

**Owner:** portfolio upload/tag/batch-tag/crop/reorder/hide/delete/include-exclude all work; publication-rights confirmation is durable and attributable; usage meter and upgrade path shown without exposure claims; Preview Discover exists; Discover opt-in/out works without touching booking.

**Eligibility & limits:** `profileEligible`/`discoverEligible` split enforced in queries and integration tests; a Discover-excluded photo remains profile-visible; downgrades change only `planEligible`, delete nothing, and rewrite no owner flags; over-limit photos retained and publicly inactive; limit is the "Portfolio photo limit" counting all non-deleted photos regardless of visibility; race-safe enforcement proven under concurrency; `appointment_photo` untouched.

**Fairness:** no plan-based ranking; adaptive round-robin with no arbitrary spacing constant; no consecutive same-business cards when avoidable; nearby ordering distance-based; server/Redis swipe session is the single deduplication source.

**Privacy & security:** exact private-studio address/coordinates never in public DTOs, browser storage, analytics, Sentry contexts, or logs — they exist only in protected operational location fields; private-studio distances derive only from the public discovery point; the §11 public-rollout gate for private/home studios is documented and enforced in pilot controls; Discover service tags map to currently active bookable services; endpoints rate-limited via hashed-identifier Redis limiting; Redis failure on Discover cannot disable unrelated booking; tenant isolation verified; direct pages competitor-free.

**Analytics & attribution:** PostHog behind the wrapper with no replay/autocapture/identify; only the approved `discover_`-namespaced events; attribution via HttpOnly cookie or server-side booking metadata, analytics-only, expiring.

**Quality:** 4:5 cards, optimized thumbnails, no originals in cards, no layout shift; accessibility alternatives and reduced motion verified; E2E seeds satisfy production-like supply thresholds; physical-mobile verification documented; existing affected tests green; feature within V1 scope; content-reporting decision made explicitly before public rollout.

---

## 45. Per-PR Delivery Report

Each PR ends with: repository evidence (base/head SHA, branch, commits, files, migrations, draft PR link); reuse-vs-new summary with any deviations from this brief and why; product summary (client/owner behavior delivered); security evidence (tenant isolation, limit enforcement, address/coordinate protection, rate limits, DTO review); testing evidence (exact commands, counts, pass/fail, e2e scenarios); performance evidence (measured); known limitations (real ones only, no roadmap). Never claim merged, deployed, production-ready, or fully verified unless separately authorized and actually done.

## 46. Known Limitations (V1)

* `salon.plan` is manually curated; Stripe does not write it (billing-track territory).
* Ratings are absent by design until a verified-review system exists (post-V1).
* Favourites are device-local; no cross-device sync.
* The anonymous booking flow's pre-booking address reveal is unfixed inside these PRs; the §11 gate excludes affected private studios from public rollout until the separately authorized fix lands.
* Client-facing content reporting may be absent during the vetted pilot (§39 decision required before public rollout).
* Geocoding quality depends on messy legacy address data; pilot locations are verified white-glove.

---

## Final Product Standard

The client sees **Find your perfect nails**, picks Gel-X · Long · 10 km, and swipes immediately. Each screen answers only: Do I like this set? How far is the business? Who made it? Save it? See more of their work? Book?

The owner uploads a portfolio once, confirms they may display it, applies two simple tags, approves the crop, and lets Luster handle discovery — no second social platform to run.

V1 stays: simple for clients, simple for businesses, fair across plans, safe for home studios, fast on mobile, cheap to operate, built on the existing Luster system, easy to measure, easy to disable, ready for a concentrated local pilot. Add nothing beyond this unless correctness, privacy, accessibility, or security requires it.

Implementation must proceed one separately authorized PR at a time. This brief does not authorize merging, deployment, or autonomous execution of the full five-PR sequence.

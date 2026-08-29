# Onboarding integration ports

These modules are replaceable ports for the standalone UX Lab. They let the
owner journey exercise service selection, minimum notice, one fixed deposit,
shared browser media, and the post-onboarding dashboard handoff without creating
a second Production authority.

Normal onboarding screens import only from `adapters/`. Today those bindings
instantiate the implementations in `lab/`; Production integration must replace
the bindings and delete the Lab implementations.

## ServiceMenuPort

- UX purpose: preselect popular nail services, let an owner remove services or
  add an existing Library service, and update the Lab customer Booking preview.
- Input: `ServiceMenuSelectionDraft`, containing canonical Lab service IDs and
  optional price/duration overrides only.
- Output: normalized selection IDs and derived display items from the canonical
  Booking fixture.
- Browser-local implementation: `lab/service-menu-port.ts`; persistence remains
  in the versioned onboarding Lab state, not a second storage key or catalogue.
- Existing Production system: `src/libs/serviceTemplateCatalog.ts`, tenant-owned
  `service` rows keyed by `templateKey`, `GET/POST
  /api/salon/services/from-templates`, and the tenant-scoped service PATCH route.
- Future seam: replace `adapters/service-menu.ts` with an authenticated adapter
  that reads the owner menu and Service Library, then performs add/reactivate or
  deactivate operations against existing routes.
- Gap: several old Lab fixture services map only approximately to Production
  templates; complimentary consultation has no matching template.
- Migration: translate selected Lab IDs with
  `service-menu-production-mapping.md`; never treat Lab IDs as owner service row
  IDs.
- Feature flag: required for Production onboarding writes until authenticated
  ownership, tenant scoping, retries, and partial-failure recovery are covered.
- Tests: canonical-ID normalization, no record copies in saved drafts,
  add/remove/resume, preview filtering, and complete future mapping coverage.
- Delete on Production connection: `lab/service-menu-port.ts`; replace the
  binding in `adapters/service-menu.ts`. Remove Lab-only mapping code after the
  one-time onboarding migration no longer needs it.

## BookingPreferencesPort

- UX purpose: exercise salon minimum-notice choices and the currently supported
  salon-wide fixed deposit.
- Input: normalized minutes and one `DepositDraft` (`none | fixed`, cents,
  refundability, transferability, wording override).
- Output: normalized minutes/cents, safe preset/custom choice resolution, and a
  bounded set of seeded candidate appointment times filtered by the selected
  notice for the Lab customer preview.
- Browser-local implementation: `lab/booking-preferences-port.ts`; values persist
  only in the onboarding Lab state on this device.
- Existing Production system: Booking availability hard-codes 120 minutes in
  availability, appointment creation, change-appointment, and Smart Fit paths.
  Salon settings already own `payments.deposit.enabled` and
  `payments.deposit.amountCents` through `/api/admin/salon/settings`.
- Future seam: add one salon-level `minimumNoticeMinutes` owner setting and make
  every Booking availability/admission path consume it. Replace the adapter with
  authenticated settings reads/writes. Map `fixed` to
  `payments.deposit={enabled:true, amountCents}` and `none` to `enabled:false`.
- Gap: Production has no configurable minimum-notice field. Deposit wording,
  refundable, and transferable answers remain policy content; they do not
  change Stripe behavior by themselves.
- Migration: schema v5 fixed dollar deposits become cents. Percentage and
  service-dependent v5 answers are retained only in a non-authoritative legacy
  archive and resolve to no live deposit choice.
- Feature flag: required for the new Production minimum-notice setting and
  onboarding writes. Existing fixed-deposit writes must retain their current
  provider-readiness safeguards.
- Tests: every notice preset, custom hours/days normalization, candidate-time
  filtering, every deposit preset, one shared draft, storage migration, and
  absence of service-level UI.
- Delete on Production connection: `lab/booking-preferences-port.ts` and
  `lab/booking-availability-preview.ts`; replace the binding in
  `adapters/booking-preferences.ts` with tenant availability/settings reads.
  Delete legacy v5 archives after their supported migration window.

## OnboardingMediaPort

- UX purpose: validate profile, logo, and Gallery uploads with reload-safe
  thumbnails while keeping binary data out of onboarding localStorage.
- Input/output: bounded raster `File` values become metadata-only
  `LocalImageReference` values containing shared-repository asset IDs.
- Browser-local implementation: `lab/media-port.ts` reuses the final Custom
  Design raster decoder, thumbnail processing, IndexedDB repository, WebKit
  ArrayBuffer fallback, object-URL registries, and cleanup coordinator.
- Existing Production system: authenticated Business Profile/Gallery media
  ownership and upload APIs; those cannot run in this Vite Lab.
- Future seam: replace `adapters/media.ts` with the Production media client and
  persist its durable IDs in the real Business Profile/Gallery records.
- Migration: Lab IndexedDB IDs are device-local and must never be treated as
  cloud IDs; an owner must explicitly select/upload any asset carried forward.
- Tests: decoded validity, metadata-only serialization, partial failures,
  discard/cleanup, URL resolution, reload/reset, and inherited WebKit fallback.
- Delete on Production connection: `lab/media-port.ts` and its Lab binding;
  retain the port contract until every screen consumes durable Production IDs.

## DashboardHandoffPort, DashboardTourPort, and SetupChecklistPort

- UX purpose: test the dashboard payoff, optional five-part tour, and motivating
  continuation checklist without cloning the authenticated owner workspace.
- Browser-local implementation: an explicitly labelled static storyboard. Site,
  Booking, and service readiness derive from the real Lab document/selected
  canonical IDs. The Services destination and tour miniature resolve their
  visible count, names, prices, and durations from those same IDs rather than a
  copied service list; integration statuses enter only through typed fixture
  ports.
- Existing Production system: `/${locale}/admin` and its authenticated Today,
  Calendar, Clients, Services, and Booking Page destinations.
- Future seam: replace the handoff with authenticated navigation after tenant
  resolution; mount a Production tour/checklist over real routes and health
  selectors.
- Migration: plan intent is not billing or entitlement data, and fixture
  integration statuses must never migrate.
- Delete on Production connection: the Lab dashboard surface, tour miniatures,
  dashboard fixture ports, and storyboard CSS. Keep contracts until navigation
  and status consumers use real authenticated sources.

## Plan-offer configuration

The founding presentation mode is versioned Lab state (`lifetime`, discounted
annual, locked monthly, free beta, or hidden) and is selectable through explicit
Lab review fixtures. `PlanOfferSheet` derives its cards from that state; it does
not grant entitlements or call a payment provider. Production must replace the
fixture mode and copy with one approved offer configuration source before this
journey is integrated.

The adapters never call Production APIs, never import authenticated routes, and
never alter the universal Builder or Custom Design core.

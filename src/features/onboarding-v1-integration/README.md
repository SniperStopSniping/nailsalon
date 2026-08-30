# Account-backed Onboarding V1 integration

This feature connects the accepted browser-first Onboarding V1 experience to
the existing Luster account, tenant, service, Workspace, and customer-preview
systems. It is deliberately dark by default behind
`LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED=true`.

## Authority boundaries

- Clerk remains the only owner authentication authority.
- `admin_user`, `salon`, `admin_salon_membership`, `service`, and technician
  records remain the existing Product authorities.
- The accepted onboarding Business Profile, universal Builder document,
  Booking catalogue IDs, Custom Design settings, and media repository remain
  the browser draft authorities until a server claim is acknowledged.
- `onboarding_site` owns the account-backed site identity. Append-only
  `onboarding_site_revision` rows preserve the exact accepted source document,
  connected snapshot, deterministic compiled document, and fingerprints.
- The real `/<locale>/admin` Workspace remains the post-plan destination.
  The integration adds a welcome/checklist surface to it; it does not create a
  second dashboard.
- Plan intent is informational only. It creates no entitlement, checkout,
  invoice, receipt, or payment.

## Claim lifecycle

1. A browser creates one opaque anonymous draft ID. No personal information is
   encoded in it.
2. Final Review hands the accepted state and universal document to the
   same-origin integration route.
3. After Clerk authentication, the server hashes the draft ID and uses its
   unique claim row as the idempotency boundary.
4. A tenant-scoped transaction creates or explicitly targets Product owner,
   salon, membership, location, technician, service-menu, site, and revision
   records. Existing or published sites are never silently replaced.
5. Browser media is uploaded only after the core revision exists. Every media
   request is checked against the authenticated tenant, site revision,
   declared logical item ID, role, and order.
6. Local data is retained until the server confirms the core claim and each
   uploaded item. Partial optional-media failure leaves the textual site saved
   and the local image available for retry.
7. A same-browser recovery marker contains only the verified site ID and
   revision. It never duplicates the anonymous token or personal data.

Repeated claim requests return the original resources. A database unique key
is the cross-process concurrency guard; an in-process queue only reduces
avoidable duplicate work.

## Preview and editing

Final Review and the saved-site route use the accepted customer renderer. The
saved route rebuilds its model from one tenant-authorized revision and
role-specific server media; it has no starter/fallback document path.

The Product Builder does not yet have faithful native editors for every
onboarding section. Normal owners therefore receive **Change website setup**
for the exact current unpublished onboarding revision instead of being sent to
placeholder `Section 01 / Section 02` content. The server re-authorizes owner
membership and the current revision, then hydrates the accepted setup flow with
logical media IDs. Existing server media is read through a tenant-authorized
adapter while new edits continue to use the writable IndexedDB repository.
Published sites and stale revisions fail closed.

## Style isolation

Customer style and palette values are scoped to the site renderer. Account,
Clerk, plan, and Workspace surfaces use fixed `--owner-*` tokens. The six style
presets and eight palette presets persist independently on the site revision;
they cannot recolour owner tools.

## Development-only media adapter

`media-storage.server.ts` stores normalized image files outside the repository
when `APP_ENV=development` and `LUSTER_ONBOARDING_MEDIA_DIR` is set. It fails
closed outside that environment. This adapter exists only to prove ownership,
transaction, retry, and cross-browser behavior without mutating a live media
provider.

Before Production connection lands, replace only that storage adapter with the
existing approved cloud-media service while retaining the media authorization,
role, revision, and idempotency contracts. Delete the local adapter and its
filesystem tests after equivalent provider tests pass. Do not change the
browser manifest or site-document contracts.

## Safe local verification

Use an empty `DATABASE_URL`, `APP_ENV=development`, a disposable
`LUSTER_PGLITE_DATA_DIR`, and a disposable `LUSTER_ONBOARDING_MEDIA_DIR`.
Never point this integration branch at Production credentials or apply its
migration to the live database.

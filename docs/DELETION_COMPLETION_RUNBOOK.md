# Deletion requests and completion evidence

This packet is not released. Migration 0113 depends on the reviewed 0098–0112
sequence in PR #465. Do not apply 0113 first: Drizzle's timestamp ledger could
then skip those earlier migrations. The CI migration-order check intentionally
fails on this isolated draft until those predecessors are integrated. The same
CI-invoked guard pins the exact 0113 SQL SHA-256 postimage and rejects mutations. The combined release must rehearse the full
0097 → 0113 sequence and verify the resulting ledger and schema before shipping.

## Three separate requests

| Request | What the current application does | What it does not establish |
| --- | --- | --- |
| Archive a salon | Takes it offline and keeps its records for possible restoration. | This is not an erasure request. |
| Delete an archived salon | Purges the tenant records in `salonPurge.ts`; removes the salon's Google connection through its FK cascade; records referenced media in a separate recovery job in the same transaction. | It does not delete a person's Clerk sign-in account, other salons, required retained records, remote Google events, provider backups or cached copies. A local token-row deletion is not proof of Google accepting token revocation. |
| Delete a person's account | Requires a separately verified support request, identification of their Clerk user/admin records and memberships, and a reviewed plan for salons they own or administer. | Salon deletion is not person-account deletion. Do not delete shared salons or other members' data just because one person asks to close their sign-in account. The salon endpoint provides no proof of account erasure. |
| Disconnect Google | `/api/integrations/google/disconnect` requests token revocation and deletes the local connection. | It leaves previously synchronized event/appointment data and existing events in Google. The current revocation call is best effort and does not confirm provider acceptance. |

Required platform audit, billing/payment and one-per-business anti-abuse evidence
can survive tenant deletion. Read `salonPurge.ts` for the exact predicates and
nulling behavior; the purge preview counts are not a count of all retained data.

## Support intake and identity verification

1. Receive the request at **support@lustergel.app**. Record a case ID, request
   scope (salon / person account / Google disconnect), target IDs and receipt
   time. Do not ask for a password, OAuth token or copy of a government ID.
2. Verify control through the person's existing authenticated account and/or a
   challenge sent to the **already registered** email address. Do not accept a
   new address, an unverified From header, a forwarded message or possession of
   a public salon URL as proof of ownership. A salon request also needs current
   owner authority; a customer requesting their own personal data is a separate
   scoped case, not authority to delete the salon.
3. Record the verification result and evidence reference with restricted access;
   retain only the minimum evidence needed. Resolve mismatched identity or
   disputed ownership before executing a destructive action.
4. Confirm the requested scope and disclose the retained categories before
   execution. For person-account requests, separately inspect Clerk identity,
   local `admin_user`, memberships, owned salons and legal/billing exceptions.
   Do not equate an archive, removal of one membership or Google disconnect
   with full account deletion.
5. Use only the confirmed target and approved support process. For a salon,
   archive first, inspect the purge preview, then type its exact slug. Capture
   the returned cleanup job ID and the app's active-record deletion result.

## Media recovery and status

The job has no foreign key to the deleted salon. It captures owned onboarding,
appointment, portfolio and service-media references before database deletion.
Automatic removal is restricted to owner-bound private onboarding media.
**All public Cloudinary and local service images require manual review**, even
when their ownership is known. Unknown providers, external URLs and shared
references also remain under review; none are silently counted as removed.
This rule includes older jobs already containing `cloudinary` or `local_service`
assets. Their status is `review_required`, and neither the cron nor a manual
retry can delete them automatically.

Each run leases one job, attempts at most ten assets, saves successful removals
individually and retains failures for bounded exponential-backoff retries.
Provider `not found` is treated as idempotent success where the adapter can
confirm absence. A failed checkpoint leaves the key available for a safe retry.
A reference check and a provider delete are separate operations. A safe local
reproduction against the initial PR466 head showed an owner's supported raw-logo
PATCH could add a public-image reference during that window. It used real PGlite
and route validation/persistence with mocked identity/provider calls, and is not
proof of live loss. Public auto-deletion is therefore withheld until a separately
reviewed writer fence can make the reference/write/delete rules consistent. No
race-free guarantee is made for unfenced public writers. The private onboarding
adapter still enforces immutable salon/site key ownership. The existing
authenticated media cleanup cron invokes its retries; no n8n is used.
Verify scheduler invocations in the deployed environment before calling this
operationally proven.

- `GET /api/super-admin/deletion-cleanup` lists at most 100 oldest unfinished
  jobs, with `truncated: true` if additional jobs exist. Continue resolving the oldest work and query again; an empty first page
  is the only empty-queue signal. Access is restricted to super admins.
- `GET /api/super-admin/deletion-cleanup/{jobId}` returns counts and status.
- `POST` to that job requires a matching same-origin header and requests another
  eligible attempt, respecting lease/backoff.
- `202`, `pending`, or `review_required` means **unfinished**. The salon's live
  records may already be gone. Never run the destructive delete again as a retry
  mechanism; repeat requests with the original salon ID/slug recover its job.
- `completed` means the captured, tracked media references were removed. It does
  not certify provider backup erasure, all historical unreferenced uploads,
  user-held copies, remote calendar event deletion or person-account deletion.
- `review_required` needs an authorized operator to inspect the stored references,
  verify ownership and current references, and determine a safe deletion/retention
  action. Rechecking a public URL immediately before deletion is not an atomic
  write fence and does not by itself resolve the reproduced race. There is
  no bulk "mark complete" control. Keep the case open until that review and its
  evidence are complete; do not edit counters merely to produce a green status.

## Verified retention limits — 19 October 2026

Read-only production Neon console inspection of project `nail-salon-no5`,
production/default branch: **six-hour history window**, **17 manual snapshots**,
**no scheduled snapshots**. The saved screenshot shows the snapshot `luster-pre-lifetime-0097-20261007`
(12 days old) with expiry **never**. It does not prove the expiry of all other snapshots. No backup was changed or
deleted. The history window does not bound retention of those manual snapshots.
This is a dated configuration observation, not a future expiry guarantee.

Cloudinary account backup settings remain **unverified because sign-in is
required**. [Cloudinary's backup documentation](https://cloudinary.com/documentation/backups_and_version_management)
explains that deleting a live asset can leave backed-up versions available for
restoration. [CDN invalidation documentation](https://cloudinary.com/documentation/invalidate_cached_media_assets_on_the_cdn)
also distinguishes provider invalidation from browser, proxy and search caches.
The cleanup requests invalidation; it does not prove all caches have expired.

Before publishing any erasure deadline, verify actual Cloudinary backup settings,
Neon snapshot lifecycle, provider contracts, logs, mail/support records and any
auth/payment provider retention. Define who removes/ages out backups and how a
restore re-applies completed deletions before becoming accessible to the app.
**Do not promise "all data deleted within 30 days" or any unverified timeframe.**

## Fake-data end-to-end rehearsal gate

Use a separately authorized disposable salon/person and dedicated test calendar;
never a customer tenant. Disable outgoing customer SMS, payment and booking side
effects. The following live gate is still **not completed**:

1. Send a clearly labeled test deletion request to support@lustergel.app from a
   controlled test identity and confirm receipt in that actual mailbox.
2. Send the verification challenge through the real support sender; complete it
   with that identity. Check a mismatched/unverified requester cannot authorize
   deletion. Capture message IDs and timestamps without publishing private mail.
3. Agree salon-only scope. Seed fake appointments, client/staff/service records
   and managed images; capture IDs and a separate retained account/audit record.
4. Run the actual archive/purge UI. Confirm active rows disappear, another salon
   survives, the person's sign-in account remains, and required retained audit
   evidence survives. Track the real cleanup job to completion.
5. Confirm provider deletion/absence for the fake images and check the deployed
   cron retries a deliberately failed disposable cleanup. Synthetic provider
   tests prove retry logic, not live provider acceptance or scheduler execution.
6. Send an accurate completion confirmation from support@lustergel.app, then
   confirm delivery to the controlled requester. If cleanup is unfinished, send
   only the partial-status wording below and keep the case open.
7. Record the evidence and pass/fail of every step. A unit test or drafted email
   is not mailbox delivery or identity verification evidence.

Current automated evidence uses isolated PGlite with real migrations and real
purge transactions, plus simulated provider responses. The real support mailbox
and Cloudinary sign-in must be connected before the live gate can be executed.

## Confirmation wording

**Unfinished:** "The requested salon's active records have been removed from
Luster. Image cleanup is still pending [retry/ownership review], so your request
remains open. We will confirm its result separately. Required billing/security
records, your sign-in account, existing Google Calendar events and backup/provider
copies are handled separately as explained in our privacy policy."

**Tracked salon cleanup complete:** "The requested salon's active records and
the managed images tracked for this request have been removed. This was a
salon-only request: your sign-in account and other salons were not deleted.
Required billing/security records, existing Google Calendar events and
backup/provider copies are subject to separate retention. [List the verified
case-specific exceptions and remaining actions.]"

Do not use the second template for a person-account request, an unfinished job,
unresolved ownership review or an unverified provider result. Do not tell Google
the live rehearsal passed until all seven steps have evidence.

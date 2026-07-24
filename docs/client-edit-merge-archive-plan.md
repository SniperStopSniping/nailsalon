# Client edit, merge, and archive plan

## Scope and invariants

- Keep the existing Clients directory/profile and Book, Text, and Call actions.
- Do not change booking, checkout, Client Insights, cancellation/no-show policy,
  service images, unified timeline, or Marketing presentation.
- Every lookup and mutation stays salon-scoped. Staff authentication remains
  unable to call owner/admin lifecycle routes.
- Preserve appointment/contact/financial snapshots. Current contact details
  are used for future outreach without rewriting past rows.
- Never mutate or merge the global customer account or phone-based customer
  sessions. Salon contact aliases are internal resolution aids, not customer
  authentication aliases. A session authenticated only by a historical phone
  receives an identity-reconciliation-required response instead of access to
  the primary profile; that reconciliation workflow is deferred.

## Existing client-reference architecture

| Record/feature | Current client key | Edit/merge/archive handling |
| --- | --- | --- |
| `salon_client` | Stable salon-scoped ID; unique salon + phone | Add birthday, archive, merge-target, actor/time fields. Keep the primary ID. Exclude archived/merged rows from the active directory. |
| Operational client resolution (`getOrCreateSalonClient`, `upsertSalonClient`, `getSalonClientByPhone`) | Salon + normalized current phone | Resolve a current phone or salon-private historic alias to the unmerged primary before creating another row. Never revive or return the preserved source; historical-only matches may associate internal records but cannot update identity fields or link an external identity. |
| Responsive admin profile and staff phone profile | Stable client ID for admin; salon + phone for the legacy staff URL | Admin IDs resolve merge redirects. The authenticated staff URL resolves aliases to the primary and reads stable-ID-first combined history, while preserving existing staff redaction and keeping customer-owned preference/login identities separate. |
| `appointment` | Nullable `salon_client_id` plus name/phone/email snapshots | Relink the duplicate's stable IDs in the merge transaction. Use stable-ID-first profile queries with phone-alias fallback for legacy null IDs. Never rewrite appointment snapshots. |
| Appointment services, add-ons, final items, payments, payment links, access tokens, artifacts, audit logs, notification deliveries, and calendar/outbox rows | Through `appointment_id` | Move implicitly with the appointment. Do not copy or recreate financial rows. Derive completed outstanding from appointments and non-voided payments. |
| `appointment_photo` | `appointment_id` plus normalized-phone snapshot | Preserve the phone snapshot. Read through the linked appointment/stable client, with alias fallback for legacy data. |
| `review` | Stable `salon_client_id` and appointment/name snapshot | Relink to the primary; preserve review IDs/content/snapshots. |
| `fraud_signal` | Stable `salon_client_id` and appointment ID | Relink to the primary. Preserve all signals and conservatively combine blocking/problem flags. |
| `client_communication` | Stable `salon_client_id`; message metadata/snapshot | Relink rows. Add a destination snapshot for new records only. Resolve active-retention uniqueness before relinking; do not rewrite old destinations/messages. |
| `retention_campaign` and redemptions | Stable client ID; redemption through appointment | Relink campaigns; redemptions remain attached through appointments. Archived clients are excluded from automated outreach queues. |
| `reward` and loyalty-points balance | Reward ledger uses salon + phone; mutable point balance is cached on `salon_client` | Preserve reward rows and IDs; associate/read them through all internal contact aliases. Resolve redemptions/refunds to the unmerged primary and use compare-and-set deductions. Do not insert copies or credit a preserved merged source. |
| `referral` | Salon + referrer/referee phone snapshots | Preserve rows. Treat either side matching a current/alias phone as meaningful history for delete eligibility. |
| `client_preferences` | Salon + normalized customer-login phone | Preserve both rows and customer-login ownership. The merge preview shows both; salon-managed preferences on `salon_client` use the owner's conflict choices. External/customer-login preference identity is not silently merged. |
| Salon-managed notes/preferences/tags | Mutable fields on `salon_client` | Union tags; choose conflicting preference/contact values. Add immutable client-note rows so both pre-merge notes remain visible without concatenating mutable notes. |
| Global `client` and `client_session` | Global phone / E.164 phone | Do not update, merge, or delete. This is the app's customer-auth identity workflow and is separate from Clerk-backed admin authentication. A linked or alias-matching global identity makes permanent deletion ineligible. |
| Communication consent/delivery | Salon + recipient snapshot, and/or appointment | Preserve as historical evidence. Current contact changes do not rewrite it; appointment-linked delivery remains reachable through the appointment. |
| Cached visits/spend/no-shows/last visit/rebook due | Mutable cache on `salon_client` | Recalculate from canonical, salon-scoped appointments after relinking; never add two cached totals. Preserve loyalty/reward ledger rows rather than duplicating them. |
| General `audit_log` | Immutable salon/entity/action metadata | Insert edit, merge, archive, restore, and delete audit rows inside the authoritative transaction, including actor, IDs, versions, changed fields, and merge field selections. |
| Migration `0052` backup tables | Historical copies keyed by client/appointment ID | Operational backup only; never mutate during profile operations. |

## Smallest safe migration

1. Add `birthday`, `archived_at/by`, and `merged_into_client_id` plus
   `merged_at/by` to `salon_client`, with indexes for active/archive/merge
   resolution.
2. Replace the salon-phone unique index with an equivalent partial unique index
   for non-merged profiles. This lets a preserved merged alias and its primary
   safely share the selected current phone while active profiles remain unique.
3. Add a salon-scoped `salon_client_contact_alias` table for normalized historic
   phone/email values. It supports legacy history, duplicate detection, and
   safe resolution of old links without changing customer authentication.
4. Add immutable `salon_client_note` rows so both profiles' notes survive a
   merge without fabricating a combined mutable note.
5. Add `destination_snapshot` to `client_communication`; existing rows remain
   null and are never backfilled with guessed destinations.
6. Add a same-salon terminal-client trigger to every direct operational
   `salon_client_id` foreign key. It closes the stale-writer race where a
   request resolves the duplicate just before a merge, then inserts after the
   merge commits; contact and financial snapshots remain untouched.
7. Make an already-merged source profile immutable with a `BEFORE UPDATE`
   trigger. This prevents a stale rewards, review, flag, cache, or contact
   writer from recreating operational state on the preserved source after the
   merge; the first unmerged-to-merged transition remains allowed.

## API and transaction design

- Extend client GET/list responses with lifecycle state, `updatedAt`, birthday,
  server-computed delete eligibility, and merged-primary resolution. Default
  list scope is active; an explicit archived scope enables restore.
- PATCH accepts first/last name (stored compatibly as `fullName`), phone, email,
  birthday, existing salon-managed contact/preferences/tags, and
  `expectedUpdatedAt`.
- Normalize phone with `normalizePhone`; validate exactly ten digits. Normalize
  email by trim + lowercase. Exact normalized phone or email matches against
  another same-salon unmerged profile (active or archived) or alias return
  `409 POSSIBLE_DUPLICATE` with only that authorized salon's summary. Stale writes return
  `409 STALE_CLIENT`.
- Merge preview is assembled server-side and includes both contacts, canonical
  appointment/payment/outstanding counts, notes, photos, preferences, tags,
  communications, rewards, reviews, flags, blocking, and versions.
- Merge confirmation locks both salon-scoped client rows, rechecks versions and
  tenant ownership, handles an already-merged duplicate idempotently, resolves
  active-retention conflicts, relinks stable foreign keys, records aliases and
  immutable notes, applies selected fields, unions tags, conservatively
  combines safety flags, recalculates caches from canonical appointments, marks
  the duplicate merged/archived, and inserts the audit row in one transaction.
  Any error rolls the entire transaction back.
- Archive/restore use compare-and-set version checks and transactional audit.
  Archived clients leave active directories and outreach queues.
- Permanent DELETE requires an archived, unmerged, globally unlinked profile
  with zero meaningful dependencies across appointments, payments,
  communications, campaigns, rewards, referrals, reviews, photos,
  preferences, notes, fraud, or merged aliases. Profiles with history receive
  a non-disclosing conflict response. Because some existing customer sign-up
  paths do not populate `salon_client.client_id`, global client and client
  session phones are also checked through the salon-private contact aliases
  before deletion is offered.

## UI plan

- Add Edit client, Merge duplicate, and Archive client to the existing profile
  More menu. Archived profiles show Restore client and show Delete permanently
  only when the server says the empty profile is eligible.
- Edit uses a modal and surfaces possible duplicates with View existing client
  and Merge profiles. It never performs browser-side merging.
- Merge uses three calm steps: select duplicate, review server preview/conflicts
  and field choices, then an explicit final confirmation identifying “Keep this
  profile” and “Merge this duplicate.”
- Refetch/patch the parent directory and invalidate both detail-cache entries
  after mutations so names, contacts, lifecycle state, and selection stay
  current.
- Use one-column conflict/summary cards on narrow screens, `min-w-0` and
  wrapping for long contacts, internally scrolling dialogs, and no intrinsic
  comparison tables. Verify desktop and exact 390×844 geometry/overflow.

## Test and delivery gates

- Add PGlite integration coverage for normalized edits, same-/cross-salon
  duplicates, stale writes, snapshot-preserving future reminders, full merge
  dependencies, conflict selections, canonical totals/outstanding, no copied
  rewards/financial rows, rollback, idempotency, tenant/role denial, archive,
  restore, directory filtering, and hard-delete eligibility.
- Add component coverage for More-menu controls, duplicate warning actions,
  merge preview/confirmation, archive/restore/delete, cache refresh, and
  unchanged Book/Text/Call. Add desktop and exact 390×844 overflow coverage.
- Run focused tests, the full suite, type-check, configured lint, direct
  changed-file lint, secret scan, production build, and `git diff --check`.
- Commit only this worktree, push one `agent/client-edit-merge-archive` branch,
  and open one draft PR. Do not merge or deploy; keep the PR draft until Preview
  verification passes.

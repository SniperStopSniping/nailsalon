# Client edit, merge, and archive plan

## Scope and invariants

- Keep the existing Clients directory/profile and Book, Text, and Call actions.
- Do not redesign booking, checkout, Client Insights, cancellation/no-show
  policy, service images, unified timeline, or Marketing. Client Insights is
  integrated only where lifecycle state and merged aliases affect its existing
  canonical projection.
- Every lookup and mutation stays salon-scoped. Staff authentication remains
  unable to call owner/admin lifecycle routes.
- Production merge/archive/restore/delete controls default off until migration
  0061, the new application, and health checks have succeeded. Preview and test
  environments default on. `CLIENT_LIFECYCLE_MUTATIONS_ENABLED=true` is the
  explicit production activation step; profile editing remains available.
- Preserve appointment/contact/financial snapshots. Current contact details
  are used for future outreach without rewriting past rows.
- Never mutate or merge the global customer account or phone-based customer
  sessions. Salon contact aliases are internal resolution aids, not customer
  authentication aliases. Phone edits and merges fail closed when either the
  existing aliases or proposed phone resolve to a global customer/session
  identity. Identity reconciliation is deferred to a separate workflow.

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
| Client Insights projection and segment directory | Stable ID first; unique salon-private legacy phone fallback | Project only active, unmerged profiles. Resolve old-phone aliases only to their active primary. A stale non-null stable ID never falls back. Merged history contributes once; archive removes the profile from KPIs, actionable queues, and segment pages until restore. |
| Communication consent/delivery | Salon + recipient snapshot, and/or appointment | Preserve as historical evidence. Current contact changes do not rewrite it; appointment-linked delivery remains reachable through the appointment. |
| Cached visits/spend/no-shows/last visit/rebook due | Mutable cache on `salon_client` | Recalculate from canonical, salon-scoped appointments after relinking; never add two cached totals. Preserve loyalty/reward ledger rows rather than duplicating them. |
| General `audit_log` | Immutable salon/entity/action metadata | Insert edit, merge, archive, restore, and delete audit rows inside the authoritative transaction, including actor, IDs, versions, changed fields, and merge field selections. |
| Migration `0052` backup tables | Historical copies keyed by client/appointment ID | Operational backup only; never mutate during profile operations. |

## Smallest safe migration

1. Add `birthday`, `archived_at/by`, and `merged_into_client_id` plus
   `merged_at/by` to `salon_client`, with indexes for active/archive/merge
   resolution.
2. Retain the released full salon-phone unique index. v1.33.0 still issues
   `ON CONFLICT (salon_id, phone)` without a partial-index predicate, so
   replacing that index before the application deploy would immediately break
   client creation. A merged source receives a non-contact `merged:<id>`
   tombstone in its current-phone field; its real phones remain attached to the
   primary as salon-private aliases and remain unchanged in appointment,
   receipt, and communication snapshots.
3. Add a unique `(salon_id, id)` key and a validated composite foreign key from
   `(salon_id, merged_into_client_id)` to it. A merge target is therefore
   database-enforced to belong to the same salon.
4. Add a salon-scoped `salon_client_contact_alias` table for normalized historic
   phone/email values. It supports legacy history, duplicate detection, and
   safe resolution of old links without changing customer authentication.
5. Add immutable `salon_client_note` rows so both profiles' notes survive a
   merge without fabricating a combined mutable note.
6. Add `destination_snapshot` to `client_communication`; existing rows remain
   null and are never backfilled with guessed destinations.
7. Add a serialized merge-transition trigger that requires an active terminal
   target and rejects missing/foreign targets, self-links, cycles, and chains
   beyond the bounded resolver depth, including for direct SQL writers.
8. Add a same-salon terminal-client trigger to every direct operational
   `salon_client_id` foreign key. It closes the stale-writer race where a
   request resolves the duplicate just before a merge, then inserts after the
   merge commits; contact and financial snapshots remain untouched.
9. Make an already-merged source profile immutable with a `BEFORE UPDATE`
   trigger. This prevents a stale rewards, review, flag, cache, or contact
   writer from recreating operational state on the preserved source after the
   merge; the first unmerged-to-merged transition remains allowed. Permanent
   delete eligibility stays in the transactional service so salon cascades and
   a future explicit privacy-erasure workflow remain possible.

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
  `409 POSSIBLE_DUPLICATE` with only that authorized salon's summary. Stale
  writes return `409 STALE_CLIENT`.
- If a phone edit or either side of a merge is linked by `client_id`, a global
  customer phone, or a customer session phone, return
  `409 EXTERNAL_IDENTITY_CONFLICT` before mutation. Name, email, birthday, and
  salon-managed preference edits remain available when they do not alter the
  unsupported login identity.
- Merge preview is assembled server-side and includes both contacts, canonical
  appointment/payment/outstanding counts, notes, photos, preferences, tags,
  communications, rewards, reviews, flags, blocking, and versions.
- Merge confirmation locks the salon lifecycle row and both client rows in
  stable order, rechecks versions and tenant ownership, handles an
  already-merged duplicate idempotently, resolves
  active-retention conflicts, relinks stable foreign keys, records aliases and
  immutable notes, applies selected fields, unions tags, conservatively
  combines safety flags, recalculates caches from canonical appointments, marks
  the duplicate merged/archived, and inserts the audit row in one transaction.
  Any error rolls the entire transaction back.
- Marking the source merged also replaces only its now-nonoperational current
  phone with a unique non-contact tombstone. This frees either selected real
  phone for the stable primary while preserving v1.33.0's full conflict target;
  aliases, previews, audit metadata, and historical destination snapshots retain
  the real source contact.
- The active Client Insights CTE excludes archived/merged rows before any KPI,
  segment, attention, sort, search, or pagination calculation. Its legacy
  phone candidates include only aliases owned by active primaries, so relinked
  stable history and old-phone history cannot create a second client row.
- Archive/restore use compare-and-set version checks and transactional audit.
  Archived clients leave active directories and proactive outreach queues.
  Existing appointments remain scheduled, and their transactional appointment
  reminders continue against the current primary contact unless the appointment
  itself is cancelled.
- Rollout order is migration 0061, v1.33.0 write smoke, new application with
  lifecycle mutations still disabled, health/Preview verification, then
  explicit activation. A failed application deployment can therefore roll back
  to v1.33.0 while the additive schema is present and before any lifecycle
  state exists.
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
- Add genuine PostgreSQL coverage for stale inserts racing a merge, opposing
  merge attempts, terminal-primary resolution, database cycle prevention, and
  transaction rollback/retry. Run the real chain both from zero and over the
  exact v1.33.0 migration journal.
- Add component coverage for More-menu controls, duplicate warning actions,
  merge preview/confirmation, archive/restore/delete, cache refresh, and
  unchanged Book/Text/Call. Add desktop and exact 390×844 overflow coverage.
- Run focused tests, the full suite, type-check, configured lint, direct
  changed-file lint, secret scan, production build, and `git diff --check`.
- Commit only this worktree, push one `agent/client-edit-merge-archive` branch,
  and open one draft PR. Do not merge or deploy; keep the PR draft until Preview
  verification passes.

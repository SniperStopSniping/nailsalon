# Real owner edit, Canva browser qualification and backup recovery

The current application source baseline is `3b7baeff`. Its CI run39372657086
passed the full Vitest suite, all three builds, native database gates and
application/customer browsers, but failed six manual artwork cases in the
owner-operations browser fixture. The retained trace identified a second React
hook dispatcher when lazy-loading dnd-kit. The scoped fixture now prebundles those
dependencies with React and explicitly deduplicates React/React DOM. The upload
test also waits for the actual file control rather than waiting90seconds after
the editor has failed to load. No application component, booking or AI provider
implementation changed in this fixture correction.

The complete affected suite now passes **70/70 cases** locally in desktop
Chromium and iPhone-profile WebKit, including tall, wide and small artwork,
unchanged visible pixels, clickable Instagram, background selection, reload and
media transport. Full TypeScript, scoped ESLint and whitespace checks pass.
These deterministic fixture tests do not prove a real AI provider or Clerk
signup. Exact new-head CI and hosted qualification remain required.

## Actual model-generated owner edit

[Real-provider evidence](real-owner-edit.json) records one normal owner-chat
request on the branch-bound, isolated `df269cfe` hosted Preview. Application
runtime modules are unchanged between that served source and `3b7baeff`; this
does not relabel it as an exact-new-head deployment.

“Make the mobile version less crowded.” produced revision128 from127 using one
OpenAI `gpt-6-luna` call:8,753 input/7,352 output tokens,62.544seconds and estimated
USD0.004771 provider cost. The conservative trial allowance was CAD0.009542 and
synthetic retail credits CAD0.013359. These are application measurements, not a
reconciled provider invoice. The CAD80 combined testing limit was unchanged.

The composer cleared immediately, the working state survived a refresh, another
refresh retained the completed result, and only one paid call/owner message
existed. The model preserved HTML and changed mobile CSS; no developer repaired
the generated source. Both immutable designs and their parent link remain.
All34 appointments, services/staff, published revision98 and other draft settings
were preserved. The legacy manual editor's draft-pointer/timestamp mirror changed
as expected. The preview had no horizontal overflow at351pixels; desktop/mobile,
loading, resume and exact-review screenshots are retained privately. The reviewer
did not approve or publish this additional design edit.

## Actual backup restoration

[Recovery evidence](backup-restoration.json) records restoration of the existing
private Preview archive into a disposable, socket-only local PostgreSQL16 cluster.
All135 public tables,1,892 rows and112 migration ledger entries matched their
captured fingerprints. The cluster was stopped. No application worker, provider
credential, model request, payment or outbound message was involved.

The source is PostgreSQL17, so this is cross-major evidence, not same-major or
Production recovery qualification. The local stream removed only the unsupported
`SET transaction_timeout = 0` prologue; the original archive/checksum stayed intact.
Two failed local setup attempts are retained: the empty target needed clean schema
recreation, and schema-scoped archives omit the `btree_gist` extension required
by the booking exclusion constraint. The already-installed standard extension
was provisioned locally; no constraint was weakened and no package installed.
The migration runbook now documents these prerequisites and evidence boundaries.

Production remains unreleased. Exact-head qualification, live payment/renderer
configuration and the guarded Production migration remain separate gates. Raw
model output, credentials, uploaded content, customer management capabilities and
private database backups are excluded from Git.

## Further recovery and readiness qualification

The subsequent [same-major recovery](backup-restoration17.json) used a private
PostgreSQL17.11 build from the checksum-verified official source archive. No
system package or Luster dependency changed and Docker remained stopped. The
[build provenance](private-postgresql17-build.json) excludes local binary paths.

The original backup restored without stream edits into a fresh private Unix
socket cluster. Its135 tables/1,892 rows and112 migration entries matched the
captured baseline. `btree_gist` was provisioned in public between the pre-data
and post-data restore stages; the appointment exclusion constraint was present
and validated. The installed Drizzle migrator, pinned only to that fresh local
socket, advanced112→113, preserving all prior table fingerprints and matching
every committed migration hash/time. A second migration was an exact no-op.
The cluster is stopped. This qualifies recovery of this Preview archive on the
same PostgreSQL major; a fresh Production backup/target attestation is still
required before the Production migration.

The930 CI run separately exposed an asynchronous client-profile test assertion:
the payment labels can be ready before the detail response and actual values.
A deferred response deterministically reproduced its missing$100 failure. The
test now verifies the pending absence, resolves the response, and waits for the
actual value, preserving every payment/deposit/refund/balance assertion. All43
cases pass on both Node22.23.2 and24.19.0; full TypeScript and scoped lint pass.
No payment calculation or application component changed. See the
[readiness proof](client-payment-readiness.json); exact follow-up CI is required.

The same CI application job exposed three five-second timeouts in the four-case
saved-AI-work fixture-reset matrix. Each case migrates the entire schema, applies
the synthetic fixture, inserts protected owner work and proves reset refuses it.
Those four cases now use the same bounded30-second DDL budget as the file's other
full migration/reset rehearsals. No assertion, fixture, target/tenant guard or
project-wide timeout changed. Both affected files pass **83/83** cases on both
Node22 and24; these timings do not qualify the next CI run.

The930 customer browser job also timed out while one WebKit tab navigated all24
headers under a single180-second deadline. That markup-preservation matrix now
uses one isolated test/context per header. All24 layouts and the original
390/1440px Chromium and390px WebKit coverage remain: **120 exact Services markup
comparisons**, now **72/72 passing browser cases** across three browser projects.
No production markup, booking behavior or assertion changed. Per-header cases use
the existing90-second suite budget. Scoped lint has zero errors and13 existing
conditional-test warnings. [Browser isolation evidence](quickbook-isolation.json).

At the owner's explicit request, the existing working builder credential was
authenticated by non-billable model GETs and staged as a Production-only Vercel
Secret. [Staging evidence](production-openai-staging.json) contains no credential
value. No Development Clerk or Stripe sandbox key was copied, no Production
secret was decrypted/read back, and activation flags remain off. This removes
the unnecessary additional OpenAI sign-in step; it does not establish a deployed
Production AI experience or live Stripe credit-purchase acceptance.

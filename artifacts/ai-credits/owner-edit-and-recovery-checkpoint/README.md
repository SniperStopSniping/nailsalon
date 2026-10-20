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

Production remains unreleased. Live provider/payment configuration, exact-head
qualification, same-major recovery evidence and the guarded Production migration
remain separate gates. Raw model output, credentials, uploaded content, customer
management capabilities and private database backups are excluded from Git.

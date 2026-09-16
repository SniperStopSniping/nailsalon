# Luster billing — isolated Isla **Preview** rehearsal

**Status: PREPARATION DOCUMENT. Nothing here is authorized by its existence.**

This document is the Preview-only companion to `docs/BILLING_PRODUCTION_RUNBOOK.md`. It mirrors, phase by
phase, the sequence in `FINAL_IMPLEMENTATION_HANDOFF.md` §9 ("Reaching the Isla Preview rehearsal — exact
sequence"), and its seven numbered sections below are that document's seven numbered phases, in order.

## 0. Scope

### 0.1 What this document does NOT authorize

Reading, reviewing or merging this document performs **no** Stripe change, **no** Vercel change, **no**
database change and **no** deploy. Specifically, it does not authorize:

- creating, updating, disabling or deleting any Stripe object in **any** account or mode;
- setting, changing or removing **any** environment variable in **any** Vercel scope — Preview, Production
  or branch;
- flipping any `BILLING_*` switch anywhere, in any environment, for any duration;
- running the seed script's `--apply`, the starter grant's `mode: 'apply'`, or any migration;
- touching Production in any way. The only Production change in this whole plan is migration `0078`
  (additive, PR-3, under the guarded procedure), and it is not performed by this document either.

Every step below that changes provider state is **owner-executed** and additionally requires the written
authorization named in §5 (gate G9). An agent executing this document may prepare commands, read evidence
and run the read-only harness; it may not perform a provider-side change.

### 0.2 Production-dark guarantee (holds for every phase)

Throughout every phase below, the Production scope carries **no** `STRIPE_BILLING_WEBHOOK_SECRET`, **no**
`BILLING_SUBSCRIPTIONS_ENABLED`, **no** `BILLING_TOPUPS_ENABLED`, **no** `PUBLIC_PRICING_ENABLED` and **no**
`BILLING_TAX_COLLECTION_ENABLED`. `https://www.lustergel.app/api/health` must report `billing.dark: true`
**before and after every deploy in this plan**, and that snapshot is recorded as evidence each time:

```bash
curl -fsS https://www.lustergel.app/api/health | jq '{gitSha, billing, schemaDrift}'
# expected: billing.dark == true, billing.planEnvMatchesRuntime == true
```

Everything in this document happens on a **Preview branch scope**. An unscoped `vercel env add … preview`
applies to EVERY Preview deployment of the project — always pass the branch.

### 0.3 Owner decisions this sequence depends on

| # | Question | Where it bites |
|---|---|---|
| **O5** | Dedicated Stripe test account / Sandbox for the rehearsal, or the shared test account? | §3 (the provisioner's endpoint inventory and `--acknowledge-shared-account`), §6 D8 (attributability of `billing_stripe_event` evidence). Recommended: **dedicated Sandbox**; it also makes PR-2 deferrable for the rehearsal. |
| **O6** | Accept the Checkly-shared automation bypass secret inside the Stripe endpoint URL, or provision a dedicated bypass secret / a deployment-protection exemption for `/api/webhooks/stripe-billing`? | §2 and §3 (T5 exposure below). Recommended: **dedicated secret or path exemption**. |
| **G9** | Written rehearsal authorization naming: Preview-only scope, test mode only, the exact deployment SHA, the executing persons, the Sandbox (if O5), and the teardown owner. | §5. Without it, phases 5–7 do not begin. |
| **O1** | Ratify the Rev 2.3 legacy-route guard amendment (PR-5). | §6 D4. Once PR-3 has shipped, every top-up session carries a `customer`, so the legacy route's skip no longer protects top-up `checkout.session.completed` events: **PR-5 merged, or B1 proven** (no test-mode legacy/Connect endpoint targets the pilot host, runbook §3.1 executed in test mode) is a hard prerequisite of the D4 top-up drill. |

Owner decisions are recorded outside this repository. This document neither records nor implies them.

---

## 1. Phase 1 — Code completion

Merged, green at exact head, before anything else in this document:

- **PR-1** refund completion (fail-closed exits; the Postgres suite asserting `…_EXECUTED=<n> …_SKIPPED=0`).
- **PR-2** billing-endpoint foreign isolation — required **unless O5 = dedicated Sandbox**.
- **PR-3** `billing_customer` + companions + the billing app-origin fix — recommended; deferrable only by an
  explicit O12 acceptance of the documented limitation.
- **PR-4** this PR: per-target readiness + `/api/billing/readiness` + the salvaged tooling + this document.
- **PR-5** legacy route guards — optional for the pilot, but see O1 above for the D4 gate.

**Record the final `origin/main` SHA. That is the rehearsal SHA**, and every artifact below is stamped with
it. A Preview deployment built from any other commit is not the deployment this document describes.

---

## 2. Phase 2 — Owner-approved Preview infrastructure and configuration

Owner-executed, provider-side, recorded as manual proof artifacts. **No switch, no billing webhook secret and
no price carrier is provisioned in this phase** — those are §3 and §5.

Branch: `pilot-isla`, or the immutable per-deployment URL.

> **T4 — the branch-alias rule.** Vercel's git-branch alias truncates the branch name at 14 characters, so
> every `agent/billing-*` branch collapses onto the same alias and would silently steal another deployment's
> deliveries. Register Stripe against the **immutable per-deployment URL**, or against a branch whose alias is
> unambiguous — `pilot-isla`. The provisioning tool prints the exact URL it will register and the host it was
> allowed for before it writes anything (§3).

### 2.1 Branch-scoped environment

Every row is `vercel env add <NAME> preview <branch>` — always scoped to the branch.

| Variable | Preview (test) value | Set **before the build**? | Why |
|---|---|---|---|
| `BILLING_PLAN_ENV` | `test` | before the deploy | `expectedBillingPlanEnv` demands exactly `test` on Preview; a mismatch is a boot rejection, and the provisioning tool refuses any other value. |
| `NEXT_PUBLIC_APP_URL` | `<pilot origin>` (scheme + host, no trailing slash) | **YES — build-time inlined** | A `NEXT_PUBLIC_*` value is baked into the build. Added after the build, it is simply absent at runtime and the origin falls back to localhost. Set it, **then** deploy. |
| `CRON_SECRET` | a fresh random value | before the deploy | **Not already provisioned on Preview** (runbook §4's "already provisioned" note describes Production). Without it, `isAuthorizedCronRequest` returns false by construction and both cron routes and `/api/billing/readiness` answer 401. |
| `REDIS_URL` | the Preview Redis URL | before the deploy | On a hosted deployment the super-admin login's rate limiter throws `AUTH_RATE_LIMIT_UNAVAILABLE` without Redis, and the login answers **503** — the starter grant in §5 is then unreachable. |
| `SUPER_ADMIN_AUTH_MODE` | `password` | before the deploy | Selects the password login path (`authConfig.server.ts`). |
| `SUPER_ADMIN_TEST_LOGIN_ENABLED` | `true` | before the deploy | Together with `VERCEL_ENV=preview` this satisfies `isPasswordEnvironmentPermitted()`. |
| `SUPER_ADMIN_TEST_PHONE` / `SUPER_ADMIN_TEST_PASSWORD` | the pilot operator's | before the deploy | Compared constant-time; the phone must **also** match an existing `admin_user` row — see §5.1. |
| `LEGACY_OTP_AUTH_ENABLED` | `false` | before the deploy | Keeps the retired OTP surface closed. **Note the interaction with §5.1: with this `false`, the OTP bootstrap route answers `410 LEGACY_OTP_DISABLED`.** |
| `BILLING_IDENTITY_HMAC_SECRET` / `BILLING_IDENTITY_HMAC_VERSION` | a fresh secret / a small integer | before the deploy | Starter grant and identity linking are unreachable without them; the harness checks presence (never the value). |
| Resend / Google Calendar / Clerk / Cloudinary env | the Preview values | before the deploy | Needed for `/api/health` to answer **200** rather than `degraded`/503. |
| `DATABASE_URL` | the **Preview** Neon project | before the deploy | Marker `preview`, zero salons — **re-verify on the day** (gate G6). Migration `0078` is applied there *before* this deployment is built. |
| `BILLING_DEPLOYMENT_MARKER` | optional, e.g. `preview-rehearsal` | only **after** the stamping deploy | Optional. Set it only once the deploy that stamps it has shipped, never before. |
| `LUSTER_NONPROD_DB_HOSTS` | the Preview Neon hostname | not a deployment variable | **Local shell only**, for `scripts/billing-integrity-check.ts` and the seed script to accept a Preview target. |

### 2.2 Deployment protection and the bypass token (T5 — exposure, and O6)

The Stripe endpoint URL registered in §3 carries `?x-vercel-protection-bypass=<token>` so Stripe's POST gets
past Vercel Deployment Protection. **That token is then stored, in cleartext, inside a Stripe dashboard that
other people can read** — and the project's default automation bypass secret is shared with Checkly and must
not be rotated casually. Options, per **O6**:

1. **Dedicated bypass secret for the pilot** (recommended) — a value used nowhere else, rotatable at teardown.
2. **A deployment-protection exemption for the path** `/api/webhooks/stripe-billing`, so no token is needed in
   the URL at all.
3. Accept the shared secret's exposure, in writing, and rotate it after the rehearsal.

Whichever is chosen, the tooling never puts the token into its own argv: pass the URL by variable **name**
with `--webhook-url-env`, never `--webhook-url`. The token is masked in every line the tool emits and is never
sent as a header or an Idempotency-Key.

### 2.3 Exit criteria for this phase

```bash
curl -fsS "https://<pilot-origin>/api/health" \
  -H "x-vercel-protection-bypass: $PREVIEW_BYPASS_SECRET" | jq '{status, schemaDrift, billing, gitSha}'
# expected: status 200 (not degraded), schemaDrift "ready",
#           billing.dark true, billing.planEnvMatchesRuntime true,
#           gitSha == the rehearsal SHA
```

Production health re-checked (§0.2). Nothing billing-specific is armed yet.

---

## 3. Phase 3 — Stripe **test-mode** resource provisioning

Owner-executed, in a dedicated Sandbox if O5 says so. The tool is
`scripts/billing-stripe-test-provision.ts`; run `--help` for the full flag list. It reads its key from
`STRIPE_TEST_SECRET_KEY` only (`sk_test_`/`rk_test_`), demands `BILLING_PLAN_ENV=test`, asserts
`livemode === false` on every object it touches, deletes nothing, and never calls Vercel or the database.

### 3.1 Inventory first (X9 / gate G4, and T3)

Record every test-mode endpoint on the account before anything is created — URL, `enabled_events`, Connect
flag — and execute runbook **§3.1** (legacy endpoint hygiene) **in test mode**:

```bash
stripe webhook_endpoints list --live=false > /secure/outside/repo/test-endpoints-before.json
```

The provisioner prints the same inventory itself, at `--plan` and `--apply`, as the *other* endpoints on the
account (T3). On a **shared** test account every one of them also receives the rehearsal's events, which is
what makes the §6 D8 evidence unattributable; `--apply` therefore refuses unless
`--acknowledge-shared-account` is passed. **A dedicated Sandbox lists none and needs no flag.**

### 3.2 Dry run

```bash
export STRIPE_TEST_SECRET_KEY='<the Sandbox test key — never echoed>'
export BILLING_PLAN_ENV=test

npx tsx scripts/billing-stripe-test-provision.ts --plan --portal
```

Read the payloads, the collision scan and the endpoint inventory. Nothing has been written.

### 3.3 Apply the catalogue — **no endpoint yet** (T6)

```bash
npx tsx scripts/billing-stripe-test-provision.ts --apply \
  --carrier-out /secure/outside/repo/carrier-test.json \
  --portal \
  [--acknowledge-shared-account]        # only on a shared test account (O5)
```

This creates/reuses the Products, the 6 recurring and 7 one-time Prices, the founding Coupon
(with an **explicit** `coupon_<8+ alnum>` id — a Stripe-generated id fails the carrier regex and takes the
whole deployment down at boot, X1), and — with `--portal` — the D16 Customer Portal configuration with
`subscription_update` disabled. It then prints the staging steps and **stops**: no webhook endpoint is
created, reused or re-enabled without `--create-webhook`.

If the portal configuration it creates is not the account default, the tool says so loudly: `is_default` is
read-only in the API, so making it the default is a Stripe Dashboard step (test mode → Settings → Billing →
Customer portal), and `--verify --portal` checks the **default** configuration.

### 3.4 Validate the carrier before it goes anywhere near a deployment

```bash
npx tsx scripts/billing-readiness-check.ts --target dark \
  --env-source env-file --environment preview \
  --env-file /secure/outside/repo/preview.env --git-branch pilot-isla
```

(No duplicate ids, no unknown keys, `env: "test"`.) Then stage the carrier and rebuild:

```bash
vercel env add BILLING_STRIPE_PRICE_IDS preview pilot-isla   # paste the carrier JSON
# redeploy the branch, so the new value is present in the running deployment
```

### 3.5 Arm the endpoint — the deliberate final step (T4, T6, T7)

```bash
export PILOT_WEBHOOK_URL='https://<pilot-origin>/api/webhooks/stripe-billing?x-vercel-protection-bypass=<token>'

npx tsx scripts/billing-stripe-test-provision.ts --apply \
  --carrier-out /secure/outside/repo/carrier-test.json \
  --webhook-url-env PILOT_WEBHOOK_URL \
  --allow-host '<pilot hostname>' \
  --create-webhook \
  --webhook-secret-out /secure/outside/repo/whsec-test.txt \
  [--acknowledge-shared-account]
```

- `--allow-host` is **required** with a webhook URL (T2) and must equal the URL's hostname; known production
  hosts (`lustergel.app`, `www.lustergel.app`, `islanailsalon.com`, `www.islanailsalon.com`) are refused
  outright, whatever it says. There is no flag that unlocks them.
- The tool prints the exact URL it will register (bypass token masked), the allowed host, and the T4 alias
  rule, before it writes.
- `enabled_events` is exactly the 13 handled types by construction, and is narrowed back to them on reuse.
- Stripe returns the signing secret **exactly once**. `--print-webhook-secret` prints it *before*
  `--webhook-secret-out` can refuse (T7); the file sink is 0600, outside any git checkout, and refuses to
  clobber a differing file.

Then stage the secret and redeploy again:

```bash
vercel env add STRIPE_BILLING_WEBHOOK_SECRET preview pilot-isla   # paste the whsec_… value
# redeploy the branch
```

**After this redeploy the endpoint is ARMED**: the webhook is live and `billing.dark` flips to `false` on the
pilot deployment. Checkout still refuses, because the switches are still unset (§5).

---

## 4. Phase 4 — Dark verification of the pilot deployment

```bash
export PREVIEW_CRON_SECRET='<the branch-scoped CRON_SECRET>'         # value never printed by the harness
export VERCEL_AUTOMATION_BYPASS_SECRET='<the pilot bypass secret>'   # value never printed by the harness

npx tsx scripts/billing-readiness-check.ts --target rehearsal \
  --env-source deployed --environment preview \
  --health-url "https://<pilot-origin>/api/health" \
  --bypass-secret-env VERCEL_AUTOMATION_BYPASS_SECRET \
  --cron-secret-env PREVIEW_CRON_SECRET \
  --env-file /secure/outside/repo/preview.env --git-branch pilot-isla \
  --webhook-endpoint-file /secure/outside/repo/endpoint.json \
  --portal-config-file /secure/outside/repo/portal.json \
  --cron-proof-file /secure/outside/repo/cron-proof.json \
  --integrity-report /secure/outside/repo/integrity.json
```

Evidence files for that command:

```bash
stripe webhook_endpoints retrieve <billing_endpoint_id> > /secure/outside/repo/endpoint.json
stripe billing_portal configurations list                > /secure/outside/repo/portal.json
LUSTER_NONPROD_DB_HOSTS='<preview neon host>' \
  npx tsx scripts/billing-integrity-check.ts --json      > /secure/outside/repo/integrity.json
```

The cron proof file is the two **manual** invocations from §6 (Preview never schedules crons), recorded as:

```json
{
  "invocations": [
    { "path": "/api/billing/windows/evaluate", "status": 200, "body": { "skipped": "BILLING_DISABLED" } },
    { "path": "/api/billing/reconcile", "status": 200, "body": { "skipped": "BILLING_DISABLED" } }
  ],
  "recordedAt": "<ISO timestamp>"
}
```

**Expected exit codes at this point:**

| Target / source | Expected | Meaning |
|---|---|---|
| `--target dark --env-source deployed --health-url https://www.lustergel.app/api/health` | **0** | Production is still dark. Re-run it at the end of every phase. |
| `--target rehearsal --env-source deployed …` (before §5) | **4** | Target not met, failing **only** on the unset switches. Any other failing check is a stop condition. |
| `--target rehearsal --env-source deployed …` (after §5) | **0** | Ready to rehearse. |
| any target with `--env-source env-file` alone, or `--developer` | **6** | The evidence source cannot prove that target. A `--developer` run can never exit 0 and must never be presented as deployed proof. |
| a missing/unreadable evidence file, an unreachable or 401 readiness endpoint | **5** | Evidence missing. Fix the evidence, do not re-interpret it. |

Also verify, and record:

```bash
# Unsigned POST: proves the secret is SET without ever reading its value, and mutates nothing.
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "https://<pilot-origin>/api/webhooks/stripe-billing?x-vercel-protection-bypass=$PREVIEW_BYPASS_SECRET" \
  -H 'content-type: application/json' -d '{}'
# 400 (INVALID_SIGNATURE) = secret present · 503 (WEBHOOK_NOT_CONFIGURED) = secret absent
```

One Stripe CLI test event → exactly one `processed` row in `billing_stripe_event`. An
`ignored_livemode_mismatch` row means the secret came from a live-mode endpoint — **stop**.

---

## 5. Phase 5 — Explicit switch and grant authorization (**G9**)

**Nothing in this section happens without the written G9 authorization** naming the Preview-only scope, test
mode only, the exact rehearsal SHA, the executing persons, the Sandbox (if O5) and the teardown owner.

### 5.1 Super-admin identity (T1) — bootstrap, never seeded

`scripts/billing-preview-rehearsal-seed.ts` **never creates a super-admin**. `admin_user.is_super_admin` is
hard-coded `false` in its only admin insert, and it refuses to adopt an existing super-admin row as the salon
owner. This is deliberate: a seed script that could mint a super-admin would be the largest privilege in the
system, sitting behind a `--flag`.

What **exists** in the codebase, exactly (nothing here is invented):

1. **Password login** (`POST /api/admin/auth/password-login`, `src/libs/authConfig.server.ts`) —
   `SUPER_ADMIN_AUTH_MODE=password` + `SUPER_ADMIN_TEST_LOGIN_ENABLED=true` + `SUPER_ADMIN_TEST_PHONE` +
   `SUPER_ADMIN_TEST_PASSWORD`, permitted on `VERCEL_ENV=preview`. It **authenticates an existing row**: it
   looks up `admin_user` by `phone_e164 = SUPER_ADMIN_TEST_PHONE` **and** `is_super_admin = true`, and
   answers `401 Invalid credentials` when no such row exists. It never creates one. It also needs
   `REDIS_URL` on a hosted deployment, or its rate limiter answers 503.
2. **The OTP bootstrap** (`src/libs/adminAuth.ts` `shouldBootstrap` / `canReceiveAdminOtp`, consumed by
   `POST /api/admin/auth/verify-otp`) — when `SUPER_ADMIN_BOOTSTRAP_PHONE` is set, the phone matches it, and
   **no super-admin row exists at all**, verifying an OTP creates the first super-admin inside a transaction
   that re-checks that absence. This is the only in-app mechanism that CREATES a super-admin.
   **It is gated by `LEGACY_OTP_AUTH_ENABLED`**: with the `false` that §2.1 sets, `verify-otp` returns
   `410 LEGACY_OTP_DISABLED` and this path is closed.

So on a Preview deployment configured as §2.1 describes, the owner has exactly two honest options, and
chooses one **before** §5.3:

- **(a)** Insert the first super-admin row directly in the Preview database (owner-executed SQL against the
  Preview Neon project, with the `phone_e164` equal to `SUPER_ADMIN_TEST_PHONE`), then sign in with the
  password flow. The seed script will not do this for you.
- **(b)** Temporarily provision `SUPER_ADMIN_BOOTSTRAP_PHONE` **and** `LEGACY_OTP_AUTH_ENABLED=true` on the
  branch scope, redeploy, complete the OTP bootstrap once, then set `LEGACY_OTP_AUTH_ENABLED=false` again and
  redeploy. This widens a retired auth surface for the duration and must be recorded as such.

Record which option was used, by whom, and at what time.

### 5.2 Switches — branch scope only

```bash
vercel env add BILLING_SUBSCRIPTIONS_ENABLED preview pilot-isla   # true
vercel env add BILLING_TOPUPS_ENABLED        preview pilot-isla   # true
# redeploy the branch
```

`PUBLIC_PRICING_ENABLED` and `BILLING_TAX_COLLECTION_ENABLED` stay **unset** (D11). Production stays dark —
re-check §0.2 immediately after this deploy.

### 5.3 Seed the pilot salon and owner (Preview database)

```bash
export PREVIEW_REHEARSAL_DATABASE_URL='<the Preview Neon connection string>'   # never printed

npx tsx scripts/billing-preview-rehearsal-seed.ts --plan \
  --expect-host '<preview neon hostname>' \
  --owner-clerk-user-id '<user_…>' --owner-email '<owner address>'

npx tsx scripts/billing-preview-rehearsal-seed.ts --apply \
  --expect-host '<preview neon hostname>' \
  --owner-clerk-user-id '<user_…>' --owner-email '<owner address>'

npx tsx scripts/billing-preview-rehearsal-seed.ts --verify --expect-host '<preview neon hostname>'
```

It reads `PREVIEW_REHEARSAL_DATABASE_URL` only (never `DATABASE_URL`), requires the typed `--expect-host` in
every mode, demands the single-row `preview` marker in `public.luster_environment` — re-checked **inside** the
write transaction — runs non-`--apply` modes in a `READ ONLY` session, writes exactly three rows in one
transaction with `ON CONFLICT DO NOTHING`, and never deletes or updates anything.

### 5.4 Starter grant — exactly once

Sign in at `https://<pilot-origin>/super-admin`, then from that page's browser console:

```js
fetch('/api/super-admin/billing/starter-grant', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ salonSlug: '<slug>', mode: 'plan' }),
}).then(r => r.json());
```

Review `alreadyGranted` / `wouldGrant`, then repeat with
`{ salonSlug: '<slug>', mode: 'apply', confirmation: '<slug>' }`. A second `apply` must return
`granted: false` — never a duplicate grant.

### 5.5 Re-run the harness

`--target rehearsal --env-source deployed …` (the §4 command) must now exit **0**. Production health: still
`billing.dark: true`.

---

## 6. Phase 6 — The rehearsal (D1–D9, in order)

Every step is recorded with a timestamp and the rehearsal SHA. The two manual cron invocations — Vercel never
schedules Preview crons — are:

```bash
curl -sS -X POST "https://<pilot-origin>/api/billing/windows/evaluate?x-vercel-protection-bypass=$PREVIEW_BYPASS_SECRET" \
  -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' -i

curl -sS -X POST "https://<pilot-origin>/api/billing/reconcile?x-vercel-protection-bypass=$PREVIEW_BYPASS_SECRET" \
  -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' -i
```

`isAuthorizedCronRequest` accepts either `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <value>`,
compared in constant time; with `CRON_SECRET` unset it returns false by construction, so both routes answer
401. While the switches are unset both return `200 {"skipped":"BILLING_DISABLED"}` — which is exactly the
body the §4 cron-proof file records.

| # | Drill | Expected evidence |
|---|---|---|
| **D1** | Arm proof: dark → secret + carrier staged → `billing.dark` flips false on the pilot. | Health snapshots either side; unsigned POST → `400 INVALID_SIGNATURE`; checkout still refuses at the switch gate until §5.2. |
| **D2** | Endpoint evidence + one Stripe CLI test event. | `stripe webhook_endpoints retrieve` export (enabled, url = pilot origin + `/api/webhooks/stripe-billing`, `livemode false`, exactly 13 types); 2xx in the deployment log; **one `processed` row**. An `ignored_livemode_mismatch` row ⇒ **stop**. |
| **D3** | Starter grant `plan` → `apply` → `apply` again. | Second apply `granted: false`; integrity check clean (run with `LUSTER_NONPROD_DB_HOSTS`). |
| **D4** | Top-up cycle: Checkout → `checkout.session.completed` → purchased lot → history; duplicate checkout reuses the attempt; partial **then** full refund → cumulative reversal arithmetic; `refund.updated` without a charge id → `REFUND_EVIDENCE_MISSING` held. | **Only with PR-5 merged or B1 proven** (O1). Purchased-lot and ledger rows; the held row with its exact `detail`. |
| **D5** | Subscription cycle: Checkout → `invoice.payment_succeeded` → **manual** `windows/evaluate` → one `billing_credit_window` granted → **manual** reconcile → no drift for that subscription; duplicate subscription checkout → `ACTIVE_SUBSCRIPTION_EXISTS`. | Both curl transcripts with status and body; the window row; the reconcile summary. |
| **D6** | Refund drill: dashboard full refund of the paid invoice → `charge.refunded` + `refund.updated` → one evidence row, one alert → manual reconcile → `paid_through` unchanged → manual `windows/evaluate` → no grant. Then a failed-refund void (R-2), and the positive direction: a dashboard-driven renewal → applied and granted. | **Record which event type Stripe actually delivers for the failure** (`refund.updated` vs `charge.refund.updated` — the latter is *not* in the handled set). If a card-refund failure cannot be produced in test mode, record that the void was proven through the hourly reconcile safety net and the super-admin refund-evidence endpoint instead. |
| **D7** | Legacy endpoint delivery log for the window. | No new-track events delivered — or, if delivered, the salon row unchanged because the guard landed. Cross-check SQL **empty**: `SELECT id, billing_mode, stripe_subscription_id, stripe_subscription_status FROM salon WHERE id IN (SELECT salon_id FROM billing_subscription);` |
| **D8** | `billing_stripe_event` inventory before **and** after. | Zero `poisoned`; zero `held_anomaly` other than the deliberately induced ones; foreign rows (if any) all `ignored_foreign`. |
| **D9** | Integrity check at the end. | `exitCode 0`, `violations: []`, report saved outside the repository. |

---

## 7. Phase 7 — Evidence, rollback and teardown

### 7.1 Evidence to keep (all **outside** this repository)

- The harness JSON for every phase and every target, with its first line (`evidenceSource: …`) and exit code.
- `stripe webhook_endpoints retrieve` and `billing_portal configurations list` exports.
- The endpoint inventory before and after (§3.1), including the provisioner's own T3 listing.
- The cron-proof file and both raw curl transcripts.
- Integrity reports (start and end).
- `billing_stripe_event` inventories before and after, and the D7 cross-check SQL output.
- Health snapshots for the pilot **and** for production, at every phase boundary.
- The G9 authorization, the O5/O6 decisions, and the §5.1 super-admin bootstrap record.

### 7.2 Teardown — runbook §9 order, on the **branch scope**

Runbook §9 is the rollback authority; this is that order applied to the Preview branch:

1. **Switches off** — `vercel env rm BILLING_SUBSCRIPTIONS_ENABLED preview pilot-isla`,
   `vercel env rm BILLING_TOPUPS_ENABLED preview pilot-isla`, redeploy.
2. **Remove the webhook secret** — `vercel env rm STRIPE_BILLING_WEBHOOK_SECRET preview pilot-isla`,
   redeploy. Every delivery then returns `503 WEBHOOK_NOT_CONFIGURED`.
3. **Disable the endpoint in Stripe** — `stripe webhook_endpoints update <billing_endpoint_id> --disabled`.
   The provisioning tool deletes nothing, ever; this is a human step.
4. **Remove the remaining branch-scoped variables**, including the carrier and — if O6 chose one — the
   dedicated bypass secret, then rotate it if it was ever shared.
5. Seed rows left or purged per the recorded decision.
6. **Final production health snapshot: `billing.dark: true`.**

The two billing cron entries in `vercel.json` stay registered through any rollback (runbook §9): with the
switches off both routes return `200 {"skipped":"BILLING_DISABLED"}`, which is the same dark contract as an
unregistered cron, and removing a cron line trips the CI ladder guard.

---

## 8. Stop conditions (any phase)

Stop, record, and escalate — do not work around — if any of these occurs:

- a Postgres suite **skips** in CI;
- any `held_anomaly` or `poisoned` row that was not deliberately induced;
- **any** `ignored_livemode_mismatch` row;
- any readiness verdict from `--developer` or `--env-source local` presented as deployed proof;
- any request to set a **Production** variable or flip a **Production** switch;
- the D7 cross-check SQL returning a salon row written by the legacy route for a new-track object;
- production health showing `billing.dark: false` at any moment;
- the provisioning tool refusing (exit 3) — read the refusal; it is a gate, not a glitch.

## 9. Exact condition for being ready to begin

PR-1 and PR-4 merged (plus PR-3 unless O12 accepts the limitation, plus PR-2 unless O5 = dedicated Sandbox,
plus PR-5 or proven B1 before the D4 top-up drill once PR-3 has shipped) at a recorded SHA with exact-head CI
green and the refund Postgres suite's executed-count assertion present; phases 2–4 complete with a
`rehearsal` verdict failing **only** on the still-unset switches; O2, O5 and O6 decided (and O10/O12/O13 if
PR-3 shipped); G9 signed naming that SHA; production health `billing.dark: true` at that moment.

---

### Related documents

- `docs/BILLING_PRODUCTION_RUNBOOK.md` — the production activation runbook. §1 preconditions, §2 Stripe
  resources, §3 legacy endpoint hygiene, §4 environment provisioning, §5 dark proofs, §6 the starter grant,
  §7 switch order, §9 rollback order, §10 manual operations queues.
- `docs/luster-billing-remaining-work-plan.md` — the governing plan and freeze table.
- `docs/billing-completion-repair-20260915.md` — the dated repair record.

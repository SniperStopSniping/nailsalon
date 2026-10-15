# Owner generation checkpoint — isolated development

Continues `2b76e2f7` on `codex/ai-business-setup`. This is implementation evidence,
not a replacement plan. No push, PR, hosted preview, deployment or production
migration/data change is authorized or performed.

## What changed

- Business intake and custom frontend generation now use one dedicated server-side
  development key and one persistent budget ledger across **all salons**. There
  is no production/owner-assistant key fallback. Concurrent PostgreSQL reservations
  serialize before paid calls. Unknown usage and interrupted requests retain the
  full reservation; deleting a salon does not erase spend. Reusing a paid call ID
  cannot send the call again.
- The approved initial total is **CAD 40**, enforced both in configuration and the
  ledger schema. Accounting uses **2 CAD per USD** as a conservative safety
  allowance, not an exchange-rate quote: USD 20 of model usage consumes the cap.
  This is unrelated to customer subscriptions, payments or SMS credits.
- The actual API identifier is `gpt-6-astra`, through the existing direct OpenAI
  Responses adapter. Business intake uses the same metered integration. Images
  and PDFs use actual multimodal input; no template chooser replaces generation.
  Source generation reads the existing business, hours, booking rules and service
  draft. A business conversation can request generation after intake without
  asking the owner to re-enter those details.
- Every call records provider/model, operation ID, elapsed time, usage, reserved
  and estimated actual cost. First output, including incomplete text, stays
  private in `setup_ai_call`. Invalid source never reaches the renderer. One
  bounded, separately metered repair may produce a second output. Both remain
  available to the authorized owner as **text-only** evidence.
- Generated service markup must bind the live service name, price, duration and
  service booking button. Copied currency amounts fail validation. Hours can use
  a live binding. An explicit price-change request in design chat routes to the
  service draft; server validation restricts that request to existing service
  prices and rejects unrelated changes or a design regeneration.
- The owner studio shows authenticated reference thumbnails, generation progress,
  model-response evidence and desktop/mobile preview controls. It polls saved
  work after a refresh/interruption. A finished result, including one retained before a source-save failure, can be applied again
  without another model call, using its original operation ID. Existing exact
  approval/publication and revision restore boundaries are retained.
- Eligible existing salons can enter from the Website hub, including salons
  currently using manual layouts. Existing custom websites keep manual access
  when AI is disabled. Switching design still requires draft review/publication.
- Synthetic fixture resets now refuse to delete a salon containing real-provider
  trial evidence. Regression fixtures cannot silently erase paid trial history.

## Secure local configuration

Only use this worktree's ignored, mode-0600 `.env.development.local`:

```
OPENAI_API_KEY_CUSTOM_SITES=<dedicated development project key, entered locally>
CUSTOM_SITE_TRIAL_BUDGET_CAD=40
CUSTOM_SITE_RENDER_ORIGIN=http://127.0.0.1:3198
NEXT_PUBLIC_APP_URL=http://localhost:3197
BUSINESS_SETUP_AI_ENABLED=true
BUSINESS_SETUP_PUBLISH_ENABLED=true
BUSINESS_SETUP_SALON_ALLOWLIST=setup-synthetic-salon
```

The key is **still missing** at this checkpoint. The cap and isolated local
settings are configured. Create a dedicated OpenAI development project/key;
enter it with a local editor, never in chat, source control, shell history or a
production environment pull. Do not copy a production key. The standalone
renderer receives only `CUSTOM_SITE_PARENT_ORIGIN=http://localhost:3197`, never
provider credentials or the application's environment file.

From this isolated worktree, the checker reports only presence, isolation and
non-secret configuration. Its optional verification performs a read-only model
access check, not generation:

```
npx tsx scripts/check-custom-site-trial-config.ts
npx tsx scripts/check-custom-site-trial-config.ts --verify-provider
```

After saving the key, restart only this task's development server. A display name
or Codex subscription does not establish this API project's model access.

The model's documented image input, structured-output contract and standard rates
were rechecked on October 14, 2026:
[model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra),
[token counting](https://developers.openai.com/api/docs/guides/token-counting).
Per million tokens: USD 10 input, 1 cached input, 12.50 cache writes, 50 output.
Input is bounded to 150,000 tokens, below the 272,000 long-context threshold;
output is bounded to 14,000 tokens per design call. No paid tools or fast mode.
No alternate model is silently substituted. A comparison requires verified
capability/rates and uses the same remaining approved cap.

## Verification and current limits

Real-provider calls: **0**. Actual provider spending: **0**. API account access,
reference fidelity and professional design quality remain unverified. Test-double
usage is explicitly recorded as `test-double`, never as OpenAI evidence.

The next real trial uses the actual owner UI: two materially different uploaded
references (including a Canva export) plus an original text brief, then the four
requested visual revisions and the canonical BIAB price change. Each generation
can repair once; every call is admitted against the same remaining cap. Capture
first/final source, revision IDs, reference and desktop/mobile screenshots, then
perform exact review, isolated publication and original customer booking. Do not
manually repair the output or substitute fixture source. Stop on budget exhaustion
and ask before exceeding the authorization. Compare composition, type hierarchy,
images, spacing, colour and responsive behaviour explicitly; a rendered page alone
is not design-quality acceptance.

The existing 12 engineering-fixture browser cases passed again across desktop
Chromium, mobile Chromium and mobile WebKit. They cover six original booking
journeys and six hostile-runtime checks. They are regression evidence, **not**
real generation or reference-recreation evidence. 121 unit/integration/route checks passed across the scoped runs. New deterministic tests cover
retained first/repair output, bounded failures, price-only editing, stale paid
results, owner authorization, and shared unknown-usage reservations. Four PostgreSQL checks passed; PostgreSQL also verifies that concurrent different salons cannot overspend one allowance.

The old disposable PostgreSQL database had an earlier local migration snapshot
without `business_setup_turn`; it was preserved under
`luster_e2e_ci_before_generation_20261014`. The fixed disposable target was recreated
from all current migrations before concurrency verification. The separate local
Development database received only additive migration 0100. Nothing remote ran.

Still incomplete: real-provider visual and iterative acceptance; new-account
onboarding bootstrap/card replacement; menu extraction/review; remaining staff and
policy configuration; richer conflict reconciliation; cancellation/durable job
recovery and retention/deletion; public SEO and broader rendered accessibility.
The worker interaction boundary and production-isolation gates described in
`tools/custom-site-renderer/README.md` still apply. This is **not** the completed
essential release.

Installed Vercel CLI is 64.0.2. 64.1.0 is recommended for agentic improvements, but
no CLI compatibility issue blocks this local generation path. No global upgrade
was performed. Push/PR remain held until automatic deployment behaviour and
hosted-preview isolation are established.

# Custom frontend checkpoint — local pilot

Historical checkpoint at `2b76e2f7`. See [owner-generation checkpoint](owner-generation-checkpoint.md)
for the current shared CAD budget, dedicated-key setup and repair/evidence flow.

Continues `codex/ai-business-setup` on top of `b62aeb9e`; no production operations.
This changes the design architecture from preset combinations to immutable HTML,
CSS and interaction source. The completed business draft, approval, publication
and original booking infrastructure remain in use.

Implemented:

- Free-form frontend source, responsive CSS, SVG geometry, custom typography
  stacks, layers, animations and worker-backed visual interactions. No Luster
  template/section registry is involved in these pages.
- Private JPG/PNG/WebP reference/logo/photo uploads through the existing validated
  media storage, plus private PDFs limited to six pages and 3 MB.
- Astra multimodal generation and source iteration through the existing Responses
  adapter. Token counting precedes a budget reservation and a paid generation.
  No tools, model publication authority, provider secrets or customer records.
- Shared-draft source saves, manual text/source editing, immutable version history,
  restore-as-draft, exact approval and publication. Ordinary preset edits cannot
  silently replace a custom site.
- The same standalone renderer for private preview and public pages. Actual
  service names, prices and times are filled from the draft/live projection.
  Book buttons route to the existing service selection with the service selected;
  time selection, deposits, rules, creation and management remain in Luster.

The two visual samples are **hand-authored engineering fixtures**, deliberately
labelled as such. They exercise materially different markup/CSS, not presets.
They are NOT evidence of Astra generation or visual fidelity to uploaded designs.

Real-provider trial remains blocked on an isolated key configuration and an
explicit trial spending cap. Required local-only variables are
`OPENAI_API_KEY_CUSTOM_SITES` and `CUSTOM_SITE_TRIAL_BUDGET_USD`; no production key
is reused. No paid model call has been made. Usage numbers in deterministic tests
are fake-provider test inputs, not measured spend. The application records actual
reported input/output/cache-write usage when a real call runs; missing usage
retains its reservation. The trial budget is per enrolled salon, not a billing
or SMS-credit change.

Current official contracts used:

- [Astra capabilities and pricing](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Exact input counting including images/PDFs](https://developers.openai.com/api/docs/guides/token-counting)
- [Reference file inputs](https://developers.openai.com/api/docs/guides/file-inputs)

Local verification (synthetic accounts; loopback PostgreSQL; no paid AI calls):

- 406 unit/integration/route checks passed across the scoped runs, including
  source validation, tenant/owner authorization, immutable revisions, provider
  contracts, exact multimodal token preflight, stale changes before paid calls,
  removed-photo privacy and existing manual/public website behavior.
- Three tests on attested disposable PostgreSQL passed: concurrent duplicate
  publication, concurrent manual edits and transactional failure/recovery.
- Six complete browser journeys passed: two distinct source designs on desktop
  Chromium, mobile Chromium and mobile WebKit. Each exercised private preview,
  a saved manual source edit, refresh/resume, exact review/approval/publication,
  real service selection/availability and an actual database-backed appointment
  through the original booking UI. Each verified $65 and 60 minutes.
- Six hostile-source browser cases passed on those engines: network/storage/
  cross-salon channel denial, rejected forged booking messages, canonical price
  protection, watchdog termination and preview booking denial.
- The development server restarted at its memory threshold during one mobile
  case. The case passed after restarting this task's local process with a 6 GiB
  heap. Safari testing found and fixed premature blob URL revocation; the test
  harness also now permits local worker blobs while blocking outbound requests.
- Scoped lint has no errors; seven existing/style-test warnings remain.
  The final optimized Next.js build (including type validation) passed.
  The secret scan passed over 3,677 tracked and 584 generated files. An earlier
  scan of unminified development chunks stopped at its file-size ceiling;
  the optimized client build was fully scanned.

Screenshots are engineering fixtures, not real-provider generation claims:

| Source design | Desktop | Mobile Chromium | Mobile WebKit |
| --- | --- | --- | --- |
| Editorial / Atelier | [Website](../../artifacts/business-setup/custom-frontends/desktop-editorial-custom-site.png) | [Website](../../artifacts/business-setup/custom-frontends/mobile-editorial-custom-site.png) | [Website](../../artifacts/business-setup/custom-frontends/mobile-webkit-editorial-custom-site.png) |
| Dark / Nocturne | [Website](../../artifacts/business-setup/custom-frontends/desktop-dark-custom-site.png) | [Website](../../artifacts/business-setup/custom-frontends/mobile-dark-custom-site.png) | [Website](../../artifacts/business-setup/custom-frontends/mobile-webkit-dark-custom-site.png) |

All six corresponding `*-booking-confirmed.png` files are in the same folder.
For example: [editorial mobile booking](../../artifacts/business-setup/custom-frontends/mobile-editorial-booking-confirmed.png)
and [dark Safari booking](../../artifacts/business-setup/custom-frontends/mobile-webkit-dark-booking-confirmed.png).

Reproduce against the task-owned isolated local app and standalone renderer:

```sh
E2E_BASE_URL=http://localhost:3197 E2E_SALON_SLUG=setup-synthetic-studio npx playwright test --config tests/browser/businessSetup/playwright.config.ts custom-design.spec.ts renderer-isolation.spec.ts
npx vitest run --no-file-parallelism src/features/business-setup src/features/custom-sites src/app/api/admin/custom-sites/route.test.ts
# Load only the task's synthetic Development configuration:
NODE_OPTIONS=--max-old-space-size=6144 npx dotenv -e .env.development.local -- npm run build
```

The next acceptance gate is two real Astra generations from materially different
references, iterative chat edits, visual comparison and actual booking completion
for each. The earlier five-reference evaluation remains outstanding. The broader
release still needs onboarding entry/bootstrap, menu extraction/review, the
remaining staff/settings support, richer conflict recovery, durable generation
recovery/retention, public SEO and rendered accessibility/fidelity gates. Custom
fonts/packages and arbitrary DOM scripting are not enabled in this worker-based
pilot. This is not a completed essential release.

See `tools/custom-site-renderer/README.md` for trust boundaries and deployment
gates. A hosted preview, production migration, merge or deployment is not part
of this checkpoint. Git push is held because the connected preview environment's
isolation has not been established.

# OpenAI Luna / Sol and approved cumulative CAD 50 trial

Runtime commit `9b39c59b`, Preview deployment `dpl_HpQAEEggLX6jbZY25g5SgiSxQSRq` (READY; 2m28s build), aliased to https://luster-ai-builder-test.vercel.app. No production deployment or merge.

## Routing and accounting

- Conversation/extraction use `gpt-6-luna`.
- First sites, start-over, major and ambiguous design work use `gpt-6.1-sol`.
- Clearly bounded edits to existing source use Luna. Server routing uses the original owner instruction, not the model's expanded design brief. This is deliberately conservative heuristic routing, not a quality guarantee.
- Only these two identifiers are admitted. Astra is rejected, with no automatic fallback. Automatic repair stays on the selected model.
- Model-specific Standard rates apply to reservations and reported usage, including input caching/cache writes. Historical Astra charges are retained unchanged.
- The original trial ledger is retained. Hosted cap is CAD 43.615594; frozen earlier local allowance is CAD 6.384406; combined authorized cap is CAD 50. The branch-scoped Preview variable and the isolated Preview ledger both enforce the hosted amount. Local paid tests were not run.
- Additive migration 0105 changes only the upper-bound constraint to 50,000,000 micro-CAD; it does not itself raise existing budget values. Applied to attested local disposable PostgreSQL and the hostname/marker-verified Preview DB only. No production migration.

Official rates checked 2026-10-15:
https://developers.openai.com/api/docs/models/gpt-6-luna
https://developers.openai.com/api/docs/models/gpt-6.1-sol

## Verification

85 focused tests passed (model routing, costs, shared drafts, API), plus 5 tests on attested local disposable PostgreSQL (including concurrent reservation across salons). TypeScript, scoped ESLint and diff checks passed. Initial test expectations reflected Astra prices and were updated to the approved rates; the existing 40-dollar DB constraint was caught and replaced by the additive migration before successful runs.

Real OpenAI calls used the owner-facing composer on the synthetic Petal salon, preserving its original Luster services and publishing boundaries. Neither trial published or created appointments. No generated source was manually repaired.

- "Make the main heading smaller on mobile. Keep everything else." Conversation + generation both used `gpt-6-luna`; first generation passed validation. Revision 8, 30.2s owner flow; tracked CAD 0.005144.
- "Completely redesign the hero with an elegant editorial layout. Keep the business details, services, policies and contact links." Conversation used Luna, generation used `gpt-6.1-sol`; first generation passed validation. Revision 10, 55.6s owner flow; tracked CAD 0.088388.
- Both saved new source identities, cleared the composer, retained the trusted Instagram destination, and loaded the saved preview after refresh. This checks actual model compatibility/routing and saved output, not a comprehensive visual-quality benchmark.
- Total verification allowance: CAD 0.093532. Combined cumulative allowance: CAD 39.188646 / 50. These are conservative application accounting amounts (2 CAD per USD), not a reconciled invoice.

Small edits still use the validated source-generation path; this change does not implement source patches or claim that full regeneration has been eliminated.

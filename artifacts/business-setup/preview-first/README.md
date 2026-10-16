# First preview without a mandatory intake interview

A first website request now creates a private custom frontend even when hours, working mode or priced services are incomplete. “Just make it up” invokes the custom frontend generator directly from saved details and selected references, without rereading the image or asking another intake question. Missing identity is displayed as Your salon / Your area only in authenticated preview data; no invented business identity, address or contact details are saved.

For a new unpublished business with no canonical services, the shared draft may receive a Signature appointment at 65 units of its saved currency for 60 minutes and suggested Tue–Sat 10:00–18:00 hours. These are illustrative editable values, not researched recommendations. Known values and explicitly set closed hours are preserved. Existing published salons receive no suggested operational changes during a visual request. There is no parallel service catalog or scheduling engine.

Suggested services remain unconfirmed. Suggested hours persist with an additive `hoursOrigin` field in the existing draft JSON and require owner acceptance or a manual hours edit. Model responses cannot confirm either. Exact revision approval, tenant checks, server-side preview booking denial, canonical service-ID publication and existing appointment preservation remain in place. Source generation no longer requires publication-ready business information. No schema migration is needed.

The first generated design opens automatically. Preview and Details clearly label suggested booking data; the owner can use chat and manual controls to revise it. Suggested hours have an explicit Use these hours control. Missing business identity and working mode still block publication.

Image extraction now uses actual nested objects/arrays in the model response schema rather than JSON encoded inside strings. Legacy saved/test responses remain readable. Invalid extracted facts are discarded rather than applied; an independently requested first visual preview can continue from saved data and labelled suggestions. Safe validation flags retain this distinction in the private ledger. Budget/provider/authorization failures still stop honestly.

The bounded trial conversation ceiling is 200 lifetime turns instead of 40. The affected test owner had 39 prior turns, including eight failed attempts. This does not reset counters or monetary budgets, expand model context (eight recent turns), or raise the approved cumulative CAD 50 cap. The existing generation and token limits remain.

## Deterministic verification

169 focused tests pass across six files: draft persistence/domain integration, first-preview intent, owner UI, preview payload, generated-source validation and isolated frame controls. Tests cover first creation before business readiness, suggested-hours/service approval, exact canonical publication and receipt replay, retaining explicit closed hours, existing salon preservation, malformed extraction and intake fallback, hostile/model confirmation attempts, refresh, UI transition, prior-attempt limits, sandbox protections and preview booking denial. Test model outputs are fixtures/doubles.

TypeScript, scoped ESLint and diff checks pass. Hosted real-provider verification is recorded separately after deployment. No production deployment, migration, merge, live salon mutation or unrelated infrastructure change is authorized by this checkpoint.

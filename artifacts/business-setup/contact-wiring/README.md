# Working contact links and truthful preview refresh

Runtime commits: `d8c1fb52`, `27407d28`, `ee16c75e`. Final deployment `dpl_D2CHtmLeS2Ut1pg5iVZ7w9Pe8AbG`, READY, preview target, build 3m33s; alias https://luster-ai-builder-test.vercel.app. No production merge/deployment/migration.

## What changed

- Explicit short contact-repair requests use an authenticated deterministic action. Unambiguous saved source text can fill missing Instagram/email/phone fields and wire the same draft, without a model call or full design generation. Other/mixed instructions continue through the normal conversation path.
- Recovery ignores hidden/template/script content and metadata/ARIA labels. Existing saved values win; ambiguous details require an answer. Legacy fallback text in contact data bindings is recoverable only during explicit owner repair.
- Contact text and destinations use structured saved data. Known plain text, generic contact anchors and standalone contact fields can be wired by the application. Layout CSS, worker JavaScript, asset IDs and unrelated copy are preserved. Normal generation retains raw provider output and applies this disclosed deterministic binding step before validation; it is not a secret developer design repair.
- Generation/publication reject contact anchors or contact fields without a saved destination, even when the entire website-details object is absent. Conflicting copied contact text is rejected. This closes the reported missing-destination case; it does not claim exhaustive visual/CSS accessibility validation.
- Contact-only structured corrections do not invoke website generation. Source and contact values use the existing shared draft revision and exact publication boundaries. Existing public pages and operational booking settings are unchanged until owner approval/publication.
- The embedded preview now keys its isolated frame from the same loaded snapshot as its payload. Previously the parent revision could mount an old payload into a new one-shot renderer, leaving the old page permanently visible when the payload later arrived. Out-of-order loads are ignored.

## Verification and honest iteration history

109 focused deterministic tests passed across domain persistence, contact recovery/validation, API authorization and components. Nine renderer browser checks passed across desktop Chromium, mobile Chromium and mobile WebKit, including contact popups with no opener. TypeScript, scoped ESLint and diff checks passed.

The first actual-owner repair was rejected because legacy email fallback text was skipped; no draft/source revision changed and no AI call ran. A regression case was added and fixed. The next repair successfully saved the contacts, but the same-session tap test exposed the preexisting stale-preview bug. That bug was fixed before handing off.

Final hosted checks used dev Clerk authentication, existing owner authorization and the ordinary owner workflow:

- Affected owner draft: contact repair revision 24 → 25, artifact `b59762ab-7674-42b3-b103-3e9a13c90faf`. Actual Instagram tap opened the expected URL with no opener. Navigation was intercepted to avoid fetching the real external profile; this proves the click/destination, not loading Instagram's authenticated content. Refresh retained the saved state. Immutable before/after records confirmed unchanged CSS, JavaScript, business settings, hours, booking configuration and services. The repair operation had zero AI ledger calls. Screenshots containing the owner's original content remain private outside Git.
- Separate synthetic salon: manually changed the saved Instagram handle through Details, then opened Preview. The new destination appeared without a page refresh and without changing the source artifact. This specifically exercises the old stale-preview failure. No model calls, publication, appointments, messages or payments were created.

Combined cumulative AI allowance remained CAD 39.211042 / 50. This repair and its checks consumed no paid AI calls. Amounts are conservative application accounting, not a reconciled provider invoice.

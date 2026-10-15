# Owner onboarding refresh — 2026-10-15

Scope: improve the owner-facing builder, keeping the published Forma sample design and the original booking system unchanged.

- Start with Upload a design or Describe your idea. Desktop retains conversation beside the design; phone uses separate views. A selected entry opens and focuses the relevant controls. The large welcome choices become compact after selection.
- Uploads explicitly distinguish My own business from Style inspiration. Only the explicit Read my business details action requests factual extraction. Uploaded files reuse the private tenant-owned media path.
- Astra returns constrained facts, not actions or IDs. The server creates an unaccepted review without editing the draft. Unknown prices/durations stay unresolved; from/range prices are not silently converted to fixed amounts; add-ons remain separate; unspecified hours and existing buffers are preserved. An address is never made public by extraction.
- Use these details applies the stored, validated proposal to the shared draft. Accepting/dismissing is tenant/owner checked, serialized with draft edits, and idempotent. Changed draft versions require rereading. Review survives refresh; AI outage does not prevent accepting/dismissing a stored result. Prices/durations still need normal review before publication.
- Saved information is summarized in the conversation. Owners see only the next missing details and can correct fields manually. Business model/intake prompts reuse accepted extracted facts. No duplicate service catalogue.
- Existing website preview now scales its actual desktop viewport to fit, with a full-preview link; mobile stays independently selectable. Generated source, sandbox/runtime, approval and publication boundaries are unchanged.
- Migration `0104_setup_upload_reviews` expands only the existing turn-status constraint. Existing rows remain valid; no salon configuration or appointments are changed. Apply before this application version; rolling back the app does not require deleting new review rows.

Validation before hosted trial: 84 focused tests passed (39 isolated PGlite integration, 8 request authorization/gates, 5 UI, 32 timeline/trial/renderer/payload/source validation); TypeScript and scoped ESLint checked separately. Desktop 1440 and phone 390 browser checks cover both entry choices, focus, upload classification, draft readiness gate and no page overflow. Local calls use no AI provider key and block browser egress. No reset of existing real-provider trial data.

Evidence: `artifacts/business-setup/onboarding-refresh/`. Hosted real extraction and deployment are recorded separately when completed. These deterministic checks do not by themselves claim that a real upload has been extracted successfully.

## Separate short-prompt design comparison

The actual hosted builder also ran the user's simple sentence, “Create a website looking like this, but a little bit better.”, against the earlier reference and owned photos, with start-over enabled and no previous generated source. Result: saved revision 13, source `e06ab233-7826-475a-8b5c-9ec040bdc0f3`, about 79 seconds, USD0.330430 recorded estimate. It produced a pink/black editorial composition with overlapping photos. It is a looser interpretation than the detailed-prompt scrapbook design: it does not reproduce the bubble lettering/torn poster composition closely. No manual source repair. It remains unpublished; the liked revision 11 stays public. Evidence is retained in `hosted-trial/29-simple-prompt-*` and `simple-prompt-evidence.json`.

The two successful calls used for the liked published pink/black page total USD0.997743, plus an unresolved timeout conservatively reserved at USD0.945286. These are token-ledger estimates/reservations, not a reconciled provider invoice. Cumulative trial accounting before the new extraction test is CAD13.184190, including the frozen local ledger and timeout reserve, against the CAD40 maximum.

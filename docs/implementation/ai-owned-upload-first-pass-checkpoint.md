# Owned upload: first-pass extraction and clickable Canva acceptance

This follows `ai-canva-owner-checkpoint.md`. It tests the real owner application on the same attested loopback Development database and separate renderer, with the existing shared CAD80 trial ceiling. No production change, deployment, Stripe purchase or customer communication occurred.

## What changed

Owned business-reference intake and explicit upload extraction now use the configured visual design model (`gpt-6.1-sol`, medium reasoning). Ordinary typed intake remains on `gpt-6-luna`. The shared extraction prompt requires exact printed contact spelling, prohibits deriving Instagram from email/name/filename, and requires null plus an uncertainty note when a character cannot be read reliably. This does not relax validation, consent, scope, tenant authorization or publication approval.

Conversation usage records retain the model used for each response, including a bounded repair. Their aggregate estimate now uses that model's rates rather than assuming every intake call used Luna. Integration assertions compare the conversation estimate with the independent per-call ledger and retain null for unknown usage.

## Fresh owner trial

The new synthetic salon is `paid-ai-solcanva-18f0bdda`. The owner attached the supplied Dynasty image using **My design or menu → Keep my Canva design**, confirmed rights for the isolated reproduction, and sent the same business/services message used in the prior trial. It supplied solo work, Brampton, Tuesday–Saturday 10:00–18:00, five explicit CAD prices/durations and private-address preference, while asking the application to read the image's remaining facts and preserve the artwork.

Exactly two real provider calls completed and passed validation, without a repair or follow-up correction:

| Stage | Model | Input/output tokens | Provider-usage estimate | Generation time |
| --- | --- | --- | --- | --- |
| Owned business intake | gpt-6.1-sol | 5461 / 1770 | USD0.031351 | 33.986 seconds |
| Canva clickable areas | gpt-6.1-sol | 1861 / 1761 | USD0.022261 | 31.210 seconds |

The first generated artifact is `93eb1ca9-4833-4ea3-afb1-17022d699cda` at revision 4. The saved Instagram and email matched the readable reference; public directions included both Dixie and Countryside. Owner review created revision 5, and accepting the displayed prices/times followed by exact approval published revision 6. No developer source edit, manual contact correction, invented photography or third-party scheduling link was used.

Desktop and mobile checks tapped human-measured points on the printed Instagram, email and Lash Services SELECT text. Each point hit its intended overlay. The phone Instagram click attempted the saved destination; the test blocked the external request. The artwork loaded with the original normalized image dimensions, no horizontal overflow, proposed prices/durations and private virtual service IDs. The frame could not read parent or own cookies. No live service, public website or booking setting changed during generation.

The anonymous customer then selected the actual canonical Lash Services hotspot and completed the original native service/artist/time/confirmation journey. One browser POST returned HTTP 201 and saved appointment `appt_e3992a2b-a711-443f-818e-522fc29f1969` for **6500 cents / 75 minutes** with eligible synthetic staff. This is persisted booking evidence, not a mocked receipt or direct positive API call.

## Evidence, cost and limits

- Safe outcomes/usage: `artifacts/ai-credits/canva-first-pass-checkpoint/evidence.json`.
- Original captures and recordings: `/tmp/luster-ai-sol-canva-first-pass-evidence-20261018/paid-ai-solcanva-18f0bdda/`; retained privately, not added to Git.
- First and final provider output remain in the private call ledger; exact design revisions/hashes remain in artifact history.
- The 130-case draft/integration suite passed after the production changes. Four focused extraction/repair/typed-intake cases then passed after the extra model/ledger assertions. TypeScript, scoped ESLint and whitespace checks passed.

Total provider-usage estimate is **USD0.053612**; trial accounting consumed CAD0.107224 at its conservative fixed allowance. The previous Luna-plus-Sol correction path cost USD0.029512 and required a correction prompt plus a manual handle fix. This single case supports the quality/effort trade-off of Sol for visual extraction; it is not a universal quality benchmark, invoice or live FX quote. The operator cap was not increased or reset.

The low-resolution image's fine policy paragraphs still cannot be reliably transcribed. They remain visible in the unchanged artwork; they are not invented as automated rules or payment collection. The app still recommends a sharper original export. Owner approval is mandatory. Real account/cross-device testing needs the expired Clerk CLI session refreshed (or a matching Development key pair), and Stripe sandbox purchase acceptance still awaits the deferred test key. The whole builder and production release are not declared complete here.

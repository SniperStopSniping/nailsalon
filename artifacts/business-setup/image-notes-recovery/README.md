# Image intake failure recovery

## Observed failure

Two owner requests after Start over reached OpenAI and completed, but their nested image facts represented `notes` as an empty string or a single string. Luster expected an array and rejected the whole response before saving the extracted details. No custom-site generation started. The owner saw only a generic stopped message because the conversation failure reason was not retained and the client replaced failed replies with that notice.

A read-only check of the isolated Preview database verified the selected reference and archived earlier draft remain present. The requests cost an estimated USD 0.001047 and USD 0.001039, respectively, from recorded provider usage; combined USD 0.002086. Conservative application budget accounting is CAD 0.004172 for the two calls. This is not a reconciled provider invoice. Start over itself does not call a model.

## Fix

The shared fact parser accepts validated arrays, encoded arrays, an empty notes string or a single bounded note. It retains every existing fact, permissions, field, length and item-count check. Invalid lists, object notes, oversized values and extra capabilities still fail closed. The extraction instructions explicitly request an array.

Conversation validation records a safe status in the existing private call ledger and stores a useful owner-facing failure reason. Polling and refresh display that reason once rather than duplicate generic stopped notices. There is no automatic paid retry.

## Verification

- 109 committed focused tests passed: 84 PGlite integration tests, 21 owner component tests, and four timeline tests. An existing asynchronous component assertion was wrapped in `act` after a failed first run; the final component run passed all 21 tests.
- One additional private, temporary test replayed both original retained OpenAI outputs through the actual extraction-to-draft domain functions with the database mocked out. Both accepted the readable contacts and policy sections while retaining address privacy. No output, upload or private document was committed.
- TypeScript, scoped ESLint and diff checks passed.
- Deterministic tests use provider doubles. Replaying retained real-provider output is not a new model generation or proof of website visual fidelity.

No production migration, production data change or merge is part of this fix. 

## Hosted verification

Runtime commit `a160eb09451e773b4b5f1d08957e64e432b6398e`, deployment `dpl_tvUHJWecDiQzjBrUfruPfWH8VfPT`, READY Preview, build 2m24s. The stable test alias is https://luster-ai-builder-test.vercel.app/ai-website-test. Production was not deployed.

A synthetic salon used the actual mobile owner controls: Start over, upload the owner-provided screenshot as an own-business design, send “Make exactly like this.” OpenAI `gpt-6-luna` completed in 8.454 seconds (provider call), using 3,155 input and 686 output tokens. Estimated cost USD 0.000738; conservative budget accounting CAD 0.001476. No automatic or developer retry was submitted.

The readable salon name, intersection, Instagram and email were saved. Small policy text was flagged unreadable and category labels were not guessed into priced services. The assistant asked for the genuinely missing working mode, hours and a service with price/time. This verifies image intake, not a newly generated website or booking completion.

The initial browser check incorrectly used an exact-text loading locator that omitted the decorative star; that assertion timed out after the real request had already completed successfully. A separate read-only UI pass verified the saved completion, refresh and a second tab without resubmitting the prompt. Hosted loading screenshots are not claimed. The previous synthetic draft was restored through the owner controls, preserving canonical business/service hashes during restoration. The affected owner's draft was never edited by these checks.

Screenshots and source reference stay in private local test evidence and are not committed. Safe metadata is in `verification.json` and `usage.json`. After this check the cumulative conservative allowance is CAD 39.216690 / 50, including CAD 6.384406 frozen local usage and 84 hosted calls. Unknown prior usage remains reserved. This is application accounting, not the reconciled provider invoice.

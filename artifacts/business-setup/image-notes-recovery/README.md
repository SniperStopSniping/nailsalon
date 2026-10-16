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

No production migration, production data change or merge is part of this fix. Hosted deployment and real-provider verification evidence will be recorded separately after completion.

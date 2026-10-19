# Frame lifecycle and main integration checkpoint

App source **b1d13f8b** installs the trusted parent bridge before navigating the
isolated frame. Every changed payload gets a fresh renderer session and channel,
so an already-initialized renderer cannot keep showing the previous draft or
accept an old session acknowledgement. The opaque origin, CSP, private photo
authorization and original booking integration remain intact. This changes the
trusted parent lifecycle; it does not rewrite the salon's generated source.

Main **224a9ca7** was merged as **371da33d**. The only merge conflict was package
release metadata. Version 1.143.3 and the existing Node24 engine were retained;
dependency declarations and the complete resolved graph are unchanged.

## Actual owner and customer results

- A signed-out IAB browser loaded the previously AI-generated Cobalt frontend on
  desktop, then after a 390px mobile refresh, without using Reload website.
- Its generated Gel manicure button carried canonical service identity
  `585573ae-827d-41cf-a0dc-625d1fa578ed` into the original Luster service screen,
  selecting **CAD50 / 60 minutes**. No new appointment was submitted here.
- A normal Development Clerk login in a second browser resumed the same saved
  photo draft. Revision103 contained the scrollable Gallery saved in Chrome.
  Changing it to Photo grid saved104 and updated the actual isolated preview
  automatically, without clicking reload. The rendered Gallery uses CSS grid;
  the original wide and portrait photos decoded at 1200×480 and 480×960.
- The older Chrome session attempted a description edit from103 after104 was
  saved. It was rejected,104 loaded, and the server retained the newer grid and
  original description. Its unsaved input remained editable; the UI still offers
  Reload saved design. This proves conflict detection, not automatic merging of
  unsaved changes.
- The original private draft was restored as105. Published98, its original
  artifact, all12 existing synthetic appointments, services/staff and the other
  businesses remain intact. There were **zero** provider calls, AI charges,
  new appointments, messages accepted, environment changes or Production actions
  in this continuation.

Screenshots: [desktop](signed-out-desktop.png), [mobile](signed-out-mobile.png),
[canonical generated service booking](generated-service-booking.png),
[updated draft grid](updated-draft-grid.png), and
[rejected stale edit](stale-edit-rejected.png). [Safe structured proof](proof.json)
excludes credentials, browser state, raw provider output and management tokens.
The photographs are the explicitly synthetic geometry fixtures already in the
saved draft. This is not a new AI visual-generation/fidelity demonstration.

## First-load issue remains open

The controlled Chrome browser still left the frame at about:blank on the tested
fresh load and after a draft change. [The failure is retained](chrome-stall-retained.png).
The lifecycle correction does **not** establish that this issue is resolved.
Browser Use also refused raw diagnostics while resolving a paused document
response; that is a tooling limitation, not proof of the cause. Independent IAB
loads and draft updates succeeded, but physical Chrome/iPhone qualification is
not claimed. Do not silently substitute a successful reload for first-load proof.

## Validation and CI

- 82 owner/frame UI tests, 7 renderer/runtime tests, 5 legal tests and 22 CI
  contract tests pass: **116** relevant tests total. Scoped TypeScript,
  changed-file lint, whitespace, commitlint and tree secret checks pass.
- The full protected-surface CI guard passes locally. Its new exact manifest
  pair in **3b7ccae2** covers only the main release-version change. The
  [metadata proof](dependency-metadata-proof.json) confirms that removing root
  version fields makes both manifests identical to the previously reviewed pair.
  Contract tests continue to reject changed or mixed manifests.
- The first full CI run failed that frozen-pair check. The replacement run
  **39326022546** on **3b7ccae2** advanced past it. At this snapshot, 19 checks
  passed, three were pending, and the customer-browser job failed during npm ci with
  **ECONNRESET**, before browser tests ran. GitHub rejected an early job retry
  while the run was active. This is not green or complete CI; retry only the
  failed job after the active run finishes, then inspect its result.
- Exact Preview **dpl_8E2LufheQPS8s5oko6Le1ZEwJN8X** is READY and the test alias
  serves b1d13f8b. The subsequent **3b7ccae2** changes only CI contracts, not app code.
  `/api/health` remains 503/degraded with legacy test-password auth, verified email
  and Calendar absent; DB, Redis and Clerk pass. Full release health is not
  established.

PR461 is now mergeable against main and remains Draft/NO-GO. No merge to main,
Production deployment, credential rotation, database migration, purchase, credit
grant, dependency upgrade or pricing change happened in this checkpoint.

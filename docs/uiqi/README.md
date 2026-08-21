# UIQI release-condition system

The canonical contract is `src/libs/uiqi/uiqiContract.ts`. It is the only maintained semantic list of UIQI conditions. `UIQI-CONTRACT-STATUS.generated.md` is generated from that source and must not be edited manually.

Contract version: `1.0.0`.

## Run the aggregate gate

```sh
npx tsx scripts/run-uiqi-release-gate.ts
```

The command derives every directly runnable current Vitest/source evidence file from the canonical contract, runs it together with the manifest, evaluator, trigger, and report-synchronization tests, then validates the generated report and prints classification/status counts. In CI, the stable **UIQI release conditions** job also depends on **Full Vitest Suite** and **Run all tests**, and passes those exact prerequisite results into the executable gate. That dependency is deliberate: current automated UIQI evidence includes both component/source tests and rendered browser behavior; a local Chromium run is not silently treated as the complete browser lane.

The gate becomes red when:

- contract integrity is invalid;
- a frozen condition is omitted or duplicated;
- evidence, protocol, or trigger references are stale;
- the generated report differs from the canonical source;
- a required `AUTOMATED_CURRENT` or `STRUCTURAL_INVARIANT` condition fails;
- an activated future condition lacks its prerequisite;
- either executable-evidence CI dependency fails.

`PENDING_MANUAL` remains visible but does not pretend to be `PASS`. An inactive future trigger remains `FUTURE_TRIGGERED` and does not fail the current release.

## Add or change a condition

1. Add the condition to `UIQI_CONDITIONS` with a stable ID, exact frozen requirement, category, applicability, rationale, surface, and the correct evidence/protocol/trigger reference.
2. Add the stable ID to the independent coverage oracle in `uiqiGate.test.ts`. This oracle contains IDs only; it is not a second semantic manifest.
3. Update `expectedConditionCount` when a genuinely new frozen clause is added.
4. If the meaning of an existing condition changes, bump `UIQI_CONTRACT_VERSION`, calculate and record the new `meaningFingerprint`, and update the version/fingerprint assertion. Do not silently rewrite historical meaning.
5. Regenerate the report:

   ```sh
   npx tsx scripts/check-uiqi-release-conditions.ts --write
   ```

6. Run the aggregate gate.

## Attach automated evidence

Add a repository-native entry to `UIQI_AUTOMATED_EVIDENCE`, including the exact test/source paths, local command, CI context, and narrow claim it proves. Reference that evidence ID from an `AUTOMATED_CURRENT` or `STRUCTURAL_INVARIANT` condition.

Evidence references are not proof by themselves. The stable CI context waits for the existing full Vitest and browser jobs and fails if either executable evidence layer fails.

## Activate a future trigger

Future conditions reference `UIQI_FUTURE_TRIGGERS`. A later stage declares the corresponding capability in its release evaluation. Once the activation capability is true, the condition becomes `FAIL` until its prerequisite capability is also true.

Trigger fixtures prove only the gate mechanics. They do not mean portfolio, hero imagery, grouped service menus, builder reorder, or any other future feature has been implemented.

## Record manual evidence

Manual protocols live in `UIQI_MANUAL_PROTOCOLS`; build-scoped records live in `UIQI_MANUAL_EVIDENCE`. A completed `PASS`, `FAIL`, or `NOT_APPLICABLE` record requires:

- contract version;
- exact 40-character tested build SHA;
- device/environment and protocol;
- viewport and browser/WebView;
- assistive technology where applicable;
- dated artifact reference.

Unavailable evidence stays `PENDING` with null completion metadata. A manual `PASS` without a build SHA, date, and artifact makes the foundation gate red.

Real Instagram/TikTok WebView and actual screen-reader usability must not be replaced by Chromium or semantic-DOM claims.

## Later-stage consumption

Every later stage cites contract version `1.0.0`, runs the aggregate gate, declares any newly activated capabilities, and supplies the evidence required by those activated conditions. Stage 4 may activate presentation-related obligations but must not reinterpret the contract or treat manual pending evidence as passed.

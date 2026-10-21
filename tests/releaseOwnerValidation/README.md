# Fresh invited-owner release validation

This Playwright harness is a CI release gate for the exact clean application
commit `b81137ef8bdc55e58030abe109d2d468f6c85e54`. It is controller-run only;
this directory does not start the application, provision fixtures, or clean up
remote objects.

The controller invokes `application/node_modules/@playwright/test/cli.js` from
`application` with this config. It passes `GITHUB_WORKSPACE` and
`OWNER_PHASE_CANDIDATE=$GITHUB_WORKSPACE/application`. The browser journey
checks that candidate's clean Git SHA and requires
`FRESH_OWNER_RUNTIME_ATTESTED_SHA` to match it. The controller may run only the
fixed `desktop-chromium` and `iphone-13-webkit` projects, each with one case,
one worker, and no retries. The entry file is named
`fresh-owner.acceptance.ts` so the repository's ordinary `*.spec.ts` suite
does not collect this release gate.

`FRESH_OWNER_RESULTS_PATH` and `FRESH_OWNER_OUTPUT_DIR` must be new sibling
paths named `browser-results.json` and `browser-output` under
`$RUNNER_TEMP/release-owner-validation-safe/ci-MMDDHHMM-8hex/`. The config
requires both the safe root and run directory to be physical, current-UID,
mode-0700 directories. It rejects reused paths, symlinks, and paths outside
that exclusive runner-owned subtree. The controller owns creation and final
permissions for result files.

The test performs actual invitation registration, documented Development email
verification, owner organization creation, manual salon draft creation,
publication, guest booking, owner appointment completion, own-session
revocation with admin 401, and normal product sign-in recovery. It requires the
fresh owner organization and matching owner membership; it does not select or
modify shared organizations.

Browser egress permits only the owned loopback origin, the bound Clerk
Development Frontend API, and read-only Google Fonts requests. WebSockets,
including HMR, are blocked. Screenshots, video, trace, downloads, preserved
test output, Git metadata, auth storage, raw error details, DOM, and raw URLs
are not retained. The custom reporter emits only bounded safe event fields and
cleanup references.

No browser, provider, service, database, or native Playwright run has been
performed for this portable harness. External preparation and historical
evidence remain outside this repository directory.

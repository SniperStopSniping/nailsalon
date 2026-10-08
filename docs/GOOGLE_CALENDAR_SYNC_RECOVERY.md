# Google Calendar: preserve current sync state

## Observed issue and bounded diagnosis

The authenticated Isla owner view displayed `GOOGLE_CALENDAR_CONNECTION_WRITE_FENCE_LOST` under Two-way sync and offered Connect. That error is a local connection-revision/attempt guard, not evidence that Google rejected credentials.

Isolated PGlite regression tests reproduced the error-reporting bug: after another operation updated the connection, the inbound worker's generic catch replaced its status/error with `degraded` and the fence message. The same catch could overwrite `reconnect_required` after the credential path had already classified an authorization rejection. The exact production competing operation was not established; no live credentials or calendar settings were changed for this investigation.

## Change

- An inbound scan that loses its connection write fence is counted as failed but cannot publish connection health or advance its checkpoint. The next eligible scheduled scan retains a chance to retry.
- Other failure/success checkpoint writes apply only while inbound sync is enabled, the connection remains active/degraded and its inbound checkpoint still matches the scanned checkpoint. A newer completed scan, disconnect, or confirmed authorization rejection is preserved.
- The original connection revision check, dispatch fence and fail-closed availability behavior remain authoritative. No booking conflict is bypassed.
- A degraded connection keeps the existing calendar-management interface. Confirmed rejected authorization keeps its reconnect action; disconnected connections keep Connect. Existing historical fence messages are explained in readable language near the status, without rewriting stored provider evidence.
- Reconnect-required details show one reconnect link and one error. The Google controls and integration header have comfortable touch targets, and the status/explanation stack at small widths.
- Scheduled retry guidance appears only when inbound sync is explicitly enabled; a disabled or unknown sync state does not promise an automatic retry.

## Verification and limits

Regression evidence is retained outside the checkout in the dated `google-sync-recovery` folder. Before the fix, seven new database assertions failed while twelve existing/current-failure assertions passed. After the fix, the focused Google, inbound, API, health, outbox and UI suites pass. The existing secondary-owner browser fixture exercises the actual component with synthetic API data, including degraded/reconnect states, narrow layouts, cancel-disconnect and Close.

These tests do not prove a real Google round trip or identify the specific production concurrent operation. Existing appointment ordering, tenant isolation, provider dispatch and connection protection remain covered by their separate suites. No database migration or provider configuration change is required for this patch. Production release still requires the normal CI, Preview, review and protected-main gates.

## Hosted verification correction

The first final-head CI run completed 236 of 237 Quick Book composition cases, then failed a WebKit logo test that grouped sixteen page loads under one 30-second test budget. Its trace reached the final image check at the overall deadline, without a preceding dimension mismatch. The existing logo test is now parameterized by viewport, retaining all 144 logo/browser/viewport combinations and the compact long-name check. Timeouts, retries, workers and runtime customer UI remain unchanged. Fresh full hosted checks are still required before release.

The complete local composition suite passes all 264 cases with the same two-worker setting as CI. A separate fresh serialized WebKit repeat passes 36 cases. An earlier two-worker triple stress repeat failed late and its evidence is retained; no product defect or host-resource cause was established from that run. The 198 focused Calendar checks, explicit-environment TypeScript, scoped lint and secret scan also pass. Lint retains conditional-test warnings.

The unchanged-source hosted retry passed all 264 composition cases and every
subsequent component stage through Storybook, then reached the job's 55-minute
limit during the last of 17 onboarding geometry cases. GitHub's annotation
explicitly confirms the job timeout; the original failure log and artifacts
remain retained. The 26 verification steps are now partitioned between two
independent required browser jobs, with unique artifact names and fail-fast
disabled. Commands, test cases, worker counts, retries and timeout values are
unchanged. Each job installs the shared onboarding presentation dependencies.
The existing `Run all tests (20.x)` aggregate still requires the application
job and every browser matrix member; failure, cancellation, missing or skipped
evidence cannot satisfy it. Fresh exact-head hosted checks remain required.

The partitioned hosted customer job then passed all 381 cases. The owner job
found a separate test measurement race in service-catalog return scrolling:
its trace records 1477 before click actionability, 1436 at the actual click,
and 1436 after returning from details. The application restored the exact
click-time position. The test now captures that position in a native capture
listener before React handles the click, and retains the exact-equality return
assertion. Its four viewport variants run as separate cases. No runtime code,
timeouts, retries or browser worker settings changed for this correction.

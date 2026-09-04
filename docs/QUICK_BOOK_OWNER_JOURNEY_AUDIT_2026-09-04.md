# Quick Book owner journey — September 4, 2026

Scope: improve the existing Quick Book flow, account-backed persistence, returning-owner setup, and mobile previews. The booking engine, approved onboarding sequence, billing behavior, and existing customer data are unchanged.

## Findings fixed

- A fresh-browser owner could preview a saved site but could not reopen its setup because the action depended on device-local storage. Eligible draft setup now comes from the authorized server response.
- Server-resumed setup did not restore the verified continuation claim. It now saves the same site, with authentication and ownership verification before edits or claims.
- An older local snapshot could adopt a newer server revision without adopting its content. Revision mismatches now require reopening the latest saved draft rather than overwriting another device's changes.
- An early account-save reload could jump ahead to plans. It now continues through Services and the remaining setup.
- Editing an unpublished onboarding URL could leave the saved document and public routing slug different. The same transaction now updates the canonical slug; taken, reserved, and previously published URLs remain protected.
- Claim retry recovery could report success for a different snapshot. Retries now verify the exact snapshot, current owner membership, and non-deleted salon.
- Switching salons could briefly retain the previous salon's setup card. Handoff state is cleared and late responses are ignored.
- Setup links could be offered to admin collaborators despite the destination requiring an owner. Both server entry points now use the actual salon-specific owner permission and draft eligibility.
- Screen 6's inner frame was taller than the visible reward card. It could reach its own scroll limit while its footer remained clipped. The actual scroll viewport now fits its visible host while retaining readable width-based scaling.
- Quick Book repeated its booking introduction above the shared service menu. Embedded menus now omit the second introduction; all five existing layouts retain their browsing and booking controls.
- The disabled public-hours switch did not explain the next step. It now asks the owner to apply regular hours first.
- On mobile, the save-success preview pushed the confirmation and Continue action below a large loading area. Confirmation/actions now lead, with explicit preview-loading feedback.
- WebKit reported a Blob-specific `UnknownError` when saving profile photos, bypassing the existing IndexedDB compatibility retry. That exact error now uses the existing atomic ArrayBuffer fallback; unrelated storage, quota, and permission failures remain failures. Headed WebKit verified upload, decoded preview, and reload persistence.
- Plan continuation cleared recovery state before the dashboard had opened. The verified site, selected plan, and retry key now remain recoverable until the dashboard confirms the matching owner/site/revision/plan. An interrupted navigation can no longer reset the owner to Services.

## Local check evidence

- Real Development Clerk desktop journey passed signup, verification, same-site save, media, dashboard/reload, logout, fresh-browser login, publication, and public customer booking start.
- Screen 6 geometry and signup reachability passed at 320×568, 375×667, 390×844, and 430×932. Assertions check the actual visible footer, not just the inner scroll offset. The 430 case passed on an isolated rerun after a development hydration timeout.
- Root TypeScript and shared-runtime TypeScript passed. Changed TypeScript/React source lint passed with warnings only. The two inherited prototype CSS files retain their existing 159 formatting errors, with no increase; unrelated formatting was left untouched.
- Full root units: 6,806 passed, one obsolete frame-class assertion failed. Its updated AccountGate suite passed all 16 tests. PostgreSQL-only/optional gates retain their configured skips.
- Full shared-runtime units: 1,317 passed; three timing-sensitive cases failed during concurrent compilation. Both affected suites then passed all 48 tests without changing timeouts. The Safari compatibility change separately passed 44 asset/media tests.
- A source/client secret scan against Next development output refused five oversized development chunks. Optimized-build scanning remains a CI release gate; this is not evidence of a leaked credential.
- Hosted Preview at `7f70ac2` built successfully and passed the 390×844 Business-to-Screen-6 browser journey, visible footer, signup reachability, and horizontal-overflow checks. No hosted account was created. The final handoff follow-up remains subject to the same required gates.

## Verification boundaries

Real account journeys use Clerk Development identities, isolated loopback PostgreSQL, and disposable local media. No production owner/customer data, real charges, SMS, or email sends are test fixtures.

Browser emulation does not establish physical iPhone or VoiceOver success. The plan screen continues to record the existing free/beta intent; this pass does not certify paid checkout.

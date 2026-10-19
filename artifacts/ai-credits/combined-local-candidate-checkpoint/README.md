# Combined local AI/release candidate

Application source **`f481debeaea9a1d6adf1352a061f723f4fdf5310`**, prepared locally on `codex/ai-release-integration-20261019`. Latest `origin/main` was fetched and remained8265697f. The candidate preserves the AI work from10bf877e and incorporates the source fixes at the audit's pinned e65fb516. Neither original branch nor protected main was moved. This is a local source reconciliation, not a PR merge or release.

## What is combined

The owner-facing builder, uploads, custom-source renderer, prepaid-credit accounting, draft/review/publication model and original booking integration remain intact. Added release safeguards cover native sign-in/organization recovery, session/tenant changes, browser request-origin enforcement, salon-local time handling, bounded serialized-booking retries and safe same-attempt recovery. Core source shared by both branches was checked rather than duplicated.

Twelve textual conflicts were resolved. Distinct AI publication/credit/enrollment and release Calendar/outbox CI gates were retained. The strict manifest/lock allowlist accepts the exact combined graph and still rejects changed or mixed pairs. The installed graph retains the audited Next/Sentry/PostCSS refresh and the previously reviewed AI parser/PDF dependencies. [Source and dependency proof](source-proof.json).

The separate Canva branch was compared as well. Its manual action editor, image manager and hotspot editor are already reused; the candidate additionally has size/background controls, export guidance and the AI/manual entry choices. Reapplying that older branch blindly would create conflicts and risk replacing newer work. This source comparison is not a fresh manual-Canva browser acceptance claim.

## Automated checks

- **1,286 passed assertions in45 distinct focused/configuration/upload files**:1110 +176. The two type-corrected fixture suites were then rerun successfully (67 assertions, not double-counted). Full `next typegen` and root `tsc --noEmit` passed.
- **96 actual isolated PostgreSQL cases**:62 original booking cases,13 setup-publication races,8 prepaid-credit races,2 owner-enrollment races,3 Calendar cases,7 outbox parent cases and1 required independent-process outbox case. The parent report intentionally marks its duplicate child-only declaration pending; the separate required process executed that case and emitted the asserted marker. Required behavior was not silently skipped.
- **32 Node contract tests** passed with zero skips:21 CI guard tests,10 installed dependency/loopback SMS transport tests, and1 Node24 timezone contract. No real SMS was sent.
- Scoped ESLint over60 changed files found0 errors and52 browser-test warnings; the two final fixture changes passed an additional scoped lint. Warnings are retained, not represented as a warning-free result.
- The exact optimized build passed compilation/type validation and scanning of4884 tracked /600 generated files, with0 server-canary matches. The real Development public auth identity was compiled; provider server secrets were replaced with synthetic values during build. Only an owned previous build's recomputable webpack cache was removed for disk space; source, optimized server/static, certificates and prior evidence were preserved. [Build proof](optimized-build-proof.json).

[Test details](test-proof.json) · [Failed attempts and corrections](attempt-notes.json). The initial duplicate helper, test-fixture typing errors and evidence-hash scanner false positive are disclosed there; only final successful checks are called passing. No scanner rule, size limit, authorization gate or approval boundary was weakened.

## Native application and security

A fresh iPhone13-emulated WebKit context completed real password sign-in, More → Luster AI, the same saved business and refresh. No provider response/cookie was fabricated. Six documents and the recorded critical client/API/renderer responses were checked against four actual private credential values; zero leaks/unreadable responses. Actual Clerk Development calls occurred; zero model calls is not a claim of no authentication calls. [Returning-owner proof](returning-owner-proof.json).

Desktop/mobile private custom previews and the production-component preview were inspected on this build. Published revision9, service IDs, source hashes, wallet and business settings remained unchanged; private service clicks stayed disabled. [Owner preview proof](owner-preview-proof.json). A stored-session raw API snapshot initially returned401; the real browser SDK refreshed the session, after which own setup/custom-site reads returned200, other-salon reads403, and missing/null/foreign-Origin mutations403. Invalid probe actions ensured no domain mutation even if an origin check failed. Both salon heads remained unchanged. [Runtime boundary proof](native-boundary-proof.json).

[Desktop builder](builder-desktop.png) · [Private desktop](private-desktop.png) · [Private mobile](private-mobile.png) · [Private booking disabled](private-booking-disabled.png).

## Completed original customer booking

The anonymous WebKit customer opened the existing genuinely model-generated public Cobalt website, chose its real bound BIAB service, eligible artist, original calendar/time, original customer form and policy agreement, then pressed the original confirmation button. The server returned **201**, the real Luster receipt appeared, and exactly **one new synthetic appointment** was created for October20 at11:30, **CAD70 /75min**. Every earlier appointment row stayed identical. Texts were unchecked and the runtime disabled messaging/payment integrations.

The trace contains **two appointment POSTs**: one successful customer booking and one deliberate negative probe. The latter replaced the service with its draft-only virtual ID and received **400 INVALID_SELECTION**, creating no appointment. Five anonymous website/booking/availability responses were read before creation; none exposed the private address. The wallet retained CAD9.775907, one sandbox purchase entry, zero recovery grants and seven historical model calls. No new model call or purchase occurred. [Completed booking proof](completed-booking-proof.json) · [Actual receipt](original-booking-completed.png).

The earlier [availability screenshot](original-calendar-before-booking.png) was captured before this submission. Cobalt now has **two synthetic appointments**: the original10:00 and this new11:30. Read-only proof with count1 is historical evidence at its stated stage, not current state. Do not rerun the guarded customer script without inspecting current appointments; it refuses another submission once the new row exists.

## Limits and remaining release gates

This phase reused saved model-generated frontend source. It did not regenerate a new visual reference, manually author/repair a salon design, repeat a credit purchase, or repeat native approval/publication. Current publication concurrency was verified on real disposable PostgreSQL; the earlier native exact-review/publication cycle remains separately attributed to the [publication-aware checkpoint](../published-preview-checkpoint/README.md), and genuine paid generation/intake/revisions to the [fresh funded-owner checkpoint](../fresh-stripe-owner-checkpoint/README.md). These are complementary evidence, not a claim that every historical step ran afresh on f481debe.

All successful customer interactions used the original Luster system. No mock booking endpoint or alternate form was used. Tests used local isolated HTTPS origins, a separate renderer, synthetic accounts, the attested local Development database and a distinct disposable CI database. Model/payment provider hosts were blocked in the application runtime; new purchases, communications, subscriptions/top-ups were disabled. Emulation is not a physical-device test. Owned runtime children were stopped afterward.

No hosted secret/configuration write, hosted migration, push, PR update, protected-main merge, deployment, promotion, Production billing or live salon change occurred. Branch-specific Preview configuration still requires the owner's separate approval. Hosted schema/renderer/auth/upload/payment isolation, required combined CI/browser/review gates and the protected-main release path remain outstanding. Development organization capacity is50/50; no account was deleted or upgrade purchased. This checkpoint does not declare the whole builder or Production release complete.

The [manifest](manifest.json) records path/sha256 entries without embedding credentials. Raw logs/responses, session state, secrets and private uploaded source files remain outside Git.

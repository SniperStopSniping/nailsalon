# Saved-photo choices and real chat edit

This checkpoint covers preserved Canva artwork with editable About/Gallery content. It does not claim new free-form website generation, reference fidelity, or another completed customer booking.

## Owner-visible correction

The saved-photo picker previously offered two archived full-page Canva exports as salon photos. Commit `ccc4a419c5d410a9d5b57003fc1925e2a5dfa17b` excludes assets recorded as Canva pages in this salon's saved source history. Actual photos remain available, regardless of their filenames. An image already explicitly placed in native content remains usable. Files and prior designs are retained.

The same tenant-scoped eligibility query validates both manual requests and AI actions. It filters before the 24-photo limit. A file merely named “Canva” is not classified as artwork. This historical check cannot classify an orphaned derived export that was never recorded in any saved Canva source.

## Hosted owner workflow

1. The normal signed-in owner opened the isolated builder at revision 114. The picker showed three actual available photos; the two archived artwork exports were absent. The existing portrait and wide photos still rendered.
2. Through the visible chat, the owner sent: “Make the first Gallery photo larger. Keep the About section, photos, artwork and booking settings unchanged.” The composer cleared immediately and the interface showed “Working on your changes…”.
3. One real OpenAI `gpt-6-luna` request saved revision 115, artifact `82eacd82-f9f3-4bad-a4f0-998ad3b7bf13`. No developer source correction or AI repair was used. The summary was “Changed your Gallery layout. Saved in your draft.”
4. The manual Gallery selector showed “Large first photo”. A database comparison verified that only the Gallery layout and review status changed. About text, photo identities, artwork, business data, services, staff, hours, and policies were unchanged.
5. At a 390 × 844 owner viewport, both Gallery photos decoded. In the 351-pixel preview, each image displayed at 319 pixels wide: the 1200 × 480 photo at 127.59375 pixels tall, and the 480 × 960 portrait at 638 pixels tall. Document scroll width equalled viewport width. These are explicitly labelled synthetic geometry fixtures, not professional photography or a design-quality evaluation.
6. Refresh retained revision 115 and the manual selector's `editorial` value. The owner then used saved history to restore the original source `4c5a3b96-8d6e-4ca3-972c-7129512a3d1d` into draft revision 116. The new Gallery revision remains in history.

The public website remained on publication 98 throughout. All 12 existing synthetic appointments were preserved; this trial created no appointment and published no site. Earlier booking evidence was rechecked without changing its historical prices, durations, staff, or buffer. SMS remained disabled; no email/SMS provider accepted a delivery.

## Usage and checks

The real request used 7,673 input tokens and 103 output tokens, with 2,922 ms provider latency. Recorded estimates: USD 0.001011 API usage; CAD 0.002022 trial debit; CAD 0.002831 owner-credit debit. These are application estimates from provider usage receipts, not a provider invoice. Tracked total trial usage became CAD 36.037946 against the unchanged, stricter CAD 68.615594 operator cap. The broader user authorization was CAD 80; no cap was increased.

Local checks: 64 domain tests, 45 owner UI tests, scoped TypeScript, changed-file ESLint, whitespace/commit checks, and a 5,321-file secret scan passed. A read-only query against the pinned isolated Preview PostgreSQL server verified the eligibility SQL and tenant scope; its observed execution time was 3.564 ms. This query is separate from the owner-screen proof.

The owner UI test was corrected to wait for saved setup data before clicking Details. It explicitly verifies Details is disabled while loading; it does not bypass a disabled control or increase a timeout.

## Deployment and remaining gates

Only the isolated test alias was updated: `https://luster-ai-builder-test.vercel.app`, deployment `dpl_G4fkhtE7j22ZznNVqDmhoTmW3UzS`, source `ccc4a419c5d410a9d5b57003fc1925e2a5dfa17b`. Both unique-deployment and alias health returned this source SHA. Database, Redis and Clerk checks passed. Overall health is deliberately degraded by absent test integrations, so this is not production readiness.

CI run `39336241235` was still in progress when this evidence was captured. Shards 1 and 2 passed, including the corrected owner-loading test. Shard 3 failed the staff early no-show report test at `page.test.tsx:179`; that test is identical to the passing combined release candidate and needs separate diagnosis.

A narrowly scoped CI correction sets `NEXT_PRIVATE_LOCAL_WEBPACK=1` only for the existing Storybook step. Its plugins and Next then use the same installed compiler instance. All 22 CI workflow contracts passed. A full local Storybook build passed in 21 seconds after the harness supplied all approved synthetic provider placeholders, the required sign-in path, and the explicit current worktree root. The first two harness attempts correctly rejected incomplete synthetic environment setup; neither reached compilation. The local dependency symlink uses the separately qualified Webpack 5.111.1 graph, while this branch's unchanged lockfile resolves 5.112.0. Local success does not replace CI verification of the branch's own installed graph. No dependency manifest or lockfile changed.

The staff test now holds the detail response until it has asserted the loading state, then finishes that transition inside `act` before opening Details. All three cases and changed-file lint/scoped types passed locally. It returns fresh response bodies for the post-mutation refetch. No application booking/no-show behavior or timeout was changed. The first deferred-fixture attempt reused a consumed response body and failed the acknowledgement assertion; that test-harness error was corrected and is not presented as a passing trial.

The latest controlled Chrome owner preview loaded without a reload and rendered its mobile arrangement. This is a useful successful observation, not an explanation or guaranteed correction of the earlier intermittent first-load frame stall. Physical-device qualification remains open. No Production changes, migrations, purchases, package installations, environment configuration changes, provider-credential decryption/rotation, or permission changes occurred in this checkpoint. Read-only database checks reused the existing private, pinned Preview connection.

The installed Vercel CLI is 64.5.0. Upgrade to 64.7.0 is recommended for current compatibility, but no CLI compatibility failure occurred in these operations; no global upgrade was performed or made a prerequisite.

See `proof.json` for the selected receipt and revision identifiers. Screenshots are unedited captures of the owner interface; private database snapshots, raw source, credentials and authenticated browser state are excluded.

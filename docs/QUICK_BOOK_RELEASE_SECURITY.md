# Quick Book release security review

## Clerk patch (2026-09-03)

The initial Clerk-only security checkpoint updated `@clerk/nextjs` within its
declared `^6.18.3` range, leaving `package.json` unchanged at that checkpoint. The lockfile resolves
`@clerk/nextjs` 6.39.6, `@clerk/clerk-react` 5.61.9, Clerk Backend 2.33.6,
and the framework's Clerk Shared 3.47.8. Associated Clerk transitive packages
are resolved by npm; no blanket `npm audit fix` was performed. The later
framework-major patch is separately described below.

The development-only `@clerk/testing` helper also moves from 1.3.11 to 1.14.9
within its existing `^1.3.11` range. This provides Clerk's supported testing-token
handling for current CAPTCHA responses during the isolated acceptance journey;
it does not change application CAPTCHA or production authentication behavior.
The [official helper source](https://github.com/clerk/javascript/blob/main/packages/testing/src/playwright/setupClerkTestingToken.ts)
documents this behavior. npm deduplicates the already patched Clerk Backend and
Shared versions into their common dependency locations. The final reviewed
lockfile blob is `94fa39b23421c3eafeeddff7aac5fe50d6e71fa8`.

Primary advisories:

- [GHSA-vqx2-fgx2-5wq9](https://github.com/clerk/javascript/security/advisories/GHSA-vqx2-fgx2-5wq9): middleware route matching can be bypassed. The v6 patch starts at 6.39.2.
- [GHSA-w24r-5266-9c3c](https://github.com/clerk/javascript/security/advisories/GHSA-w24r-5266-9c3c): combined authorization predicates and certain `auth.protect()` argument combinations can bypass authorization. The v6 patch starts at 6.39.3.

The advisories describe these as drop-in fixes. Existing route/server identity
and tenant checks remain defense in depth; they are not substituted for the
SDK patch. Authentication and booking behavior must be reverified on the
patched dependency before release acceptance.

The CI dependency guard permits only exact reviewed manifest/lockfile pairs.
The original Clerk-only pair remains explicitly listed; the separately reviewed
framework patch below adds one new exact pair. Historical billing, migration,
purge and journal protections remain in place.

## Remaining dependency findings

At the Clerk-only checkpoint, `npm audit --omit=dev --json` reported 52 findings:
1 critical, 19 high, 30 moderate and 2 low. An audit dependency classification
does not establish runtime reachability: production dependencies can also
contain development-only tooling. This is not a clean vulnerability audit.

After the Next/React compatibility upgrade, the same audit reports **50**
findings: 1 critical, 16 high, 31 moderate and 2 low. There are no remaining
direct Next.js, React or Clerk advisories in that output. Next.js still appears
through its bundled PostCSS dependency: the current
[PostCSS source-map advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp)
requires processing attacker-controlled CSS. No application PostCSS import or
customer-provided CSS compilation path was found; CSS compilation occurs from
repository-controlled build inputs. This reachability assessment is not a
claim that the dependency tree is vulnerability-free.

### Next.js 15.5.25: framework security patch implemented

The application uses App Router. Although application source does not declare
its own Server Actions, Clerk's client provider imports `invalidateCacheAction`
from its `app-router/server-actions.js`; the acceptance build's server-reference
manifest contains seven Node Server Actions. The maintained advisory
[GHSA-m99w-x7hq-7vfj](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj)
therefore applies: crafted requests can exhaust CPU when at least one Server
Action exists. It states no workaround other than upgrading. The
[July security release](https://nextjs.org/blog/july-2026-security-release)
patches this in 15.5.21 or 16.2.11, outside the former `^14.2.25` range.
A 14.x-only update cannot resolve that advisory set.

Do not assume hosting removes this risk. Vercel's
[May security release](https://vercel.com/changelog/next-js-may-2026-security-release)
explicitly states that those advisories cannot be reliably blocked by WAF.
The resumed release now uses Next.js **15.5.25** and React/React DOM **19.2.8**.
The App Router migration follows the official
[Next.js 15 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-15)
and `@next/codemod@15.5.25 next-async-request-api`. Request parameters and cookies
are awaited at their existing boundaries; the shared booking implementation,
tenant checks, visibility rules and authentication decisions remain unchanged.
The codemod's re-export warnings and client-layout edge cases were reviewed
manually, not suppressed. No production exploit was attempted.

Supporting compatibility updates are limited to React types, next-intl 3.26.5,
next-themes 0.4.6, Radix icons 1.3.2/dropdown 2.1.6, Next build/lint helpers,
Storybook 8.6, Testing Library React 16.3 and Playwright 1.55.1. The imported
onboarding prototype uses the same React/type versions. Business data and
approved visual compositions are not changed by this framework migration.

The reviewed root manifest blob is
`2566f6f2a1cb093ce512627a1568265c57aa8895`; its paired lockfile blob is
`8d44f4449583e8d5d8bcc3cf6e844d9f47610578`. npm resolved the upgrade in two strict
steps (compatible supporting packages first, then React 19) to avoid a stale
React 18 peer-tree conflict. No `--force`/`--legacy-peer-deps` dependency install
or blanket audit fix was used. A clean `npm ci` completed, and the final
`npm ls react react-dom @types/react next --all` exits successfully without
incompatible peers. Runtime/build acceptance is still a separate required gate.
The type-check command now runs Next.js 15.5's `next typegen` before TypeScript,
so a clean checkout also validates generated route signatures without requiring
an earlier development server or build. The build's file-tracing root is pinned
to this worktree, preventing unrelated ancestor lockfiles from altering it.

Other high-severity findings are conditional: the
[WebSocket SSRF](https://github.com/vercel/next.js/security/advisories/GHSA-c4j6-fc7j-m34r)
does not affect Vercel hosting, and the
[Pages Router i18n bypass](https://github.com/vercel/next.js/security/advisories/GHSA-36qx-fr4f-26g5)
does not match this App Router application. These narrower exclusions do not
waive the requirement to patch the Server Action issue above.

### sharp 0.33.5: untrusted-input decoder mitigation applied

The new production onboarding media path decodes input metadata before checking
the detected image format. A caller-controlled MIME type alone cannot prevent
GIF/TIFF/VIPS bytes reaching the decoder. The maintained
[libvips advisory](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj)
provides a narrow workaround: block `VipsForeignLoadNsgif`,
`VipsForeignLoadTiff` and `VipsForeignLoadVips` before any decode. This is compatible
with the product's JPG/PNG/WebP contract; its regression tests must include
forged allowed MIME types. The release now centralizes this workaround in
`src/libs/safeSharp.server.ts`, consumed by both application Sharp import sites.
The focused verification passes 233 onboarding integration tests, 35 existing
service-image tests and the one exact-operation helper test. Forged GIF/TIFF
content is rejected before metadata/provider handling. The package version
remains affected until a future reviewed upgrade, so the workaround must not
be represented as a clean audit.

### shell-quote 1.8.1: tooling-only reachability found

`npm explain shell-quote --omit=dev` traces the production-labelled path through
`@spotlightjs/spotlight` to its sidecar and `launch-editor`. The application has
no Spotlight runtime imports; it is invoked only by the `dev:spotlight` script.
`launch-editor` calls `parse()` on the configured editor, not customer input.
The other consumer, `npm-run-all`, is development tooling. No customer-facing
shell-quote invocation was found.

The [object-token injection advisory](https://github.com/ljharb/shell-quote/security/advisories/GHSA-w7jw-789q-3m8p)
requires attacker-controlled object operators passed to `quote()` and then a
shell. The [parse complexity advisory](https://github.com/ljharb/shell-quote/security/advisories/GHSA-395f-4hp3-45gv)
requires attacker-controlled strings reaching `parse()`. Neither path was found
in the deployed application. Keep Spotlight off public/production servers;
update the tooling dependency in a reviewed maintenance change.

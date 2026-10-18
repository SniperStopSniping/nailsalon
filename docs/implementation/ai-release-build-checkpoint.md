# Paid AI builder: local release-build checkpoint

This checkpoint follows `ae1fd1b0` and tests clean commit `f60b83f8`. It is
local verification and read-only hosted inspection. No push, deployment,
production migration, production-data change, provider purchase or new billable
model call occurred.

## CI gaps corrected

The existing guarded migration packet now includes the exact, additive
`0110_setup_add_on_publication.sql` postimage and journal tag. No older migration
pin was changed, and the immutable/append-only protections remain enforced.
The native contract actually tries changed SQL and already-shipped rewrites;
all 13 AI packet files are covered.

The required disposable-PostgreSQL publication lane now requires all **12**
current cases, with no skips, rather than the obsolete count of nine. The
workflow contracts passed **18/18**. The actual PostgreSQL suite produced
**12/12**, with zero pending/skipped tests, and its JSON report passed the
same required-count assertions.

## Complete optimized build and credential boundary

The full `next build` completed successfully under **Node 22.23.2**, including
type checking, page generation, optimization and build traces. It compiled a
clean Git archive of the exact commit into a private temporary directory;
the running development app and its `.next` output were preserved. Existing
installed dependencies were reused, with no installation or global upgrade.

Build configuration used the approved CI auth/payment placeholders and the
attested disposable loopback database. No real provider credentials were
loaded. Network access was restricted to loopback and public font hosts;
provider APIs were blocked. A random server-only synthetic credential canary
was supplied to detect accidental browser serialization.

The repository secret scanner passed over **4,498 tracked files** and
**596 optimized generated files**. An additional check covered **622 public
static/HTML/RSC files**, totaling 8,475,715 bytes, with **zero** matches for
the server-only canary. This is actual optimized-output evidence, not the
earlier oversized Development-chunk scan.

[Machine-readable evidence](../../artifacts/ai-credits/release/local-build-proof.json)
records the source SHA, counts and boundaries. Full logs and build output
remain under `/tmp/luster-ai-release-build-f60b83f8-UABHND` with restricted
permissions. This does not prove hosted Node 24 behavior or the full optimized
custom-site/customer journey; those remain separate acceptance checks.

## Hosted state observed without mutation

- The linked Vercel project is `isla-nail-studio`, production branch `main`,
  Node 24. Automatic Preview deployments are currently disabled. No setting
  was changed. The installed Vercel CLI is 64.5.0; no upgrade was required.
- The AI branch explicitly uses `APP_ENV=preview`, `BILLING_PLAN_ENV=test`,
  and an allowlist containing only the previously attested dedicated Preview
  database host. Secret-valued metadata is not evidence that a value is
  missing, and no production credentials were copied.
- The builder and renderer are separate HTTPS origins. The renderer answered
  HTTP 200 with `connect-src 'none'`, the expected parent-only frame ancestry,
  sandbox restrictions and a hash-bound bootstrap.
- The deployed renderer's bootstrap SHA-256 is
  `31a29acb18a00a6f1a9bfea3661c58ec7a7e9a816adceba25c6e5bd0dd10198f`.
  Current source, assembled for the same parent origin, is
  `39b6397481810388e79cdd34d604db72f804b1bfbe7e24f25824e2971cb88028`.
  The hosted runtime is older and must be updated separately before current
  custom interaction acceptance. A READY old deployment is not proof of the
  new runtime.
- Existing builder health returns 503 with ready database/schema checks.
  Its production integration checks remain unsatisfied because outbound email,
  SMS and Google integrations are deliberately absent. Production health was
  not weakened to make this test environment appear ready.
- Remaining hosted resource isolation is still not fully attested. The push,
  PR update and hosted deployment hold remains in place. No automatic Preview
  or protected-main behavior was bypassed.

## Account configuration and remaining acceptance

The current local Clerk frontend is a deliberate `.invalid` placeholder.
A non-mutating instance read using only the configured **test-prefixed** secret
returned HTTP 401. Real signup and cross-device authentication are therefore
unverified; a simulated/legacy owner session does not satisfy this gate.

When configuring real account tests, use a matching **Development** Clerk pair
in the isolated worktree's private `.env.development.local`:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_…`)
- `CLERK_SECRET_KEY` (`sk_test_…`)

Do not use Production keys or paste either key into chat. The already-installed
`@clerk/testing` package supports the official
[Playwright testing setup](https://clerk.com/docs/guides/development/testing/playwright/overview).
The runner must map the publishable key to its test-only
`CLERK_PUBLISHABLE_KEY` input, obtain a Testing Token, and initialize
`setupClerkTestingToken()` before navigating. Follow the actual configured
signup form and use Clerk's reserved
[test emails/phones](https://clerk.com/docs/guides/development/testing/test-emails-and-phones)
to avoid real verification messages. Keep resulting sessions and test tokens
private, and require a fresh browser context for cross-device verification.

The Stripe sandbox key remains deferred at the owner's request. Real credit
purchase, signed webhook/replay acceptance, account testing, remaining
Canva/photo/PDF/style trials, the introductory workflow recording, optimized
HTTPS customer behavior, hosted isolation, remote CI/review and gated
production release still need completion. The full paid builder is not
declared finished.

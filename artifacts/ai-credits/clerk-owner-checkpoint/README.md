# Genuine Development owner entry — October 18, 2026

This checkpoint uses the real Clerk Development instance and the actual `/ai-website` signup UI. No Clerk API user seed, sign-in ticket, legacy admin cookie, response stub, provider configuration change or production key was used. The reserved test email used Clerk's email-code flow; no real customer email was sent. Cookie state and passwords remain in private files outside Git.

## Finding and correction

The Development instance allowed a complete signup with an unverified email. Luster's existing server identity guard correctly rejected business entry with 403, but the page gave the owner no verification action. The AI entry now asks for a six-digit code, waits for Clerk's verified resource, and automatically opens the existing business or creates exactly one private draft. Returning verified owners skip the marketing walkthrough. Multiple owned businesses still require a choice; failed entry offers an explicit retry.

## Actual checks

- Real UI signup and required organization selection completed.
- The new email-code UI verified the same account and the canonical entry returned 200.
- Exactly one owner membership and one private salon were created by normal application code; no service or appointment was seeded.
- Reload and return through `/ai-website` reopened that same salon.
- Anonymous access returned 404; online booking remained disabled.
- Browser errors: zero. No AI call, Stripe charge, production migration or deployment occurred during these checks.
- 18 component/page/identity tests passed; scoped ESLint and repository TypeScript check passed.

The first verification run reached successful entry but its diagnostic read ran before Clerk finished loading in the new page. That harness assertion failed; the later run waited for both saved draft data and the real Clerk resource and passed. A screenshot retry also corrected the test's close-button locator. Neither retry made a paid model request or changed the generated website.

## Viewable evidence

- [Desktop email check](verification-desktop.png) and [mobile email check](verification-mobile.png).
- [Private builder on mobile](private-builder-mobile.png).
- [Returning desktop owner with zero-credit notice](private-builder-desktop.png).
- [Sanitized request and database checks](proof.json).
- [Unfunded request blocked before any model call](unfunded-request-blocked.png), with [zero-call evidence](unfunded-proof.json). The real signed-up account had no recovery grant for this check. The current application correctly explains that purchases are unavailable while Stripe sandbox configuration is deferred.

The existing opt-in AI trial runner now accepts the UI-issued Clerk state with Development-only keys, matching owner membership attestation, private session-file permissions and an exact Development Frontend API network allowance. Anonymous booking contexts never inherit that state. Twelve deterministic harness/isolation checks pass; the legacy seeded-session mode stays explicitly labelled and is not counted as real Clerk acceptance.

Stripe sandbox purchase acceptance, genuine-account AI generation/publication/booking and hosted isolation are separate remaining gates. The private local key configuration is verified, but is not a production credential or hosted-preview configuration. This checkpoint does not claim the complete paid builder is released.

> Superseded by [the full-reset correction](../full-reset/README.md). This document records the earlier design-only action, not the current Start over behavior.

# Start over in owner chat

Runtime commits: `69799755eff0d6f3e54a23a2eca72a0f28734b0f` and `2dc66fe5` (dialog spacing). Scope: isolated AI-builder preview; no production merge, deployment, migration or live salon changes.

The main chat now exposes **Start over** below the composer. A short dialog asks for a new look and optionally reuses selected references. Opening/cancelling makes no draft writes or AI calls. Creating a design preserves business information, service identities/prices/durations, hours, booking settings, photos/logo, current source until success, and earlier source revisions. References are excluded by default for a fresh direction. Publication still requires separate exact-revision review/approval.

The action uses existing authenticated preferences and generation APIs with `startOver: true`. Generation receives no previous source. The result is saved in the shared website/setup draft and displayed in Preview. After a lost generation response, **Check saved result** resumes the same operation instead of creating another paid generation. Server-side revision, tenant, output, budget and publication checks remain in force.

## Deterministic checks

- 90 focused tests passed: StartOverDesign (7), SetupEditor references/integration (17), disposable PGlite domain integration (66).
- New coverage: confirmation/cancel with zero requests; selected-reference choices and retained photos; actual prepared revision; progress/disabled controls; lost-response recovery without a second generation; missing essential information; main-chat integration; no prior source in the provider request; unchanged business/services/hours/booking; replay without another provider call; restore of the earlier design; no live custom frontend change.
- TypeScript, scoped ESLint and `git diff --check` passed.
- Provider responses in these automated tests are mocked. This checkpoint does not claim a new real-provider generation trial.

## Hosted verification

Final deployment `dpl_3zWpFmqtZ8PJPesBT6WbcoZ9H4KW` is READY, Preview, build 3m24s, runtime SHA `2dc66fe5`. The shared test alias is https://luster-ai-builder-test.vercel.app/ai-website-test. Only committed source was deployed.

Two authenticated owner-application checks passed on the final deployment: mobile Chromium (390 x 844) and desktop Chromium (1440 x 1000). They use a synthetic salon and a development-Clerk session, with no messages, payments, appointments, publication or generation requests. Verified: visible 44px Start over target, no horizontal overflow, fitting dialog, clear focus-outline spacing, empty-brief submission disabled, valid-brief submission enabled, cancel/close, fresh reopening, refresh, and exact saved draft/revision preservation. Desktop also checks native modal keyboard navigation without focusing background controls, and Escape cancellation. Captured screenshots below are synthetic-account content.

The first visual inspection caught help text too close to the textarea focus outline; `2dc66fe5` fixes the spacing. A temporary unique deployment URL rejected owner access because authorized origins are restricted to the shared test alias; that restriction was retained. Separate mobile WebKit automation encountered sign-in redirects/404s or lost authorization on setup reads, including an attempt using saved test authentication state. It is **not** counted as a passed Safari owner journey, and no application authentication rules were loosened. Browser assertions were corrected to allow native-dialog keyboard focus to leave the document for browser UI while still excluding background application controls.

Opening/cancelling made zero draft-write actions and zero paid AI calls. No owner draft was reset. The provider is not called by these hosted checks; actual generation and lost-response paths are covered here by deterministic mocked-provider tests, not a new real-provider trial.

- [Mobile chat](mobile-chromium-chat.png)
- [Mobile dialog](mobile-chromium-dialog.png)
- [Desktop chat](desktop-chat.png)
- [Desktop dialog](desktop-dialog.png)
- [Machine-readable browser results](browser-verification.json)

Combined conservative application AI accounting remains CAD 39.211042 / 50, unchanged by this checkpoint. This is not a reconciled provider invoice.

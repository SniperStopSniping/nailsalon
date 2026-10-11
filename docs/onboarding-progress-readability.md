# Readable onboarding progress

The five setup stages keep their existing order, completion rules and current-step semantics. This change only adjusts their presentation.

- Labels use the existing muted owner colour and 13px title-case text, replacing 8.48px uppercase text on a small phone.
- The remaining-required-steps message uses 12px text. Below 700px it sits beneath the stage row, leaving every label enough horizontal space.
- Compact-height and landscape rules retain the readable text size. Existing marker, focus, saved-draft and navigation behaviour is unchanged.

## Regression coverage

`tests/browser/onboardingDirectOffer/progress-readability.spec.ts` renders the real integration in an isolated local fixture. It checks both standalone and shared product fonts at 320, 390, 430, 667 and 1280px, including 320x360 and short landscape.

Assertions cover text size, actual text bounds, five-stage order, completed/current/upcoming states, contrast, horizontal overflow, saved-step reload and Back. Additional empty-business-form cases ensure the focused invalid field remains between the sticky header and actions. No real owner, provider or account writes are involved.

The new small-phone assertion fails on the preceding production source (received 8.48px; expected at least 13px).

Run the direct-offer browser configuration, the lab's `onboarding-desktop-layout.spec.ts`, and the existing shell/app/progress unit tests. Also run the production build, TypeScript, scoped lint and normal secret scan before release. Preview and production acceptance remain separate from these local checks.

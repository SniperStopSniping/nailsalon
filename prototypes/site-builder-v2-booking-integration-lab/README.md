# Luster Onboarding V1 UX Lab

This package is a local-only, browser-persisted product Lab for the mobile-first
Luster onboarding sequence. It collects one structured Business Profile,
creates one of the approved universal Builder starters, composes personalized
customer previews, conditionally offers About, Policies, Gallery, and Canva
setup, and hands off to the existing Builder only after final review and an
explicit plan-intent choice. It is not imported by the Luster Next.js
application and has no Production route, API, authentication, database,
payment, publishing, or deployment integration.

```sh
cd prototypes/site-builder-v2-booking-integration-lab
npm ci
npm run dev
```

Open <http://127.0.0.1:4188>.

Package-local verification:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run capture:evidence
```

Onboarding evidence and the final HTML report belong under
`/tmp/luster-onboarding-v1-ux-lab/`; evidence is never committed.

The Vite server binds to loopback only and uses a deliberately nonexistent
package-local environment directory, so it does not discover the repository's
environment files. The onboarding model persists under the single
`luster:onboarding-v1-lab` key. The universal starter document keeps its
existing Builder storage boundary, and Canva pages use the existing Custom
Design browser asset repository. Gallery, About, Policies, and style recipes
remain onboarding-preview models rather than unfinished universal section
types.

The onboarding **More** menu includes deterministic states for Daniela / Isla
Nail Studio, conditional sections, completeness, offers, reduced motion, long
copy, small phones, and starters. It also exports a local, value-sanitized JSON
event journal for human usability sessions. Restart intentionally clears that
journal with the rest of the onboarding-only state, so observers should export
the pre-reset journal first when the reset itself matters to their session notes.

The inherited Site Builder and Booking implementation remains unchanged in
architecture. The package still runs its foundation, Booking, and Custom Design
regression suites alongside the focused onboarding tests.

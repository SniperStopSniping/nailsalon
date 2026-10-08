# Owner visual polish — October 7, 2026

## Reference and scope

The owner approved the live sign-in and salon selector and requested the same quality across the dashboard and onboarding. This first delivery covers shared owner styling, Today (S01), More (S02), the five-tab navigation and shared dialog headers. Calendar, Clients, Services, their detailed forms and onboarding still need their own visual refinement pass. This is not a claim that the entire app is finished.

Based on protected main `a7d35234` (PR #373). Work uses the isolated `codex/owner-visual-polish` branch; the original Desktop checkout is unchanged.

## What changed

- Owner surfaces now match the approved entry palette: blush/ivory, plum, cream cards, restrained borders and soft shadows. Customer booking tokens remain isolated.
- Newsreader headings and consistent owner card/button styles replace mixed Today treatments.
- The current appointment and revenue panels are light; financial values, provenance, details and warning states retain their original behavior.
- Agenda rows give client/service details room to wrap instead of compressing them between the time and a separate status column.
- New Appointment is the primary quick action; Walk-in and Message Client remain directly accessible with the same callbacks and accessible names. Removed glossy multi-colour icon styling.
- More retains the same groups, destinations, entitlement filtering, counts and log-out confirmation, with quiet plum line icons and matching surfaces.
- Shared modal headers can show long service names on a separate row on small phones. Back and Save remain reachable; focus, Escape, dragging and scroll behavior are preserved.
- Shared owner header extracted into an actual reusable component, used by the dashboard and the isolated browser fixture.

## Verification boundary

`tests/browser/ownerPolish` renders the actual Today, More, navigation and AppModal components with synthetic data. It performs no real bookings, messages, payments, auth or provider actions. Its Calendar/Clients/Services tabs are deliberately not substitutes for those real screens; their visual acceptance remains subsequent work. Existing owner-navigation, client-profile, appointment, settings and entry suites exercise those actual components separately where their existing coverage applies.

Checks include 320/390/430/1366px overflow, touch-target sizes, single-line quick-action labels, light financial panels, preserved breakdowns, keyboard tab navigation, modal dismissal/focus restoration, empty/error states and long service titles. The new suite is included in hosted CI.

Source token tests also assert that the shared owner palette matches the approved entry palette and that every customer token remains isolated.

## Remaining delivery

- Finish exact-head hosted CI and preview review, resolve any review findings, merge only through protected main, and verify production SHA and rendered owner UI.
- Then refine Calendar, Clients, Services and remaining owner forms, using real components and meaningful states.
- Then refine onboarding chrome, starting-point choice, setup forms, preview controls and account handoff. Preserve selected customer designs, autosave/recovery, auth and lifetime/usage rules.
- Fresh signup/lifetime acceptance and controlled provider outcomes remain recorded separately. AI voice stays deferred.

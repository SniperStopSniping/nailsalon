# Owner navigation and review-request implementation

Approved project, begun after Customer AI PR #253 merged at
`0f8bc56b020a74811e025b9aa0200ff9cc6d29a5`. This document tracks the implementation;
it does not authorize production configuration changes or customer messages.

## Product contract

- Bottom navigation: Today, Calendar, Clients, Services, More.
- More, in display order:
  - Booking: Hours & Availability; Booking Rules & Policies; Booking Page.
  - Clients & Growth: Marketing & Messages; Portfolio.
  - Business: Payments; Analytics; Team; Integrations.
  - Luster: Plan & Usage; Settings; Help & Resources.
- One canonical editor per control, with compatible legacy links and contextual
  shortcuts. Preserve entitlement checks, query context, browser history and
  unsaved form protection.
- Settings ultimately contains account, owner/staff notifications, workflow photo
  requirements, workspace modules and legal/about configuration. Keep existing
  categories accessible until their controls have a complete destination.
- Distinguish regular business hours, technician schedules, actual bookability,
  date-based time off, timed blocks, booking rules and customer-facing policies.
  A solo technician must be able to manage their schedule without team concepts.
- Keep live information saves separate from booking-page draft/publish actions.
- Preserve booking, L1 authority, tenant boundaries, booking idempotency, payment
  and reminder behavior. Owner Assistant stable destination keys must remain
  useful; Customer AI and its ordinary-booking handoff must remain unchanged.

## Canonical control ownership for subsequent slices

| Destination | Controls and workflows |
| --- | --- |
| Today / Calendar | Appointment creation, move/cancel/complete/no-show, client communication, urgent schedule exceptions, contextual availability explanation |
| Clients | Search, profiles, booking/rebooking, communication history, review suppression/history |
| Services | Menu, categories, prices, duration, bookability, images, add-ons, service-specific booking controls and staff eligibility |
| Hours & Availability | Salon opening hours/timezone; individual working schedules; time off and approval; links to existing blocks and calendar availability |
| Booking Rules & Policies | Notice, slot interval, buffers, confirmation, client-change cutoff; separate policy wording/acknowledgement/display |
| Booking Page | Identity/contact/address/parking, bio/specialty/social links, logo/cover, content/layout/visibility/flow, featured presentation, preview/publication |
| Marketing & Messages | Client reminders/quiet hours; follow-ups; Reviews → Review Requests; offers/Smart Fit; rewards/referrals; social posting |
| Portfolio | Existing work-photo management; contextual selection from Booking Page |
| Payments | Client payments, deposits, taxes, currency and existing payment connection |
| Analytics | Existing reports and revenue views |
| Team | Profiles/access/commission; links to canonical schedule and service eligibility editors |
| Integrations | Calendar, external integration connection/readiness; contextual messaging/payment links |
| Plan & Usage | Existing Luster subscription and SMS usage/billing surfaces |
| Settings | Account, owner/staff notifications, workflow photo requirements, workspace modules, legal/about |

## Review automation contract

Canonical home: Marketing & Messages → Reviews → Review Requests. Modes:
manual only, after marked completed, after scheduled appointment end. Recommend
scheduled end plus one hour for newly configured solo salons. Explicitly explain
that owners must mark cancellations/no-shows before the request is sent.

Default repeat cooldown is 90 days; uncommon alternatives belong under Advanced.
Do not silently change existing salons' automation, delay, template or lifetime
deduplication behavior. No historical backfill, including mode changes,
re-enabling automation or lifting suppression.

All booking sources use the same eligibility rules. Appointment-reminder consent
does not confer appointment-transactional consent. Retain STOP, consent, tenant,
credits, recipient, provider and unknown-outcome checks. Initial delivery remains
SMS-first using the existing pipeline; email fallback is deferred. Google review
requests, rewards, internal reviews and promotional messages stay distinct.

Reuse communication intents/delivery evidence for sent/delivered/failed history.
Unknown provider outcomes must block duplicate attempts until reconciled. A
successful handoff cannot be retracted by a status change after the final check.
No provider calls while database locks are held.

The present completion transaction has financial lock ordering. A durable,
minimal trigger record should decouple review scheduling from it; do not add
blocking client locks to completion. Keep lifetime constraints until every
writer follows the replacement serialization protocol. Schema/index transitions
require independent concurrency review and disposable-database rehearsal before
any production migration decision.

## Delivery slices and status

1. **Navigation foundation — in progress.** Ranked More, Hours entry using the
   existing editor, Booking Rules/Policies leaf reuse, Plan/Help homes, legacy
   aliases and Owner Assistant destination updates. Existing Settings navigation
   is deliberately retained pending complete control moves.
2. **Schedules and booking controls.** Canonical salon/individual schedules and
   time off, solo access, timezone ownership, booking rules versus policies,
   currency relocation preserving existing partial-write and deposit guards.
3. **Remaining control consolidation.** Booking Page, Marketing, Payments, Team,
   Integrations and secondary Settings; all existing controls accounted for.
4. **Review policy and durable scheduling contracts.** Additive schema, mode and
   cooldown compatibility, durable triggers and no-backfill cutoffs; dark producer.
5. **Review eligibility and dispatcher.** Source-independent scheduled-end and
   completion evaluation, final revalidation, pending-request replacement/manual
   send interaction, retries and cooldown serialization.
6. **Review settings and status UX.** Exact controls/readiness, customer preview,
   appointment and client history with suppression reasons; no AI write tools.
7. **Release verification and migration decision.** Full compatibility/mobile
   evidence, reviewed deployment gates and explicit production migration or
   activation steps when required.

These are review boundaries, not a requirement to combine all changes into seven
PRs. Split risky schema, writer and constraint changes further when needed.

## Verification standard

Each PR records exact-head checks, independent review and actual evidence level.
Component-browser tests do not stand in for authenticated/deployed journeys.
AI compatibility includes Owner Assistant destinations/authorization, Customer AI
normal handoff, and the existing real-handler PostgreSQL journeys in both mobile
engines. Review changes additionally require races for reschedule/cancel/no-show,
manual versus automatic sends, repeat completion, cooldown identity, retries,
wrong tenants, STOP and unknown provider outcomes. No tests send real messages.

Foundation evidence: 644 AI unit/evaluation checks passed locally; the four
PostgreSQL-backed customer browser journeys are delegated to the existing
mandatory disposable CI job. Customer AI component-browser journeys passed
12/12 in Chromium and WebKit. The owner-navigation component-browser harness
passed 8/8 at 390px Chromium and 320px WebKit, covering ordering, Hours save,
Back/Forward, guarded in-workspace exits, Help and Free Solo plan visibility.

Known pre-existing shell limitation: native browser Back/Forward does not show
an unsaved-form prompt (Settings has the same behavior). Hours guards its header,
contextual shortcuts, backdrop/Escape and full-page unload. A speculative
popstate interception was rejected because it could corrupt Next.js history;
this foundation preserves normal native history behavior.

Marketing consolidation evidence: Appointment messages reuses the complete
existing communications editor, including booking SMS default and persisted
reminder timings. Offers links to Smart Fit, follow-up offers and the existing
first-visit controls in Services. Reviews retains the existing Review Requests
editor; automation behavior has not changed. Stable Owner Assistant destinations
and legacy settings URLs point to these homes. Smart Fit results retain the
existing Analytics availability check.

The final focused unit suite passed 136 tests, including communications control
parity and destination aliases. The actual-component mobile harness passed 8/8
at 390px Chromium and 320px WebKit: history, direct links, Smart Fit's guarded
header, existing reminder/default saves, and same-mounted destination switches.
Independent source review approved the final changes. Deployed, authenticated
Preview verification remains a separate gate.

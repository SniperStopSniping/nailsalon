# Owner IA and review automation: combined release record

This is the integrated implementation record, not Production activation approval.
Implementation started from Customer AI #253's merged main commit
`0f8bc56b020a74811e025b9aa0200ff9cc6d29a5`. The original dirty checkout and the
Customer AI local PostgreSQL instance were preserved. The integration worktree
combines independently reviewed owner and review-request slices; nothing here
claims a merge, migration, live message or Production deployment.

## Final owner navigation

Bottom tabs: **Today · Calendar · Clients · Services · More**.

More uses these sections and this exact display order, subject to existing
module/plan availability:

1. Booking: Hours & Availability; Booking Rules & Policies; Booking Page.
2. Clients & Growth: Marketing & Messages; Portfolio.
3. Business: Payments; Analytics; Team; Integrations.
4. Luster: Plan & Usage; Settings; Help & Resources.

`src/components/admin/AppGrid.tsx` owns the ordered More groups.
`OwnerWorkspaceNav.tsx` owns the everyday shell. `ownerNavigation.ts`, the modal
host and the existing Owner Assistant destination registry keep compatibility
links. Navigation changes do not authorize actions or alter salon resolution.

### Canonical controls and intentionally shared editors

| Canonical destination | Existing controls / actions retained |
| --- | --- |
| Today / Calendar | Appointment list/calendar, create, reschedule, cancel, decline, no-show, complete, existing payment/photo actions and contextual client communication. Existing availability windows stay computed by the booking authority. |
| Clients | Search, profile, contact information, history, notes/flags, book/rebook, message, review-request history and suppression. |
| Services | Categories/menu/library, name/description, price, duration, bookability, images, add-ons, menu display, first-visit offers, existing service-specific catalog rules and qualifications. |
| Hours & Availability → home | Salon opening hours and timezone. Working hours and Time off have visible entries; Calendar and Booking rules are contextual links. |
| Hours & Availability → Working hours | Individual weekly schedules and copy-schedule controls. The sole technician opens directly for a solo salon. Existing legacy schedules hydrate through technician detail. |
| Hours & Availability → Time off / Team time-off requests | Existing date-based time-off CRUD/reasons and team request approval/denial/conflict information. Team links to these same editors. |
| Booking Rules & Policies → Booking rules | Minimum notice, slot interval, buffers, confirmation/approval and client-change cutoff. Currency and timezone have their own proper homes. |
| Booking Rules & Policies → Client policies | Customer-facing wording, cancellation terms and acknowledgement. Wording does not create payment enforcement. |
| Booking Page → Business Information | Salon name, contact/address, live business facts and explicit-save arrival instructions. Hours is a link. |
| Booking Page → Layout / Style & Colours | Existing presets, builder, layout, menu presentation, fonts/colours. Business mode is under Advanced. Legacy page themes stay under Settings Advanced. |
| Booking Page → Business Info Display / Policies Display | Draft public visibility and address privacy; policy/review visibility has one editor. Canonical policy/rules/payment links drain pending draft writes and remain in place on failed saves. |
| Booking Page → About & Website Text / Photos & Gallery | Bio, specialty, logo/profile/cover and the existing shared Portfolio picker. Live business saves and draft/publish content remain explicitly distinct. |
| Booking Page → Public Booking Experience / Booking Flow / Preview & Publish | Booking welcome/confirmation/social content, existing gated flow order, draft preview and publication. Free Solo gates remain intact. |
| Marketing & Messages → Appointment messages | Existing email/SMS client message preferences, booking SMS default, reminder timings, pause and quiet hours; usage/setup are contextual links. Reminder behavior is unchanged. |
| Marketing & Messages → Follow-ups / Offers | Existing rebooking follow-ups and promotions, templates/expiry/services; links to first-visit offers in Services and Smart Fit. |
| Marketing & Messages → Smart Fit | Existing scheduling-gap discounts/configuration and gated analytics links. No availability algorithm changes. |
| Marketing & Messages → Reviews → Review Requests | Automation mode, delay, destination, message preview/customization, readiness, Advanced repeat policy. |
| Marketing & Messages → Rewards / Referrals / Social Posting / Results | Existing rewards and internal-review administration remain separate from Google review requests. Existing shared Rewards & Reviews component and APIs are reused. Social posting owns its existing portion of the policy editor; Results retains existing message metrics. |
| Portfolio | Reusable work-photo management. Booking Page selects from it; appointment evidence photos remain separate. |
| Payments | Deposits/readiness, e-transfer details/QR/reference/instructions, taxes/defaults/effective dates, currency and contextual Stripe connection. Existing dedicated save boundaries and all billing/payment handlers remain intact. |
| Analytics | Existing revenue/booking/client/service/staff and Smart Fit reports, calculations and entitlement gates. |
| Team | Team-member details/access/commission/languages/bio/status, existing per-tech Services & Skills and Earnings, visibility permissions. Schedules and time off link to Hours. Per-service eligibility and catalog qualifications are distinct existing concepts, not merged writers. |
| Integrations | Existing Google Calendar, texting/email readiness and payment connection. No new provider setup or credentials. |
| Plan & Usage | Existing Luster plan/billing portal, compare plans where entitled, SMS balance/usage/delivery history. These are distinct from client Payments. |
| Settings → Account | Owner profile and existing sign-in details. |
| Settings → Owner & Staff Alerts | Existing owner/staff booking/cancellation notification preferences and channel readiness. |
| Settings → Workspace Features | Existing included-module switches. The SMS module enable switch differs from customer booking SMS defaults and consent. |
| Settings → Appointment Photo Rules | Before/start, after/finish and after/pay photo requirements through the existing section-specific policy editor. |
| Settings → Advanced | Legacy page themes, feature-gated section preview, Terms and Privacy links. Photo rules is a shortcut to the same editor. |
| Help & Resources | Workspace tour, existing Luster resources/products/education/email preferences and account shortcut. |
| Owner Assistant | Existing launcher, authorization and behavior. Stable destination keys now resolve to the canonical screens. No new AI write tool. |

Legacy Settings groups can still resolve compatible links. They are absent from
the primary Settings index and do not introduce alternative canonical writers.
`SettingsModal` is still reused as a leaf component in several business homes;
component ownership is not product-navigation ownership.

**Baseline limitation:** the former Team “Blocked Time” editor was already
date-based time off. Its alias remains compatible with that editor. This project
does not invent an intraday block editor or claim that “block tomorrow afternoon”
is now a new supported workflow. Existing computed blocked windows remain in
Calendar. Introducing a distinct timed-block workflow requires its own booking
authority/product scope.

## Review behavior

Three salon modes: manual only; after explicitly marked Completed; after the
scheduled appointment end. The new-setup recommendation is **scheduled end +
one hour + 90 days**. Applying the recommendation edits a draft; Save is explicit.
Existing salons keep their actual mode, template, delay and lifetime repeat
behavior until the owner changes them. Absence of new fields never implies a new
salon. There is no historical backfill on enable, mode change, restored review
destination or lifted suppression.

The scheduled-end explanation tells owners to mark cancellations and no-shows
before the request sends. Reaching an end time does not mark an appointment
Completed, charge a client, or change reminders. Confirmed, otherwise eligible
bookings from manual, public and AI handoffs enter one shared review pipeline.

Delays: immediately, 30 minutes, one/two/four hours, 24 elapsed hours, and preserved
custom values. Twenty-four hours is not “next morning.” Quiet hours can defer
delivery within the existing expiry rules. Repeat choices under Advanced are
90/180/365 days or never; same-appointment protection remains even after cooldown.

Eligibility checks current appointment status/times/client identity, policy epoch,
salon/link readiness, suppression, recipient history, consent, STOP and dispatch
readiness. Pending/incomplete/cancelled/declined/no-show bookings do not become
scheduled-end sends. Appointment-reminder consent does not confer review-request
consent. Delivery remains the existing SMS pipeline; no email fallback or delivery
guarantee was added.

Durable trigger identity prevents replay; shared salon coordination and current
history protect manual/automatic races, recipient changes and finite cooldowns.
Unresolved sending/provider outcomes reserve their place until resolved. Eligibility
is checked again at dispatch. A provider handoff already in progress cannot be
retracted by a later cancellation. No provider calls occur while database locks
are held.

Appointment status shows waiting/scheduled, sent, delivered only with provider
evidence, failed/skipped with reason, and manual eligibility. A prior visit's send
is not presented as this visit's send. Client profiles show 20 recent records,
salon-local times, source/channel and suppression. Owner-marked device sends are
explicitly unverified. Failed/stale status loads disable send/suppression edits.

See the focused documents for [policy](REVIEW_REQUEST_AUTOMATION_SETTINGS.md),
[scheduled ends](REVIEW_REQUEST_SCHEDULED_END.md),
[manual coordination](REVIEW_REQUEST_MANUAL_COORDINATION.md),
[status](REVIEW_REQUEST_OWNER_STATUS.md) and
[repeat-index retirement](REVIEW_REQUEST_REPEAT_RETIREMENT.md).

## PR boundaries and release order

| Review boundary | PRs |
| --- | --- |
| Owner navigation, hours, currency/rules, Marketing, business information, Experience/Flow, secondary Settings, final Booking Page | #254, #255, #256, #258, #259, #261, #264, #268 |
| Additive review policy/trigger schema | #257 (0081) |
| Completion producer / history coordinator | #260, #263 |
| Nullable scheduled-end contract | #262 (0082) |
| Scheduled-end scanner / settings | #265, #266 |
| Coordinated manual writers | #267 (0083) |
| Repeat-index retirement | #269 (0084) |
| Appointment/client status | #270 |
| Combined compatibility verification | Integration branch `codex/owner-ia-reviews-integration-20260919` |

The cumulative branches preserve review history; the combined branch is a release
verification candidate, not permission to bypass the staged migration order.
No original 12-PR count is treated as a release requirement.

1. Complete exact-head CI, independent reviews and authenticated disposable
   Preview checks. Existing unchanged-main Preview and the earlier IA Preview
   both reported unhealthy configuration; a READY deployment alone is not proof.
2. With environment-specific migration authorization, apply additive compatibility
   schema before dependent code, following existing migration safeguards.
3. Deploy all coordinated writers while lifetime indexes remain. Drain older
   processes; verify no legacy writer remains.
4. Separately authorize/rehearse 0084 retirement. It only removes lifetime
   client/recipient indexes, retaining appointment/trigger/history protection.
   After legitimate repeats exist, rebuilding old uniqueness is not an automatic
   rollback. Preserve history and use a reviewed forward repair.
5. Existing salons select automation/cooldown explicitly. Any live-recipient
   verification requires provider/recipient authorization. None was sent here.

## Evidence and remaining gates

Individual PRs record focused tests, source reviews and local mobile harness
results. The combined head must independently pass the final suite; results on
an ancestor are not a substitute. Real PostgreSQL CI attests a disposable target
and requires exact zero-skip markers for booking and review concurrency suites.
Local skipped PG tests are collection checks only.

The Customer AI real-handler browser proof retains four journeys: Chromium and
WebKit with L1 on/off, ordinary handoff, existing appointment/reminder assertions,
and shared review reservation at end + one hour without completion. Explicit
synthetic review consent is separate from reminder consent. No dispatcher or
provider is invoked. Owner Assistant destination/authorization/evaluation tests
remain required. Browser harnesses reject unexpected external network calls.

Known inherited limitations are preserved: native browser Back does not prompt
for unsaved forms (guarded in-app exits and unload do); the legacy booking-settings
server snapshot merge is not converted into atomic per-field persistence; and
deployed authenticated Preview evidence is separate from local component evidence.

Final CI run identifiers, mobile totals and exact integrated SHA are recorded in
the integration PR after completion. Production migration, live messaging and
activation remain unperformed until their explicit boundaries are satisfied.

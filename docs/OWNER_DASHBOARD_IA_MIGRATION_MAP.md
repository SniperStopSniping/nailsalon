# Luster Owner Dashboard — IA Migration Map

This map was prepared from `OWNER_DASHBOARD_CURRENT_INVENTORY.md` and the current `origin/main` implementation before application code was changed. “Link” means the old surface may show status/context but does not own a competing editor.

## Canonical ownership map

| Current location | Existing controls / actions | New canonical location | Old location treatment | Save / behavior risk |
|---|---|---|---|---|
| Booking Page → Your Information → Business identity | Business name, booking URL, nail-tech name, logo, profile photo, cover photo, public profile visibility | Settings → Business → Business Profile (name/identity); Booking Page → Photos & Gallery (photos); Booking Page → Business Info Display (visibility) | Read-only current values with edit links; presentation switches remain | Business identity saves live immediately; photos use upload/delete APIs; website visibility remains draft/publish |
| Booking Page → Your Information → Location | Location name, street, city, province/state, postal code | Settings → Business → Location & Arrival | Read-only address plus “Edit salon address” link | Address saves live; address visibility/privacy stays draft/publish |
| Booking Page → Your Information → Contact | Phone, email, Instagram, contact permissions | Settings → Business → Business Profile / Branding & Social | Read-only values plus edit links; show/hide stays in Booking Page | Contact values save live; public visibility remains draft/publish |
| Booking Page → Your Information → Hours | Monday–Sunday, opening/closing times, timezone | Settings → Business → Business Hours | Read-only hours plus “Edit business hours” link; show/hide stays | Hours/timezone save live and affect availability; public visibility remains draft/publish |
| Settings → Location | Parking instructions, arrival directions, link to address/contact/hours editor | Settings → Business → Location & Arrival | Removed from old Settings hierarchy | Parking is stored in retention settings and has an independent explicit save; preserve partial-write body |
| Settings → Branding | Booking message, confirmation message, Instagram/Facebook/TikTok, logo, legacy page themes | Settings → Business → Branding & Social; Settings → Advanced → Legacy Page Themes | Split into the two canonical destinations | Booking experience save is live and explicit; legacy themes affect live legacy pages and must not be silently unified with website drafts |
| Settings → Booking rules | Buffer minutes, slot interval, currency, client-change cutoff, confirmation mode, minimum notice, timezone | Settings → Booking & Availability → Availability / Booking Rules | Split by purpose; no duplicate editor | One explicit settings save currently persists the combined booking block; split presentation must preserve one form/save or dirty-field semantics |
| Settings → Booking rules | Intro label, Feature Luster Manicure, Show service images | Services → individual service/menu appearance | Removed from global Booking Rules; compatibility summary/link only if needed | Existing fields remain stored; moving their editor must not change public rendering |
| Settings → Booking policy | Enable, title, full text, acknowledgment, wording, placements, badges | Settings → Booking & Availability → Client Policies | Direct move | Explicit booking-experience save; policy display toggles on Booking Page link here rather than duplicate content |
| Settings → Booking flow | Service, Technician, Date/Time, Confirmation, technician visibility, drag/drop order | Settings → Booking & Availability → Booking Flow | Direct move | Preserve plan gate and booking-flow persistence |
| Settings → Smart Fit | On/off, percentage/fixed, amount, max gap, minimum improvement, eligible services/technicians | Settings → Booking & Availability → Smart Fit | Direct move | Preserve entitlement, explicit save, and Analytics results link |
| Settings → Client communications | Email/SMS switches, pause communications, reminder rules, quiet hours, usage link | Settings → Messages & Notifications → Client Messages / Appointment Reminders / Quiet Hours / Message Usage | Split into cards backed by the same communications payload | Reminder rules and quiet hours save together today; avoid stale whole-form overwrites |
| Marketing → Follow-ups | Appointment reminder lead hours | Settings → Messages & Notifications → Appointment Reminders | Read-only summary and “Manage reminders” link | Competing retention-setting value may still drive the manual reminder queue; preserve it as compatibility data but remove the Marketing editor |
| Settings → Notifications | Assigned technician/owner booking and cancellation alerts, owner email alerts, destination email | Settings → Messages & Notifications → Owner & Staff Alerts | Direct move | Two explicit save paths exist (booking alerts and salon email recipient); preserve both |
| Integrations → Text/Email | Readiness, sending identity, reminder/email health | Integrations → Text Messaging / Email | Keep readiness only; links to Messages & Notifications | Provider checks must remain read-only and must not become preference writes |
| Settings → Features | Referrals, Rewards, Schedule Overrides, Staff Earnings, Client Flags, Client Blocking, Analytics Dashboard, Utilization, Reviews, Rewards Program | Settings → Features | Direct move with current entitlements/locks | Module toggles and program toggles use different APIs; preserve both |
| Settings → Features → Active Offers | Fixed referral reward, friend offer, Google review reward, visit earning rate | Rewards & Reviews → Offers | Remove offer values from Features | Values are currently fixed/read-only platform facts; do not imply they are editable |
| Settings → Account | Owner name/email, plan, compare plans, subscription billing, usage & billing | Settings → Account & Plan → Owner Profile / Plan / Usage / Billing | Direct move and clearer Luster-billing wording | Profile and portal actions are independent; sign-in email may be locked |
| Settings → Payments & taxes | Deposit enabled/amount/readiness | Payments → Deposits | Old Settings deep link opens Payments | Deposit uses a dedicated dirty-field save and readiness gates; do not merge with tax save |
| Settings → Payments & taxes | Card/online status, e-transfer recipient/display/autodeposit/instructions/reference/QR | Payments → Payment Methods | Old Settings deep link opens Payments | E-transfer is part of the payments form; Stripe connection remains a link to Integrations |
| Settings → Payments & taxes | Charge tax, name, rate, jurisdiction/country/region, forfeited deposits, inclusive pricing, taxable defaults, scheduled changes | Payments → Taxes | Old Settings deep link opens Payments | Tax form is explicit-save with scheduled-effective-date semantics |
| Integrations → Payments | Stripe readiness, requirements, setup/resume/reconnect | Integrations → Payments | Payments app shows status and “Manage Stripe connection” link | Never duplicate provider setup |
| More → Staff | Staff list/add, identity, contact, role, skill, commission, languages, clients, bio, status; per-tech tabs | Team → Team Members | Legacy `?app=staff` resolves to Team | Preserve technician APIs and per-tech tab behavior |
| Staff detail → Schedule | Weekly working days/times, copy schedule, owner-created time off | Team → Schedules / Time Off → Blocked Time | Same technician editor, reached from Team cards | Weekly schedule and time-off CRUD are separate; preserve reason types and confirmation |
| More → Time-off requests | Pending/approved/denied/all, conflicts, approve/deny | Team → Time Off → Requests | Legacy `?app=staff-ops` resolves to Team Time Off | Preserve request-vs-owner-block distinction and authorization |
| Staff detail → Services | Technician/service capability | Team → Services & Skills | Same capability editor, reached from Team | Services may link here; do not fork capability state |
| Settings → Staff visibility | Client phone/name/email, price, history, notes, other-tech appointments | Team → Permissions | Old Settings row removed; compatibility deep link resolves to Team | Preserve feature entitlement and immediate autosave |
| Staff detail → Earnings | Today/week/month, tech/salon share, commission, appointment counts | Team → Earnings | Same earnings tab, reached from Team | Reporting only; preserve calculations and staff-earnings gate |
| More → Rewards | Reward status/history and referrals | Rewards & Reviews → Rewards Program / Referrals | Legacy `?app=rewards` opens combined app | Reuse existing reward/referral API |
| More → Review rewards | Review count/average, rows, manual grant, Google Business link | Rewards & Reviews → Reviews | Legacy `?app=reviews` opens Reviews tab | Reuse existing reviews API and reward-grant action |
| Marketing → Review settings | Google review link, ask-client/review workflow, Google Business shortcut | Marketing → Reviews | Remains acquisition workflow; link to Rewards & Reviews for results/grants | Do not duplicate review records or rewards configuration |
| Policy page | Before Photo to Start, After Photo to Finish, After Photo to Pay | Settings → Advanced → Appointment Photo Rules | Existing URL remains; section-specific deep link | One policy payload and higher-level override resolver must remain intact |
| Policy page | Auto-post, Instagram/Facebook, include price/colour/brand, AI caption, Meta readiness | Marketing → Social Posting | Existing URL remains; section-specific deep link | Same policy payload and override rules; provider readiness stays read-only |
| Booking Page → Photos & Gallery | Portfolio shortcut | Portfolio | Direct shared destination | Portfolio remains the only reusable public gallery; appointment photos stay separate |
| More → Workspace tour | Replay workspace tour | More → Help & tour (small utility row) | Removed from main app grid, not removed from product | Preserve local completion/replay behavior |
| More → Analytics | Revenue, bookings, services, clients, staff, Smart Fit, marketing facts | Analytics | Remains standalone | Preserve calculations and module gate |
| Services | Menu/catalog/add-ons/library and service editor | Services bottom navigation | Remains primary; simplify labels without changing records | Preserve service/add-on/catalog identity and all service APIs |

## New navigation hierarchy

```text
More
├── Booking Page
├── Marketing
├── Analytics
├── Team
├── Payments
├── Integrations
├── Rewards & Reviews
├── Portfolio
├── Settings
├── Luster
└── Help & tour
```

Settings becomes six scan-friendly hubs: Business; Booking & Availability; Messages & Notifications; Features; Account & Plan; Advanced. Legacy URLs remain accepted and resolve to the appropriate canonical surface.

## Resumable implementation batches

1. More grid, safe legacy deep-link aliases, and new Team/Payments/Rewards & Reviews hubs.
2. Settings card home, grouped sub-hubs, canonical cross-app links, and removal of competing offer/reminder editors.
3. Booking Page presentation-vs-live-information split and Business canonical entry points.
4. Photo/social split, Services labels/links, tests, browser verification, screenshots, and final documentation.


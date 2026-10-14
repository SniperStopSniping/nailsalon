# Luster feature cleanup

Status: implemented locally; final verification and delivery recorded below. Based on the October 13, 2026 product audit; current source is inspected independently of that snapshot.

## Scope and implementation plan

1. Disable new Google-review rewards; preserve honest review requests and historical financial records.
2. Remove unreachable customer account and membership presentation code, retaining retired route tombstones, customer identity, consent, recovery and financial infrastructure.
3. Hide unfinished loyalty, referrals, Discover and social-posting controls. Retain photo upload, portfolio metadata and future integration infrastructure with truthful availability states.
4. Keep owner-managed staff profiles, services, earnings and availability. Remove unavailable staff invitation/authentication and self-service entry points; retain historical time-off records and owner review tools.
5. Simplify catalog and billing presentation without changing booking rules, entitlements, prices, ledgers or existing subscription contracts.
6. Run isolated regression and browser checks; document exact results, limitations, remaining legacy code and delivery state.

## Dependency map established before application edits

| Features | Affected entry points | Shared dependencies to preserve | Implementation boundary |
| --- | --- | --- | --- |
| F048 review rewards | `ReviewsModal`, `RewardsReviewsModal`, review reward POST API, Marketing and feature settings | Review-request settings/dispatcher, review history, reward table, reward display and checkout redemption | Retire creation action/API; keep historical read and discount handling |
| F049/F050/F051/F078 customer programs/accounts | Retired `profile`, `membership`, `rewards`, `invite`, `my-referrals`, preferences/payment/history content; unused booking dock; booking points copy | `clientAuth` denial, `clientApiGuards`, shared client identity, appointment relationships, referral/reward/points tables, checkout/refund logic, guest booking, manage/recovery | Delete unused presentation; keep route tombstones and guarded historical infrastructure |
| F025 Discover | Portfolio readiness/actions and booking-page promotional copy | Photo upload/storage, gallery/portfolio selection, taxonomy, eligibility and stored metadata | Hide marketplace claims/actions; retain useful photo management |
| F071/F072 social posting/captions | Marketing shortcut, owner policy page/form, caption placeholder, worker/queue gates | Appointment photos, photo requirements, policy storage, future Meta publisher/queue | Remove ordinary owner controls and fake AI implementation; use explicit worker opt-in |
| F060/F061 staff workspace/requests | Team and Hours shortcuts, Add Staff invitation, staff Settings access controls, invite API | Technician profiles/contact data, schedules, assignments, commissions, availability, owner time-off decisions/history, existing permission policy | Remove unavailable self-service/access actions; do not reactivate authentication |
| F010 catalog rules | Services navigation and advanced catalog panels | Canonical rule engine, service/add-on API semantics, required rule enforcement, approvals, technician assignments | Presentation/progressive disclosure only |
| F065 billing | More navigation, billing hub, usage modal and settings copy | 100-credit eligibility and durable identity, top-up checkout/offers, balances, Stripe, webhook reconciliation/refunds, invoices, financial history, subscription contracts and entitlements | Presentation only; document active-contract migration separately |
| Protected no-shows | No cleanup edits planned | Shared identity/HMAC, risk counts, corrections, moderation, deposit thresholds and PR #449 | Keep separate branch intact; verify combined compatibility before merge |

## Concurrent work

- Cleanup starts from `origin/main` at `73d1b9b8daceb10c8c71f35e7eaad5760e515130`, in a clean `codex/product-cleanup` worktree. Original user-owned untracked files are untouched.
- Open PR #449 (`codex/no-show-reporting`) owns the 24-hour reporting/review workflow. Its worktree and source changes are not overwritten.
- Open PR #349 (`feat/free-access-sms-topups`) overlaps billing presentation and proposes **50** starter credits. The current instruction and main catalog specify **100**. This cleanup must not import its grant, price, renewal, schema or entitlement changes. Reconcile presentation conflicts and the policy discrepancy before either branch is merged.
- No production migrations, records, prices, subscription cancellations, messages or payments are authorized by this cleanup.

## Before-and-after feature inventory

| ID / feature | Before | After | Removal type / retained infrastructure |
| --- | --- | --- | --- |
| F048 Google review rewards | Owner could verify a review manually and grant a $10 discount through a live POST route; Offers and review settings promoted it | No grant action or promotional incentive copy. Authenticated legacy requests receive `410 REVIEW_REWARDS_RETIRED` | Feature-specific write implementation removed. Historical rewards, review associations, discount redemption and financial references preserved |
| F051 customer membership tiers | Unmounted customer interface described Bronze/Silver/Gold/VIP-style perks; page already returned not found | Membership presentation deleted; route remains retired | Unused UI removed; no customer records, balances, visits or history deleted; no replacement program |
| F072 AI social captions | Owner/platform switches claimed AI generation; implementation returned null and used a template | Fake AI generator and switches removed; deterministic caption remains for retained integration infrastructure | AI placeholder removed; legacy payload/database fields remain compatible and have no advertised AI effect |
| F078 legacy customer accounts | Dead profile/preferences/payment/history interfaces, unused login modal and booking dock remained in source | Unreachable account interfaces, login modal and dock deleted; active booking stays account-free | UI removed; retired page tombstones, authentication denial, consent, client identity, recovery and secure management links retained |
| F049 loyalty points | Booking review/result showed estimated points despite unavailable customer redemption/account pages; owner program switches remained | No customer points promises or self-redemption UI; ordinary owner loyalty switches hidden | Presentation hidden/removed; historical points/rewards, earning records and valid financial/checkout handling retained |
| F050 friend referrals | Unmounted Invite/My Referrals screens and owner program shortcuts suggested generation was available | Customer interfaces and ordinary owner shortcuts removed | Historical referral records and client-guarded legacy APIs preserved |
| F025 Discover | Portfolio advertised readiness and offered Show/Hide in Discover; booking-page editor advertised Discover | No public-marketplace controls or acquisition promise; photo upload, selection and service/length tagging remain | UI hidden; taxonomy, eligibility, stored inclusion flags and future API infrastructure retained |
| F071 automatic social posting | Marketing shortcut, owner photo/social policy form, provider diagnostics and an implicitly enabled worker implied availability | Ordinary owner controls removed; photo form only saves photo rules. Queue creation/worker require explicit global opt-in | Postponed UI; queue, publisher, platform controls and historical settings retained. No queue rows removed |
| F061 staff time-off requests | Team/Hours promoted a self-service request workflow; retained staff schedule contained a request form | Ordinary entry points and staff request form removed | Owner-managed days off, availability and existing requests/owner decisions remain; historical owner inbox is still reachable through saved authorized links |
| F010 advanced catalog rules | Advanced Catalog behind More; service approval was buried in catalog configuration | Primary My Menu, Add-ons and Booking approval; clearly labeled Advanced Settings with Library and Rules & options | Presentation only. Stored approval mode retained; duplicate advanced approval entry removed; unfinished consultation option hidden unless historically stored; required/enforced add-on explanations added |
| F065 subscription billing | Plan & Usage emphasized plans/core access and optional subscriptions | Usage & SMS prioritizes credits/top-ups, states free core booking, and labels existing SMS agreements separately | UI simplified; 100-credit eligibility, balances, prices, subscriptions, ledgers, invoices, Stripe and reconciliation unchanged |
| F060 staff workspace | Creating a technician automatically sent a login SMS; owner could paste a Clerk ID or resend an invite; Team promoted permissions | Automatic invitations, Clerk-link control and resend controls removed; old invite requests receive `410 STAFF_ACCESS_UNAVAILABLE` | Profiles, contact information, schedules, service assignments, owner earnings, historical identity links and permission enforcement preserved |

## What changed for salon owners and customers

- **Reviews:** Owners can read recorded feedback and open honest Google review-request settings. There is no reward grant, $10 offer or incentive for posting a review. Existing review rewards can still be recognized as historical records.
- **Booking:** Customers see their services, prices, time, technician and confirmation without points promises or account links. Guest identity collection, consent, payments, secure appointment management and recovery use the existing implementation.
- **Photos:** Owners can upload, tag, select and delete portfolio images with existing rights confirmation, errors and retry behavior. Discover readiness and publishing claims are absent. Photo rules are the only fields saved by the owner policy form, even from an older social-settings URL.
- **Services:** Booking approval is available before Advanced Settings. Existing `null`, instant, approval-required and consultation values are passed through from the canonical service response. Opening the screen performs no change. The existing approval editor still sends only the intended field and preserves its validation and double-submit protection.
- **Add-ons:** Offering an extra is distinguished from requiring a choice or adding an item automatically through a rule. Advanced rule sentences, selection limits, prices and enforcement are unchanged.
- **Team:** Creating a profile creates a staff record without sending a login invitation. Owners manage technicians and their availability; the cleanup does not advertise a staff sign-in workflow. Saving unrelated profile settings omits `userId`, preserving an existing identity link.
- **SMS and billing:** Owners first see credit balance/usage and one-time top-ups. Billing records and the Stripe portal remain available. Existing subscription status explicitly concerns an existing SMS agreement; it does not imply core booking requires a subscription. Eligible starter claims remain subject to current verification/readiness safeguards.
- **Navigation:** Retired destinations disappear from ordinary navigation and the supported owner assistant's destination list. Compatibility links continue to open supported review/credit screens or retained authorized historical tools. The unused per-page theme selector only lists booking pages.

## Preserved features and data

No schema or migration file is changed. No tables, production records, financial entries, customer identities or appointment relationships are deleted. No provider packages are removed or added.

The cleanup preserves online/manual/walk-in booking; appointment/calendar management; services, prices and add-ons; booking layouts, draft/preview/publish; owner customer history and insights; confirmations, email/SMS dispatch and reminders; rebooking and Smart Fit; honest review requests; no-show reports, exact identity matching, 12-month risk counts, corrections, moderation and deposit thresholds; deposits/refunds, checkout/invoices; SMS balances/top-ups/ledgers; Google Calendar; owner authentication; and the supported AI booking/owner pilot infrastructure.

Deleted files are verified unmounted presentation and their dedicated tests. Their existing page routes continue to deny entry. The legacy auth/session guards are retained, including disabled customer-session creation. Shared client identity and no-show matching are not account UI and are untouched.

## Billing boundary and decisions still requiring review

1. Main's free plan already specifies **100 one-time starter credits**. This cleanup does not grant them, bypass verification, initialize accounts, alter prices, or enable payment/starter readiness flags.
2. Historical paid plan definitions and monthly allowance processing remain because they describe financial agreements and prepaid coverage. Existing subscription checkout/portal/webhook/reconciliation APIs and their environment gates are retained; hiding plan sales is not cancellation of a contract.
3. Open PR #349 proposes a broader free-model migration, renewal transitions and **50** starter credits. Do not merge its policy unchanged against this request. Reconcile the intended 100-credit policy, overlapping UI files and any active-contract migration separately.
4. Any renewal cancellation, active-plan migration, new subscription-sales policy, live Stripe price/provider setup or historical credit backfill requires a separately reviewed rollout. None was performed here.
5. Founding/lifetime access records remain in the data model; the free-core UI message does not rewrite those records or entitlements.

## Retained legacy code and deliberate limitations

- Customer reward/redemption/referral APIs remain behind the disabled customer-session guard. Historical points, referral and reward processing are retained to avoid damaging existing balances, discounts, invoices or refunds. This task does not rebuild those programs.
- `RewardsModal` remains as an unmounted historical owner-record component; its review-reward grant instructions were removed. Reward display rules still describe historical reward types for existing financial records.
- Retired customer route wrappers and old theme/database keys remain for compatibility. Unmounted Gallery and Change Appointment presentation remains; the latter's canonical route still returns not found. Supported appointment management uses the separate capability-token workflow.
- Staff permission policy, auth guards and historical owner time-off review APIs/inbox remain. New ordinary self-service and invitation actions are hidden/disabled; no staff/customer auth was reactivated.
- Auto-post queue rows, provider integration code, stored policy fields and platform controls remain. **Unset/false `ENABLE_AUTOPOST_GLOBAL` now means disabled** for both new photo contributions and worker processing. Explicit `true` preserves operator opt-in; it does not establish provider readiness or generally available social publishing. A skipped worker reports zero processed/succeeded and leaves the queue untouched.
- Legacy AI/include-price/colour/brand fields are retained for serialized payload compatibility. The basic template does not invent those details. No new AI caption feature or AI voice feature is introduced.
- No authenticated hosted-preview, live payment/SMS, real staff login or real customer record was used for verification. Automated component fixtures and mocks are narrower than a complete production journey.

## Review and release risks

- Review the intentional worker default change before a later release if any operator-managed integration uses an unset global flag. Queue data is preserved; explicit configuration controls processing.
- Reconcile billing presentation conflicts with PR #349. Its 50-credit policy is inconsistent with the current 100-credit requirement.
- Keep PR #449 independent. Cleanup does not modify its no-show worktree or reporting implementation; final combined CI is required before either is merged.
- Older cached clients receive explicit 410 errors for retired reward grants and staff invites. These endpoints do not read customer/technician records or write financial data after authorization.
- Do not merge or deploy this task automatically. No production data/billing mutation or migration is included.

## Recommended follow-ups

- Complete the separately reviewed billing migration/provider readiness work using the approved starter-credit policy.
- Merge the no-show reporting/review work only after its own gates and combined-main verification pass.
- Validate the final owner flow in an authenticated isolated hosted preview before release; keep real messages/payments disabled.
- Retire additional historical program APIs only through a data-retention and compatibility review, after verifying all checkout/financial dependencies.
- Before a later Vercel deployment, upgrade the CLI with `npm i -g vercel@latest`; the session reports 62.7.0 is behind 64.0.2. No CLI upgrade or deployment was performed during cleanup.


## Verification and delivery

All checks use synthetic fixtures, mocks or isolated local database tests. No real SMS/email, live payment, customer booking, production record or booking-page publication is performed.

| Check | Result and practical scope |
| --- | --- |
| Combined local regression | **1,145 passed across 77 files.** Includes affected UI, retired API grants/invites, customer route tombstones, booking/consent/deposits, financial/credit ledgers, top-ups and reconciliation, review requests, availability, no-show counts/corrections/moderation/reconciliation, owner permissions, booking-page controls and assistant navigation |
| Final catalog/layout polish | **101 passed across 3 files**, repeating affected coverage after the last presentation refinements; not additional unique tests |
| Portfolio browsers | **18 passed** on Chromium/WebKit, including 320/390/1280px selection/tagging, errors, interrupted writes, deletion confirmation and hidden marketplace controls |
| Navigation browsers | **36 passed** on Chromium/WebKit; final four approval cases repeated after visual refinement. Tests retain URL/salon context, working-hours/days-off saves, dirty-leave guards, credit shortcuts and default/approval mode state |
| Billing browsers | **10 passed** on Chromium/WebKit; free-core messaging, legacy agreements, balance, one-time offers, saved plan links and explicit portal actions |
| Marketing browsers | **10 passed** on Chromium/WebKit; supported reviews/rebooking/Smart Fit/message routes and retired voice-route recovery |
| Guest booking browsers | **6 passed** across desktop Chromium, mobile Chromium and mobile WebKit; keyboard order and confirmed guest receipt without unfinished points/account promises |
| Additional client profile regression | **43 passed**, with the 124 registry cases repeated in the same run; registry repeats are not added to the unique total |
| SMS allowance/usage browsers | **24 passed** on Chromium/WebKit, including lookup/claim failure, owner-only restrictions, 100-credit wording and unchanged balance |
| Core owner browsers | **34 passed** on Chromium/WebKit; calendar, client and service layout/accessibility across phone and desktop canvases |
| Type generation / TypeScript | Passed with explicit CI placeholders; no live provider credentials used |
| ESLint | Passed with 0 errors and 23 existing warnings; no broad unrelated refactoring |
| Secret hygiene | Passed; tracked source checked without disclosing credentials |
| Working-tree diff | Checked for whitespace and accidental unscoped files |

**Unique final coverage: 1,188 unit/integration cases and 138 browser cases.** Repeated polish/registry/browser runs are excluded from those totals.

Initial failures were expected assertions for retired labels/actions, plus a new test's missing mock setup and an overly broad caption regex. All were corrected and rerun. Browser inspection additionally found the desktop modal's crowded four-column tabs; the final two-column layout has containment assertions. Unsupported consultation controls are hidden for normal services while historical stored values remain visible and unchanged.

### Test coverage boundaries

- Review-reward retirement covers malformed context, owner/tenant denial, repeated/concurrent calls and absence of financial writes.
- Staff invitation retirement covers owner/tenant denial and absence of SMS sends. Staff setting saves omit the historical `userId` field; profile, schedule and service APIs are preserved.
- Photo uploads still dual-write canonical photo/artifact records and preserve duplicate prevention. Historical enabled social settings cannot queue a post while the global worker is disabled. The worker reports a skipped result and performs no queue/provider work.
- Credit and legacy agreement tests preserve balances, portal authorization, reconciliation, refunds and paid-through status. No contract transition, live price or grant is tested through production mutation.
- Core no-show tests include cross-salon counting, tenant isolation, correction and reconciliation. No file changed by open PR #449 overlaps this cleanup as of the recorded review. Its new early-report/review acceptance cases belong to that separate branch.
- Automated components do not establish authenticated hosted-preview readiness or provider delivery. No production migration, merge or deployment is part of this result.

### Visual evidence

These are real renders of isolated synthetic fixtures, not production customer records. Four screenshots were inspected for readable layout and clipping:

- [Booking approval — mobile](visuals/booking-approval-mobile.png)
- [Booking approval — desktop](visuals/booking-approval-desktop.png)
- [Portfolio — mobile](visuals/portfolio-mobile.png)
- [SMS credits — mobile](visuals/sms-credits-mobile.png)

### Source traceability

| File and line | Relevant implementation |
| --- | --- |
| `src/app/api/admin/reviews/[reviewId]/reward/route.ts:9` | export async function POST |
| `src/components/admin/ReviewsModal.tsx:78` | export function ReviewsModal |
| `src/components/admin/ReviewRequestSettings.tsx:180` | Ask clients for an honest |
| `src/components/admin/PolicyForm.tsx:130` | const ownedPolicy |
| `src/components/admin/PortfolioModal.tsx:105` | export function PortfolioModal |
| `src/components/admin/ServicesModal.tsx:3198` | services-tab-approval |
| `src/components/admin/catalogConfig/RulesPanel.tsx:434` | export function RulesPanel |
| `src/components/admin/catalogConfig/AddOnsAndGroupsPanel.tsx:222` | Required — client |
| `src/components/admin/UsageBillingModal.tsx:547` | Core booking is free |
| `src/components/admin/TeamModal.tsx:13` | const TEAM_ITEMS |
| `src/components/admin/staff/AddStaffModal.tsx:274` | onSuccess(); |
| `src/app/api/admin/technicians/[id]/invite/route.ts:9` | export async function POST |
| `src/core/config/flags.ts:28` | ENABLE_AUTOPOST_GLOBAL: |
| `src/app/api/appointments/[id]/photos/confirm/route.ts:283` | if (kind === 'after' && |
| `src/core/autopost/caption.ts:10` | export async function generateCaption |
| `src/libs/ownerAssistant/registry.ts:64` | entry('rewards_reviews' |
| `src/libs/clientAuth.ts:63` | export async function getClientSession |

### Reproduce local checks

The test-file manifest contains the 78 verified unit/integration files. From this worktree, with installed dependencies:

```sh
xargs ./node_modules/.bin/vitest run --no-file-parallelism < docs/product-cleanup/verification-tests.txt
node scripts/check-secret-leaks.mjs
```

Browser configurations: `ownerPortfolio` (all), `ownerNavigation` (all), `ownerSettingsPlan` (all), `ownerMarketing` (all), `ownerSecondary` (`--grep 'usage|allowance|free-text'`), `ownerCoreTabs` (all), and `booking-theme/readability.spec.ts` (`--grep 'confirmation keyboard|confirmed receipt'`). All use isolated local fixtures. Use a dedicated `BOOKING_THEME_PORT` if another fixture already occupies its default port.

Type generation/type checking used explicit CI placeholders. These checks do not substitute for required remote CI and an authenticated isolated hosted preview.

## Exact files changed

| Change | File |
| --- | --- |
| Added | `docs/product-cleanup/LUSTER_FEATURE_CLEANUP.md` |
| Added | `docs/product-cleanup/verification-tests.txt` |
| Added | `docs/product-cleanup/visuals/booking-approval-desktop.png` |
| Added | `docs/product-cleanup/visuals/booking-approval-mobile.png` |
| Added | `docs/product-cleanup/visuals/portfolio-mobile.png` |
| Added | `docs/product-cleanup/visuals/sms-credits-mobile.png` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/appointments/history/AppointmentHistoryContent.tsx` |
| Modified | `src/app/(unauth)/book/confirm/BookConfirmClient.test.tsx` |
| Modified | `src/app/(unauth)/book/confirm/BookConfirmClient.tsx` |
| Modified | `src/app/(unauth)/book/confirm/ReviewAppointmentSummary.tsx` |
| Modified | `src/app/(unauth)/book/confirm/page.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/invite/InviteContent.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/membership/MembershipContent.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/my-referrals/MyReferralsContent.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/payment-methods/PaymentMethodsContent.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/preferences/PreferencesContent.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/profile/ProfileContent.directions.test.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/profile/ProfileContent.tsx` |
| Modified | `src/app/(unauth)/rewards-disabled/page.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/rewards/RewardsContent.financial.test.tsx` |
| Deleted unused UI or dedicated test | `src/app/(unauth)/rewards/RewardsContent.tsx` |
| Modified | `src/app/[locale]/(auth)/staff/schedule/page.tsx` |
| Modified | `src/app/[locale]/admin/page.test.tsx` |
| Modified | `src/app/[locale]/admin/policies/client.test.tsx` |
| Modified | `src/app/[locale]/admin/policies/client.tsx` |
| Modified | `src/app/[locale]/admin/policies/page.tsx` |
| Modified | `src/app/api/admin/reviews/[reviewId]/reward/route.test.ts` |
| Modified | `src/app/api/admin/reviews/[reviewId]/reward/route.ts` |
| Added | `src/app/api/admin/technicians/[id]/invite/route.test.ts` |
| Modified | `src/app/api/admin/technicians/[id]/invite/route.ts` |
| Modified | `src/app/api/appointments/[id]/photos/confirm/route.test.ts` |
| Modified | `src/app/api/appointments/[id]/photos/confirm/route.ts` |
| Added | `src/app/api/autopost/process/route.test.ts` |
| Deleted unused UI or dedicated test | `src/components/BlockingLoginModal.test.tsx` |
| Deleted unused UI or dedicated test | `src/components/BlockingLoginModal.tsx` |
| Modified | `src/components/admin/AdminModalHost.tsx` |
| Modified | `src/components/admin/AppGrid.test.tsx` |
| Modified | `src/components/admin/AppGrid.tsx` |
| Modified | `src/components/admin/BookingPageInformationEditor.tsx` |
| Modified | `src/components/admin/ClientsModal.tsx` |
| Modified | `src/components/admin/MarketingModal.test.tsx` |
| Modified | `src/components/admin/MarketingModal.tsx` |
| Modified | `src/components/admin/OwnerDashboardIA.test.tsx` |
| Modified | `src/components/admin/OwnerManagementModal.test.tsx` |
| Modified | `src/components/admin/OwnerManagementModal.tsx` |
| Modified | `src/components/admin/PageThemesSettings.tsx` |
| Modified | `src/components/admin/PolicyForm.test.tsx` |
| Modified | `src/components/admin/PolicyForm.tsx` |
| Modified | `src/components/admin/PortfolioModal.test.tsx` |
| Modified | `src/components/admin/PortfolioModal.tsx` |
| Modified | `src/components/admin/ReviewRequestSettings.tsx` |
| Modified | `src/components/admin/ReviewsModal.test.tsx` |
| Modified | `src/components/admin/ReviewsModal.tsx` |
| Modified | `src/components/admin/RewardsModal.tsx` |
| Modified | `src/components/admin/RewardsReviewsModal.tsx` |
| Modified | `src/components/admin/ServicesModal.test.tsx` |
| Modified | `src/components/admin/ServicesModal.tsx` |
| Modified | `src/components/admin/SettingsModal.billing.test.tsx` |
| Modified | `src/components/admin/SettingsModal.communications.test.tsx` |
| Modified | `src/components/admin/SettingsModal.features.test.tsx` |
| Modified | `src/components/admin/SettingsModal.index.test.tsx` |
| Modified | `src/components/admin/SettingsModal.tsx` |
| Modified | `src/components/admin/TeamModal.tsx` |
| Modified | `src/components/admin/UsageBillingModal.test.tsx` |
| Modified | `src/components/admin/UsageBillingModal.tsx` |
| Modified | `src/components/admin/catalogConfig/AddOnsAndGroupsPanel.test.tsx` |
| Modified | `src/components/admin/catalogConfig/AddOnsAndGroupsPanel.tsx` |
| Modified | `src/components/admin/catalogConfig/BookingConfirmationPanel.test.tsx` |
| Modified | `src/components/admin/catalogConfig/BookingConfirmationPanel.tsx` |
| Modified | `src/components/admin/catalogConfig/CatalogConfigTab.test.tsx` |
| Modified | `src/components/admin/catalogConfig/CatalogConfigTab.tsx` |
| Modified | `src/components/admin/onboarding/OnboardingWorkspaceHandoff.test.tsx` |
| Modified | `src/components/admin/serviceAddOns/ServiceAddOnSummary.tsx` |
| Modified | `src/components/admin/staff/AddStaffModal.tsx` |
| Modified | `src/components/admin/staff/tabs/SettingsTab.test.tsx` |
| Modified | `src/components/admin/staff/tabs/SettingsTab.tsx` |
| Deleted unused UI or dedicated test | `src/components/booking/BookingFloatingDock.test.tsx` |
| Deleted unused UI or dedicated test | `src/components/booking/BookingFloatingDock.tsx` |
| Modified | `src/components/super-admin/SuperAdminPolicyForm.test.tsx` |
| Modified | `src/components/super-admin/SuperAdminPolicyForm.tsx` |
| Added | `src/core/autopost/caption.test.ts` |
| Modified | `src/core/autopost/caption.ts` |
| Added | `src/core/config/flags.test.ts` |
| Modified | `src/core/config/flags.ts` |
| Modified | `src/libs/SMS.ts` |
| Modified | `src/libs/ownerAssistant/registry.test.ts` |
| Modified | `src/libs/ownerAssistant/registry.ts` |
| Modified | `src/libs/ownerNavigation.test.ts` |
| Modified | `tests/browser/booking-theme/main.tsx` |
| Modified | `tests/browser/booking-theme/readability.spec.ts` |
| Modified | `tests/browser/ownerNavigation/owner-navigation.spec.ts` |
| Modified | `tests/browser/ownerNavigation/sms-credit-navigation.spec.ts` |
| Modified | `tests/browser/ownerPortfolio/portfolio.spec.ts` |
| Modified | `tests/browser/ownerSecondary/owner-secondary.spec.ts` |
| Modified | `tests/browser/ownerSettingsPlan/settings-plan.spec.ts` |

## Delivery state

- Branch: `codex/product-cleanup`, based on `origin/main` `73d1b9b8daceb10c8c71f35e7eaad5760e515130`.
- Original checkout and its user-owned untracked audit artifacts are preserved.
- Open no-show PR #449 has **no changed-file overlap** with this cleanup; its worktree remains untouched.
- Code, regression manifest, report and four synthetic visual artifacts are prepared for a separate draft pull request.
- Hosted preview and required remote CI are release gates, not claims of this local verification. No automatic merge or deployment; no production billing/data change.

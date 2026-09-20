# Owner client profile refinement

## Scope and hierarchy

The salon-side Clients profile is an operational client card, not a customer account. The existing six desktop sections are available consistently on phones: Overview, Appointments, Messages & activity, Preferences, Payments, and Notes & photos. A compact identity header and status-aware action lead; communication evidence and rare client controls use progressive disclosure.

The previous mobile Activity section combined appointment history, payments, and communications. Contact actions and review suppression occupied every section, while Overview led with financial tiles and repeated cached visit information. The refinement separates those tasks without introducing new appointment, checkout, messaging, rewards, or customer identity systems.

## Authority

Current means explicitly in progress. Future pending requests and payment holds retain their statuses. Past-ended unresolved appointments are not treated as attended, completed, paid, or no-show. Last completed visit uses explicit completion history; a legacy record lacking a completion timestamp remains a completed visit, without claiming its scheduled end was an actual completion time.

The API exposes current work and payment holds previously omitted from the profile preview. Its independent confirmed-booking check prevents a capped preview dominated by holds/current work from falsely describing the client as unbooked. Existing history limits remain: five current/upcoming preview records, twenty completed visits, twenty recent issue records, and twenty-four photos.

Financial calculations are unchanged. Paid service value is settled service value in the reporting currency, not scheduled revenue, collected cash, tax, or tips. Unresolved provenance, currency exclusions, deposits, refunds, and receipt/checkout authority remain intact.

The optional Next Visit Offer projection is read-only. It uses terminal-client lineage and the existing offer engine's current promotion visibility checks. It exposes terms/deadline only, never tokens or a booking capability. Reading the profile does not issue an offer, mint a campaign link, or send anything. Existing offers' redemption rules remain unchanged, including historical entitlements when an owner disables promotion visibility. An unavailable read is not represented as proof that no offer exists. Rebooking and the Rebooking Prompt do not imply a discount.

## Existing workflows and permissions

Appointment rows open the existing appointment management sheet. Rebook uses the existing current-catalogue booking preparation and explicit offer-link action. Communication actions use a future pending/confirmed target independently of the current-appointment primary action. Messages keep provider-backed delivery states; review suppression has one canonical editor under Client controls.

Private salon notes remain private. Submitted preferences remain distinct from staff-maintained preferences and do not override appointment selections. No note revision history or standalone photo upload is invented. Photos retain appointment association and the established appointment workflow.

Admin identity, tenant resolution, merged-client lineage, nondisclosing errors, optimistic edit versions, and private/no-store responses are retained. The separate staff endpoint and visibility rules are not widened.

## Release safeguards

No database migration, automation activation, customer account, AI write action, or billing activation. Existing salons retain their settings. All action testing uses synthetic data and non-sending providers. Production inspection is read-only; no real client, appointment, message, payment, review request, or offer is created or changed for validation.

Release only from protected main after independent review and exact-head CI. Verify Production SHA/health/schema and unchanged settings/billing-dark state, then inspect the rendered Isla profile without saving or invoking sending/rebooking actions. Browser coverage exercises real profile components in Chromium/WebKit, narrow phones, enlarged text, keyboard navigation, and existing appointment/rebook handoffs.

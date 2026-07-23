# Responsive Client Workspace Checkpoint

**Status:** implementation checkpoint
**Roadmap placement:** the responsive client workspace is being pulled forward ahead of Client Insights. The existing Client Insights phase remains deferred.

## Verified current architecture

- `ClientsModal.tsx` owns the paginated Clients directory and a nested, full-screen `ClientDetail`.
- `GET/PATCH /api/admin/clients/[id]` owns the owner-facing profile record, bounded appointment history, appointment photos, and editable salon-managed preferences.
- `ClientCommunicationActions.tsx` owns native Call/Text flows, retention messaging, reminders, review requests, promotions, and recorded communication history.
- `useAppointmentActions`, `AppointmentQuickEditSheet`, `CheckoutSheet`, and `NewAppointmentModal` own appointment management, checkout, receipts, and safe booking prefill.
- `GET/PUT /api/admin/clients/[id]/flag` owns problem flags and booking blocks. The UI and route enforce the existing `clientFlags` and `clientBlocking` module gates.
- `salon_client` stores owner-managed notes, sensitivities, nail preferences, tags, preferred technician, rebooking settings, loyalty points, and cached legacy client statistics.
- `client_preferences` separately stores client-submitted style and salon-experience preferences. It remains read-only in the owner profile.
- `appointment`, `appointment_services`, `appointment_add_on`, `appointment_final_item`, and `appointment_payment` contain the bounded financial and service history needed by this checkpoint.

All owner profile routes resolve the authorized salon with `requireAdminSalon`. The separate staff profile, its visibility policy, and its redaction rules are not changed.

## Capability preservation map

| Existing capability | Location after this checkpoint |
|---|---|
| Search, sorting, pagination, selected-client deep link | Clients directory, unchanged |
| Name, phone, email, tags, client since | Overview |
| Book for client | Sticky/header **Book** action |
| Native call and recorded text drafts | Sticky/header **Call** and **Text** actions |
| Reminder, appointment details, directions, satisfaction, rebooking text, review request, promotions | **More** communication actions |
| Communication history | Activity |
| Next/last appointment and completed visits | Overview |
| Lifetime completed value, month-to-date completed value, completed outstanding | Overview using the shared reporting definitions |
| Upcoming, completed, cancelled, and no-show appointments | Appointments; grouped inside Activity on mobile |
| Manage, cancel, checkout, receipt, reminder, and rebook actions | Existing shared appointment sheets |
| Book-again prefill | Existing booking modal; client, base service, and technician only |
| Owner-managed preferred technician, sensitivities, nail preferences, tags, rebook interval | Preferences, editable through the existing PATCH route |
| Client-submitted preferences | Preferences, clearly labelled read-only data |
| Payment value, tax, tips, discounts, recorded payments, and remaining completed balance | Payments, read-only; mutations stay in Checkout |
| Internal notes | Notes & Photos, mutable current note only |
| Appointment photos | Notes & Photos gallery using existing storage and links |
| Loyalty points and Google review status/actions | Overview and More actions |
| Problem-client flag and booking block | Overview alert plus permission-gated status controls |

No existing capability is deleted or moved to a new database model.

## Financial definitions

- **Lifetime spend:** completed, non-deleted, non-complimentary appointment service and add-on value after discounts and before tax/tips. Paid, partially paid, and unpaid completed appointments are included.
- **Spend this month:** the same completed-value definition within the salon-local month-to-date range.
- **Completed outstanding:** the independently clamped unpaid remainder for each eligible completed appointment after positive, non-void payments.
- **Payments received:** actual positive, non-void payment records displayed separately.
- Finalized financial snapshots are authoritative. Usable booked totals are an explicit legacy fallback. Unusable eligible rows are unresolved.
- Cached `salon_client.totalSpent` remains in the response for compatibility, but is not the redesigned Lifetime spend display source.

## Responsive information architecture

Desktop uses Overview, Activity, Appointments, Preferences, Payments, and Notes & Photos.

Mobile uses:

- **Overview**
- **Activity** — communications, appointments, and payments
- **Details** — preferences, notes, and photos

Activity groups existing records. It does not create a unified event stream, fabricate note history, or add a timeline endpoint.

## Explicit deferrals

- Client Insights and client-directory segments
- Unified timeline, audit-event feed, and cursor endpoint
- Service-photo management
- Rewards or Reviews redesign
- Preference-model consolidation or dual writes
- Refund, deposit-due, inventory, consultation, expense, and profit systems
- Database migrations or indexes

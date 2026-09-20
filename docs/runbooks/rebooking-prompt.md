# Rebooking Prompt

## Separate from promotions

More → Marketing & Messages → Rebooking Prompt controls the customer-visible post-visit encouragement. It does not enable Next Visit Offer, create a discount, issue an entitlement, or send SMS/email. Next Visit Offer remains independently OFF unless an owner deliberately enables it.

The setting is `salon.settings.rebookingPrompt.enabled`. Missing or malformed values mean OFF. New salon creation writes explicit ON; updating or claiming an existing salon preserves its current value (including absence). No schema migration or backfill is required. Existing salons therefore keep their current receipt behavior until they enable the prompt.

## Customer experience

The private appointment manage/receipt page renders the prompt only for a nondeleted appointment with status `completed` and an explicit `completedAt`. It appears after the receipt totals and before calendar utilities. Scheduled time alone never qualifies a visit. Normal copy is:

> Ready to book your next visit?
> Book something similar or choose a different service.

Actions: **Book next appointment** and **Not now**. When Next Visit Offer is currently enabled and the completed visit has a usable issued offer, the server supplies its immutable discount/deadline terms. The UI formats those terms; it does not determine eligibility or compute a discount. Existing #282 offer presentation remains in place when the separate prompt is OFF.

The link is prepared only after the customer presses Book next appointment. Every request revalidates the private capability, completion state and offer. Unavailable offers fall back to normal booking; normal booking revalidates again before confirmation. This feature does not create appointments.

## Fresh booking, not a clone

The customer starts at normal service selection. No historical service, option, removal, add-on, price, technician, contact, or discount is copied. This intentionally avoids implying that a previous nail condition or temporary extra still applies. Current catalogue, L1, technician and availability authority remain unchanged. If a prior service or technician no longer exists, the normal current choices are available without a broken historical selection.

An eligible offer is carried using the existing opaque campaign capability. No customer account is required. Existing owner Rebook Client is unchanged. Customer AI may explain the verified offer; it cannot look up previous appointment history from chat or infer that ordinary rebooking earns a discount.

## Suppression

Dismissal or successfully opening a rebooking suppresses the expanded encouragement for that completed visit in the same browser. A stable opaque hash identifies the visit in localStorage; no access token, contact details or appointment content is stored. The plain Book next appointment action remains available. Renewing the private access link for the same visit does not reset suppression. Cancellation of a future booking does not restart the prompt.

This is device/browser-local, not account-wide. Clearing browser storage or using another browser may show it again. When storage is unavailable, suppression lasts for the current page session. No scheduler or outbound campaign is added. Existing durable booking recovery storage is not cleared or modified.

## Verification and rollout

Use synthetic appointments and mocked/non-sending providers for enabled workflows. Verify explicit-completion-only visibility; missing/disabled settings; authoritative offer/no-offer/expiry; fresh normal service handoff; dismissal and refresh; stale requests and double clicks; tenant denial; new-salon defaults versus existing-salon resume; key-only settings updates; mobile Chromium/WebKit at 320px and doubled text.

Release through normal reviewed PR/CI and protected main. No Production data migration or feature activation is required. Verify health/schema and inspect Isla's owner setting without saving; both Rebooking Prompt and Next Visit Offer must remain OFF for the existing pilot unless the owner has separately changed them.

To inspect safely as owner, open the setting's **What clients see** preview without saving. To try the actual customer flow later, explicitly enable only Rebooking Prompt and open an existing completed appointment's private manage link. Do not complete a real appointment just for testing, and stop before submitting a new booking. Next Visit Offer can remain OFF throughout.

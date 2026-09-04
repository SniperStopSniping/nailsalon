# Quick Book owner follow-up

This patch preserves the existing booking engine and canonical saved data.

- Service-library Done now completes menu review; there is no second Use these services action. Empty menus remain invalid, add-ons remain optional, and focus moves to Clients.
- Generate suggestion fills the editable short introduction using the existing wording helper. It does not create a second bio or promote example placeholders into real owner data, and respects the owner-name visibility choice.
- Private previews recognize an authorized unpublished owner regardless of the legacy Free Solo flag. Legacy route admission for capability links/payment returns is unchanged. Publishing the salon refreshes the iframe revision.
- Exact-address search uses Photon/OpenStreetMap, with a 650 ms debounce, four-character minimum, five-result limit, cancellation and an eight-second timeout. Selection fills the same city/exact-address fields and never changes privacy. Manual entry remains available; owners should check the result and add their unit/suite.
- The customer Quick Book bottom map uses only the existing public-safe location projection, never raw owner address or provider coordinates.

## Address provider limits

The [Photon public service](https://github.com/komoot/photon#demo-server) permits reasonable-volume use but offers no availability guarantee and may throttle extensive traffic. This is a low-volume setup convenience, not address validation. Requests omit app cookies and referrers; only typed address/city search text goes to the provider. Results are attributed to OpenStreetMap. No API key, account, billing, or production secret was added.

For sustained higher-volume onboarding, configure a supported hosted geocoder or a private Photon instance. Google Places requires a restricted key and billing-enabled project; Google address autocomplete is not enabled by this patch. The bottom Google Maps embed is independent of the address-search provider.

## Verification

- Focused service-menu/bio browser journeys cover 320×568, 375×667, 390×844 and 430×932, including editing and reload persistence.
- Address browser coverage exercises keyboard and touch selection, provider failure/manual continuation, stale responses and saved privacy in Chromium and WebKit at 320×568 and 390×844. Provider responses are intercepted; one public-address Photon request separately verified real browser connectivity.
- A guarded disposable-PostgreSQL browser regression covers an unpublished non-Free-Solo owner's embedded/full preview, separate layout publication, salon publication, iframe revision refresh and anonymous publication boundary in headed Chromium and WebKit.
- Unit coverage includes exact-owner/wrong-owner preview authorization, hidden/missing map compaction, private-address redaction, service/add-on persistence and editable generated introduction.
- No production salon data, booking records, payment accounts or database schema are modified by the verification.

# Approved Quick Book compositions

Only Compact Dropdown, Side Portrait and Hero Banner adopt the visual direction from prototype commit `5d16fbfebae74871ac8a1fcfa2a05cc32a300aa4`, based on PR #351 (`d7b2b3346566d879e0f9188b671368e1ffc9df6e`).

The shared customer header mounts the same compositions in the actual onboarding preview and public booking client. Newsreader/Inter fonts are self-hosted copies of the approved prototype assets. Container breakpoints follow the customer viewport inside the chooser. The public service engine retains its handlers, filters, selection, add-ons and Continue flow; scoped presentation hooks provide mobile rows and tablet/desktop cards.

Primary facts retain the prototype priority: location, hours, real permitted reviews, new-client status. Compact selects at most three; the other two select at most four. Booking method and overflow facts remain in the secondary disclosure. Zero facts render no region; one/two/three/four form complete compositions; long values become full-width rows. No fields are fetched or exposed by these components.

All seventeen other selectable layouts and both retired persisted IDs retain their renderers. The source comparison against PR #351 matched all nineteen across normal, long-name and missing-media fixtures (57 comparisons). The chooser retains three recommendations, twenty new choices and all twenty-two persisted IDs. No migration, tenant-record write, booking-rule change or appointment/message submission is included.

Local validation includes the full onboarding unit suite, affected public renderer tests, both builds, scoped lint, Chromium/WebKit responsive fact/media/service checks and actual chooser/preview checks. Browser fixtures use existing public renderer components with synthetic data; they do not access the database. The new customer-composition browser suite runs in the existing CI browser job.

Production verification must distinguish unchanged live salon records from browser-only fixture renders of the deployed customer bundle. The current live Isla page has a saved Editorial selection, which is deliberately preserved. Layout saving/reopening is exercised with local fixture state; no production salon selection is changed during verification.

# Customer assistant component-browser screenshots

The mobile screenshots in this directory are produced by `tests/browser/customerAssistant` using the real launcher component in a Vite fixture. The fixture intercepts every assistant request with a synthetic catalogue and cannot contact a Next server, database, model, delivery provider, or payment service.

They document the read-only proposal shell and manual escape only; they are not full end-to-end booking evidence.

The scheduling screenshots add explicit service acceptance, natural-language date entry, synthetic available times, stale-slot alternatives and an unreserved selected time. API responses remain intercepted; live authority/parity and concurrency are verified separately in server tests. These screenshots do not show contact collection, a final booking review, an appointment or payment.

## Contact and review preparation

The `*-review-*` images exercise deterministic contact and incomplete-review controls with synthetic intercepted API responses. The 390px/100% and 320px/200% Chromium/WebKit fixtures verify form submission, contact exclusion from chat/storage, estimate and unreserved-state wording, edited-review invalidation, and manual exit. They do not demonstrate appointment creation, a final authoritative quote, reminder consent, deposits or payment completion. `*-review-price-*` captures the estimate section inside the scrollable dialog.

## Shared L1 authority verification

The `actual-backend-{legacy,l1}-{chromium,webkit}-confirmed.png` images come from `backendJourney.integration.test.ts`: the actual customer handlers and appointment creator run against positively attested disposable PostgreSQL. Only interpretation, rate-limit storage and provider boundaries are stubbed. Both catalog paths complete one synthetic appointment after explicit confirmation. These are not live-model or Production screenshots.

The manual L1 screenshots in `../l1-public-booking/` come from the actual Next application on localhost with the same guarded disposable database. They show a 45-minute service plus an automatic five-minute add-on, optional French, required phone, and default-on reminders. Each mobile run creates exactly one synthetic appointment and cancels it through the ordinary management endpoint. Real messaging/payment credentials are absent.

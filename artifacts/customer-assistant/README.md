# Customer assistant component-browser screenshots

The mobile screenshots in this directory are produced by `tests/browser/customerAssistant` using the real launcher component in a Vite fixture. The fixture intercepts every assistant request with a synthetic catalogue and cannot contact a Next server, database, model, delivery provider, or payment service.

They document the read-only proposal shell and manual escape only; they are not full end-to-end booking evidence.

The scheduling screenshots add explicit service acceptance, natural-language date entry, synthetic available times, stale-slot alternatives and an unreserved selected time. API responses remain intercepted; live authority/parity and concurrency are verified separately in server tests. These screenshots do not show contact collection, a final booking review, an appointment or payment.

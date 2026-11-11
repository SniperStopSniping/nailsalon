# Bulk client messages

Open **Marketing & Messages → Write a message → Message multiple clients**.

- **All clients** selects active clients eligible for promotional SMS.
- **Last visit** selects clients whose latest completed visit was at least the chosen number of calendar weeks ago, in the salon's time zone. The appointment date is used, even if the visit was marked completed later. Cancelled, no-show and deleted appointments do not count. Historical merged profiles are included. Clients without completed visits are excluded from this filter.
- Last-visit audiences always exclude upcoming bookings, even when an older request has its exclusion switch off. All-client messages exclude bookings by default; including them requires a separate review confirmation naming the already-booked recipients. The worker also checks historical merged-profile phone numbers and recorded contact aliases.
- Search, individual checkboxes, **Select all matching**, and **Clear** adjust the audience. Each send supports up to 1,000 selected client records.
- Write a custom message, optionally insert the first-name field or salon booking link, then review each recipient's final text and the total credits. `{{first_name}}`, `{{booking_link}}` and `{{salon_name}}` are filled on the server before review and stored in each recipient's queued message. Missing names use "there". Unknown or unfinished fields block review and sending. Salon attribution and STOP wording use the existing manual SMS template.
- Each mobile number receives one individual message. Blocked, archived, merged-away, invalid-number and opted-out clients are excluded.

`GET /api/admin/messages/bulk` reads the authorized salon's audience. `POST` with `action: preview` does not enqueue. `action: send` validates the reviewed fingerprint and commits every recipient's existing `communication_intent` row in one transaction. A client, message, filter or contact change requires a new review. There is no new schema or provider send path.

The request UUID and immutable payload fingerprint make uncertain HTTP retries observe the original batch, including after credits or setup change. A UUID cannot be reused for a different message or audience. The dispatcher retains consent, STOP, quiet-hours, rate-limit, credit-reservation and provider-outcome controls. Bulk recipients are checked again for changed contacts, blocks, visits and upcoming bookings before the provider call.

The result initially says **Queued**. The owner can refresh actual delivery states; client SMS histories contain the same durable rows. Delivery can be paced over time, and queued bulk texts expire after seven days. Credit estimates do not reserve the whole batch; the existing dispatcher reserves credits for each actual send.

Older queued custom messages with unfilled fields are suppressed before credit reservation and provider contact. They are not silently personalized or resent. Older batches without the explicit already-booked confirmation also exclude clients with upcoming bookings at dispatch.

Verification uses synthetic clients and isolated PGlite, including a stub provider call through the canonical dispatcher. Never send a production campaign as a release test.

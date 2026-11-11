# Bulk client messages

Open **Marketing & Messages → Write a message → Message multiple clients**.

- **All clients** selects active clients eligible for promotional SMS.
- **Last visit** selects clients whose latest completed visit was at least the chosen number of calendar weeks ago, in the salon's time zone. The appointment date is used, even if the visit was marked completed later. Cancelled, no-show and deleted appointments do not count. Historical merged profiles are included. Clients without completed visits are excluded from this filter.
- Upcoming bookings are excluded by default; owners can clear that option.
- Search, individual checkboxes, **Select all matching**, and **Clear** adjust the audience. Each send supports up to 1,000 selected client records.
- Write a custom message, optionally insert the salon booking link, then review the actual recipients, final customer text and credit estimate. Salon attribution and STOP wording use the existing manual SMS template.
- Each mobile number receives one individual message. Blocked, archived, merged-away, invalid-number and opted-out clients are excluded.

`GET /api/admin/messages/bulk` reads the authorized salon's audience. `POST` with `action: preview` does not enqueue. `action: send` validates the reviewed fingerprint and commits every recipient's existing `communication_intent` row in one transaction. A client, message, filter or contact change requires a new review. There is no new schema or provider send path.

The request UUID and immutable payload fingerprint make uncertain HTTP retries observe the original batch, including after credits or setup change. A UUID cannot be reused for a different message or audience. The dispatcher retains consent, STOP, quiet-hours, rate-limit, credit-reservation and provider-outcome controls. Bulk recipients are checked again for changed contacts, blocks, visits and upcoming bookings before the provider call.

The result initially says **Queued**. The owner can refresh actual delivery states; client SMS histories contain the same durable rows. Delivery can be paced over time, and queued bulk texts expire after seven days. Credit estimates do not reserve the whole batch; the existing dispatcher reserves credits for each actual send.

Verification uses synthetic clients and isolated PGlite, including a stub provider call through the canonical dispatcher. Never send a production campaign as a release test.

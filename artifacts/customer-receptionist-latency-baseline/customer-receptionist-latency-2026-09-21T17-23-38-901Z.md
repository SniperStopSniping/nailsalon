# Customer receptionist live latency baseline

Target: https://www.lustergel.app/isla-nail-studio/book/service. Public session/chat sampling only; no appointment, payment or provider message was created.

Times measure fetch start through response-body parsing, including route processing and network. Browser rendering, server stage timing and provider usage/cost were not exposed. Rate-limited responses are excluded from latency quantiles and counted separately. Non-rate-limited failures remain in the latency sample because they were part of the customer experience. The small sample sizes are exploratory; p95 is the maximum for these samples. The deployed source SHA was not exposed by inspected deployment metadata.

| Scenario | Non-rate-limited samples | p50 ms | p95 ms | Max ms | Rate limited | Last result | Last reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| welcome_book_action_current_label | 2 | 4564 | 5482 | 5482 | 1 | unavailable | unavailable |
| price_question | 2 | 3758 | 6213 | 6213 | 1 | answer | — |
| recommendation | 2 | 5903 | 6513 | 6513 | 1 | answer | — |
| unsupported_hard_gel | 2 | 4102 | 6539 | 6539 | 1 | unavailable | unsupported_service |
| unsupported_acrylic | 2 | 5253 | 5353 | 5353 | 1 | unavailable | unsupported_service |
| length_and_design_consultation | 1 | 6220 | 6220 | 6220 | 2 | proposal | — |
| availability_intent | 1 | 6554 | 6554 | 6554 | 2 | clarification | — |

Raw observations are in the adjacent JSON file.

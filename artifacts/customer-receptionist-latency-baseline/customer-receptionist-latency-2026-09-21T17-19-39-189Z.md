# Customer receptionist live latency baseline

Target: https://www.lustergel.app/isla-nail-studio/book/service. Public session/chat sampling only; no appointment, payment or provider message was created.

Times measure fetch start through response-body parsing, including route processing and network. Browser rendering, server stage timing and provider usage/cost were not exposed. Rate-limited responses are excluded from latency quantiles and counted separately. Non-rate-limited failures remain in the latency sample because they were part of the customer experience. The small sample sizes are exploratory; p95 is the maximum for these samples. The deployed source SHA was not exposed by inspected deployment metadata.

| Scenario | Non-rate-limited samples | p50 ms | p95 ms | Max ms | Rate limited | Last result | Last reason |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| welcome_book_action_current_label | 1 | 5456 | 5456 | 5456 | 0 | unavailable | unavailable |
| price_question | 1 | 5959 | 5959 | 5959 | 0 | answer | — |
| recommendation | 1 | 6259 | 6259 | 6259 | 0 | answer | — |
| unsupported_hard_gel | 1 | 9616 | 9616 | 9616 | 0 | unavailable | unsupported_service |
| unsupported_acrylic | 1 | 5318 | 5318 | 5318 | 0 | unavailable | unsupported_service |
| length_and_design_consultation | 1 | 8069 | 8069 | 8069 | 0 | proposal | — |
| availability_intent | 1 | 6123 | 6123 | 6123 | 0 | clarification | — |

Raw observations are in the adjacent JSON file.

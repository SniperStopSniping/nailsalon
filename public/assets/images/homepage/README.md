# Homepage product previews

Captured on November 8, 2026 from the real product components at base commit
`7df39415`, using the repository's isolated browser fixtures. No reference
image, generated interface, private customer record, or live API is used.

- `booking-page.webp`: Isla public presentation, approved logo and existing
  public nail photograph, with a selected sample service and the real booking CTA.
- `services.webp`: Isla service selector with fixture services/prices.
- `available-time.webp`: current BookTimeClient, synthetic availability.
- `calendar.webp`: current ScheduleCalendarModal weekly view, with explicitly
  synthetic clients A/B/C, sample services, and a fixed November 10 date.
- `booking-policy.webp`: actual customer booking policy dialog with sample policy
  text. This is an example of configurable rules, not a claim about Isla's live terms.

Isla's approved photography and cream/gold identity are preserved (see
`public/isla/README.md`). These captures intentionally differ from the generated
reference's invented pink phone UI. Calendar and policy examples are not evidence
of live provider delivery. French pages label these English app screenshots.

To regenerate, run the booking-theme Vite fixture (port 3138) and homepage Vite
fixture (port 3191), then `node tests/browser/homepage/capture-assets.mjs`.
Next Image optimizes WebP sources; only the first phone image is prioritized.

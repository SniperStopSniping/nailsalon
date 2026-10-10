# Dashboard startup loading

Owner tools now download when opened. Today, salon resolution, permissions, SMS balance, dashboard data, the navigation controller and assistant conversation state remain eager. The change adds no dependencies and does not change authentication, appointment, payment, credit or salon authority logic.

## Loading and recovery

- AppModal keeps its existing shell, body lock, focus handling and Back lifecycle while the content downloads. Each sheet has an accessible name even when its content owns the visible heading.
- Standalone dialogs mount on first open and retain their existing closed-state lifecycle thereafter. Assistant drafts and in-flight responses are preserved.
- Loading always exposes Back. A failed module displays Back and Reload app instead of stranding the owner.
- The assistant scroll anchor responds when its portal actually mounts, so deferred restored conversations open at their newest message.
- Context is supplied by the existing SalonProvider; no new global data cache is introduced.

## Regression coverage

- 1,089 dashboard tests in 100 files passed; 101 focused cases passed again after the final assistant scroll change.
- 10 Chromium/WebKit startup cases cover absent closed-tool requests, delayed and failed modules, Back/forward/reload, focus restoration, changing salons during a download, New Appointment and Walk-in.
- 32 assistant browser cases cover 320px, 390px, WebKit and desktop: closed-sheet requests, saved drafts, long-history scrolling, failed request recovery and owner isolation.
- The new startup suite runs in the existing hosted onboarding-owner browser job and aggregate gate.

## Reproducible size comparison

Same dependencies and production build settings, baseline main `58f2d05c8060cfa31956e64b4b483f6322487a66`. Sum the unique JavaScript files listed by `.next/app-build-manifest.json` for `/layout`, `/[locale]/layout`, `/[locale]/admin/layout` and `/[locale]/admin/page`. For gzip, compress each file using Node zlib's default gzip settings.

| Initial route/layout assets | Before | After |
| --- | ---: | ---: |
| JavaScript files | 37 | 28 |
| Uncompressed bytes | 2,855,129 | 1,346,680 |
| Gzip bytes | 739,211 | 389,924 |

Initial gzip JavaScript is 47.3% smaller. This is a build measurement, not a field Core Web Vitals result or a promise about Lighthouse scores. Opening a tool for the first time incurs its deferred request; loading and failure recovery are covered explicitly. Hosted Preview and production measurements belong in the release evidence.

# HTTPS custom-interaction compatibility

Source parent: `2357cb569bf7c82671446ac71e026cf61fc56558`.

The additional renderer gate reproduced a WebKit failure that the previous
26-job CI did not cover: the opaque HTTPS frame rendered business content, but
its blob worker stopped with an interaction error. Hostile-source diagnostics
stayed at Waiting and runaway-worker checks received error rather than watchdog.
The same two failures reproduced against the public hosted Preview renderer with
synthetic, unsigned-in parent pages. No Production request or model call occurred.

The runtime now creates a UTF-8/base64 data worker. Its origin remains opaque;
network/import, storage, nested-worker, booking and canonical-binding restrictions
remain. CSP permits only the hashed trusted boot for document scripts and data
workers; blob scripts and eval are not enabled. This changes the platform runtime,
not any saved AI-generated HTML, CSS, source revision or business configuration.

Two committed HTTPS browser regressions failed against the original runtime.
After the fix, all18 cases pass across desktop Chromium, phone Chromium and phone
WebKit, including hostile code, watchdog termination, Unicode source, pointer/
keyboard navigation and exact parent-origin rejection. All27 existing renderer
cases also pass across their three profiles: preserved Canva pixels, mixed image
ratios, clickable contacts, canonical service areas, fonts and isolation. These
are synthetic security/rendering fixtures, not new AI-generated designs or a
claim of an actual Production deployment.

The six focused renderer unit files pass24/24; the five workflow/font/origin
contract files pass43/43. Full TypeScript, scoped ESLint and whitespace checks
pass. CI now requires the self-contained HTTPS renderer matrix in its existing
onboarding-owner group, with no database, provider credentials or outbound calls.
Its workflow inventory guard was extended for that required step; no existing
gate, assertion or browser profile was removed. Initial contract/lint failures
were corrected before these passing results. Exact new-head CI and hosted
renderer acceptance remain required before calling the change released.

Separately, the existing dedicated renderer project received only a non-secret
Production parent setting for `https://www.lustergel.app`. The test renderer's
body/CSP stayed identical, with no cookies or provider/database configuration.
No Production deployment was made. A future Production deployment must use
qualified protected-main source and skip automatic domain assignment, preserving
the existing test alias while assigning a distinct Production alias explicitly.

All local test processes were stopped or completed; no appointment, payment,
message, model call, generated source or live salon data was changed. The initial
clean-environment browser lookup needed the already-installed browser-cache path;
no browser or application package was installed. Private raw traces/logs are
retained outside Git. [Sanitized proof](proof.json).

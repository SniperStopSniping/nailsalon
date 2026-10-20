# Frame sessions: hosted observations and remaining diagnostic gap

Runtime0602dd19f55f2a97577c9ef36b30d8aaa3696c12 is READY Preview deployment
dpl_HEeWvH3VwCcBwbaGuoHMoCxYccue on https://luster-ai-builder-test.vercel.app.
The project, deployment, alias and runtime SHA were checked. This includes frame
implementation2026f8e5; the isolated renderer remains on0e65facb. No Production
deployment, environment write, package change or additional AI call occurred.

## Observed successful cases

In the already authenticated independent in-app test browser, the owner resumed
Cobalt's saved draft116 and opened Preview. The custom source loaded without the
Reload control. Its real draft service values and contact bindings appeared.
Clicking its booking button reported **Booking is disabled in this private
preview**. [Owner first load](owner-first-load.png),
[private booking blocked](private-booking-disabled.png).

A fresh tab in that browser opened the published Paper Nail Studio Canva page.
The initial loading state resolved without using Reload. The page showed the
original image, CAD55 /60min service, current hours and correct contact links.
At390×844, both outer and frame scroll widths were390; the1200×480 image rendered
at390×156. [Desktop](public-desktop.png), [mobile](public-mobile.png).
The phone screenshot captures the actual390×844 content rectangle, excluding
unused space in the browser's screenshot surface; the artwork was not edited.

Read-only SQL rechecked the earlier manual publication/booking proof: exactly one
finalized revision5 publication and one confirmed CAD55 /60min appointment,
matching canonical service/staff identities and the10-minute buffer. All31 prior
appointments and compared prior rows remain unchanged. The full service address
is retained in the canonical private primary-location record, while the public
salon address is null. There were no new publications, appointments or model calls
in this rendering check. See the separate
[complete manual owner/customer journey](../manual-canva-owner-checkpoint/README.md).

## Failure retained; no universal fix claim

The instrumented Chrome owner's first load still stalled after the frame change.
[Affected Chrome capture](affected-chrome.png). Attempting the documented raw
network diagnostic returned: `Raw CDP is unavailable while Browser Use is
resolving a paused document response.` The command did not enable tracing. No
pause, browser protection, sandbox or CSP was bypassed. A direct native Chrome
check could not run because the Mac was locked; no further unlock action was attempted.

An unauthenticated HTTP request for the renderer returned200 HTML with a CSP
allowing only the test app as frame ancestor. This establishes document access
and ancestor configuration, not the root cause of the instrumented Chrome stall.
The independent browser success does not qualify every Chrome/phone case.
The first-load investigation and physical/uninstrumented browser acceptance remain
open. [Safe observed facts](proof.json).

## Source and test qualification

The frame implementation creates the first iframe after hydration and replaces
the actual iframe/session for changed saved data. It retains opaque-origin
isolation, channel/window checks, private-photo authorization, blocked private
booking and the original public booking fallback.

Thirteen local bridge/hydration tests, scoped types and changed-file lint passed.
CI39343397350 exposed a compatibility problem in the new test's direct comparison
of a retired JSDOM Window: the older matcher accessed its closed location getter.
The test now checks `Object.is(newWindow, oldWindow) === false`, preserving the
same identity requirement without traversing a closed Window. All13 tests pass
locally after that correction. No application behavior, assertion, test count,
timeout or required gate was removed to obtain that result.

That CI attempt is not green: its failed case and logs remain recorded. The next
full run must validate the corrected test on the hosted dependency graph, alongside
the separate Storybook/installed-Webpack compatibility gate and remaining release
checks. PR461 stays Draft and Production stays NO-GO.

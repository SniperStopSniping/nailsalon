# Manage a booking securely

Feature IDs: F016, F017
Audience: Salon owner; customer view is shown at the explicitly labelled handoff.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Sarah Morgan → Appointments → View appointment → Send details → Not sent → secure customer link → Choose a new time → Confirm new time → saved visit

Verification scope: Actual owner-prepared secure link and guest reschedule; independent authorized read-back. Native message handoff is acknowledged Not sent; no message sent. Secure token omitted.
Export: 25.2 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Find the booked visit | Clients can manage a visit through a secure link. | 4 real taps; stable phone scale |
| 4.20–8.40s | Prepare their secure link | Luster prepares the details; this demo sends no message. | 3 real taps; stable phone scale |
| 8.40–12.60s | Client chooses a new time | Now showing the customer’s secure appointment link. | 1 real taps; stable phone scale |
| 12.60–16.80s | Choose a date and time | The existing service and technician stay together. | 2 real taps; stable phone scale |
| 16.80–21.00s | Confirm the new time | The saved visit moves without creating another booking. | 1 real taps; stable phone scale |
| 21.00–25.20s | Check the saved appointment | The secure link now shows the saved time. | 1 real taps; stable phone scale |

Expected and verified result: Actual owner-prepared secure link and guest reschedule; independent authorized read-back. Native message handoff is acknowledged Not sent; no message sent. Secure token omitted.
Final benefit statement: The secure link now shows the saved time.

Video: [MP4](../videos/luster-how-to-guest-manage.mp4)
Cover: [PNG](../thumbnails/luster-how-to-guest-manage.png)
Actual capture evidence: [JSON](../verification/guest-manage-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/guest-manage.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

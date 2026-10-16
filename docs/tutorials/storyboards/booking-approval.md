# Choose how bookings are confirmed

Feature IDs: F012
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Services → Booking approval → Booking rules → Booking confirmation → Review each request first → Save booking rules

Verification scope: Actual supported salon-wide approval setting saved. Inactive per-service catalog modes are hidden and preserved.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open booking approval | Choose how new online appointments are confirmed. | 3 real taps; stable phone scale |
| 4.20–8.40s | Choose to review each request | New requests reserve a time while they await approval. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review what will change | Existing appointments keep their current status. | 0 real taps; stable phone scale |
| 12.60–16.80s | Save the approval setting | New online bookings now wait for your review. | 1 real taps; stable phone scale |

Expected and verified result: Actual supported salon-wide approval setting saved. Inactive per-service catalog modes are hidden and preserved.
Final benefit statement: New online bookings now wait for your review.

Video: [MP4](../videos/luster-how-to-booking-approval.mp4)
Cover: [PNG](../thumbnails/luster-how-to-booking-approval.png)
Actual capture evidence: [JSON](../verification/booking-approval-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/booking-approval.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

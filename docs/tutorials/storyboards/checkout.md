# Complete checkout and an invoice

Feature IDs: F052, F053
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Emma Taylor → Appointments → completed-visit checkout → Cash → amount → Review → Complete appointment

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 25.2 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open the client’s visit | Keep checkout linked to the right appointment. | 3 real taps; stable phone scale |
| 4.20–8.40s | Complete the appointment | Review what was performed before finalizing. | 2 real taps; stable phone scale |
| 8.40–12.60s | Record how they paid | Choose Cash for this demonstration payment. | 2 real taps; stable phone scale |
| 12.60–16.80s | Review the final total | Review the items, payment and final balance. | 1 real taps; stable phone scale |
| 16.80–21.00s | Confirm completion | Save the invoice and the recorded payment. | 2 real taps; stable phone scale |
| 21.00–25.20s | Keep the finished record | The saved visit shows its payment and balance. | 0 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: The saved visit shows its payment and balance.

Video: [MP4](../videos/luster-how-to-checkout.mp4)
Cover: [PNG](../thumbnails/luster-how-to-checkout.png)
Actual capture evidence: [JSON](../verification/checkout-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/checkout.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

# Review payment records

Feature IDs: F053
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Emma Taylor → Client profile section: Payments → recorded visit payment → appointment

Verification scope: Existing synthetic cash payment viewed; no new charge or refund.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open the client profile | Keep payments linked to the visit they belong to. | 2 real taps; stable phone scale |
| 4.20–8.40s | Choose Payments | Review deposits, payments and remaining balances. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review the saved payment | This completed visit has a recorded $65 payment. | 0 real taps; stable phone scale |
| 12.60–16.80s | Open the related appointment | Keep the payment and treatment history together. | 1 real taps; stable phone scale |

Expected and verified result: Existing synthetic cash payment viewed; no new charge or refund.
Final benefit statement: Keep the payment and treatment history together.

Video: [MP4](../videos/luster-how-to-payment-records.mp4)
Cover: [PNG](../thumbnails/luster-how-to-payment-records.png)
Actual capture evidence: [JSON](../verification/payment-records-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/payment-records.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

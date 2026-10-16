# Set up booking deposits

Feature IDs: F056, F058
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Payments → Deposits → amount → payment prerequisites → Save deposits

Verification scope: Saved setup only; Stripe is not connected and no deposit was collected.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open deposit settings | Prepare your salon’s fixed booking deposit. | 3 real taps; stable phone scale |
| 4.20–8.40s | Choose the deposit amount | Set the amount clients will see when setup is ready. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review the setup requirements | Connect a ready payment account before enabling deposits. | 0 real taps; stable phone scale |
| 12.60–16.80s | Save your deposit setup | Collection waits until your payment account is ready. | 1 real taps; stable phone scale |

Expected and verified result: Saved setup only; Stripe is not connected and no deposit was collected.
Final benefit statement: Collection waits until your payment account is ready.

Video: [MP4](../videos/luster-how-to-deposit-setup.mp4)
Cover: [PNG](../thumbnails/luster-how-to-deposit-setup.png)
Actual capture evidence: [JSON](../verification/deposit-setup-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/deposit-setup.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

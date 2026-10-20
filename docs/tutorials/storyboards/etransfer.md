# Set e-Transfer instructions

Feature IDs: F054
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Payments → payment methods → synthetic e-Transfer instructions → Save tax and e-Transfer

Verification scope: Synthetic recipient; no bank transfer created or verified.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open payment methods | Give clients clear manual payment instructions. | 3 real taps; stable phone scale |
| 4.20–8.40s | Choose e-Transfer | You confirm the payment when it reaches your bank. | 1 real taps; stable phone scale |
| 8.40–12.60s | Add the recipient details | Use the address clients should send payment to. | 1 real taps; stable phone scale |
| 12.60–16.80s | Save the instructions | Luster never asks for your banking password. | 1 real taps; stable phone scale |

Expected and verified result: Synthetic recipient; no bank transfer created or verified.
Final benefit statement: Luster never asks for your banking password.

Video: [MP4](../videos/luster-how-to-etransfer.mp4)
Cover: [PNG](../thumbnails/luster-how-to-etransfer.png)
Actual capture evidence: [JSON](../verification/etransfer-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/etransfer.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

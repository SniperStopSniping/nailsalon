# Correct a no-show report

Feature IDs: F033
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → No-show records → Correct mistaken no-show → explanation → Confirm correction

Verification scope: Prior deposits and refunds require an explicit review; no automatic refund is demonstrated.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open no-show records | Correct mistakes without erasing client history. | 2 real taps; stable phone scale |
| 4.20–8.40s | Choose the mistaken report | Remove only the report that needs correcting. | 1 real taps; stable phone scale |
| 8.40–12.60s | Explain the correction | Keep a clear reason in your salon’s history. | 1 real taps; stable phone scale |
| 12.60–16.80s | Confirm the correction | This visit no longer contributes to shared risk. | 1 real taps; stable phone scale |

Expected and verified result: Prior deposits and refunds require an explicit review; no automatic refund is demonstrated.
Final benefit statement: This visit no longer contributes to shared risk.

Video: [MP4](../videos/luster-how-to-no-show-correction.mp4)
Cover: [PNG](../thumbnails/luster-how-to-no-show-correction.png)
Actual capture evidence: [JSON](../verification/no-show-correction-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/no-show-correction.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

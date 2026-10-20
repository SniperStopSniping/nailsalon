# Build your menu from service templates

Feature IDs: F008
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Services → Advanced Settings → Library → treatment template → add to menu → saved service

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your service menu | Start with useful treatments, then make them yours. | 1 real taps; stable phone scale |
| 4.20–8.40s | Browse the service library | Choose a treatment your salon actually offers. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review the treatment | Check the suggested name, price and duration. | 1 real taps; stable phone scale |
| 12.60–16.80s | Save it to your menu | Your price and timing remain editable. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Your price and timing remain editable.

Video: [MP4](../videos/luster-how-to-service-library.mp4)
Cover: [PNG](../thumbnails/luster-how-to-service-library.png)
Actual capture evidence: [JSON](../verification/service-library-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/service-library.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

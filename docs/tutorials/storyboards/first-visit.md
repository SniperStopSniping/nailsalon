# Configure a first-visit offer

Feature IDs: F019
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Services → Advanced Settings → Menu display → First-visit offer → Save menu display

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your service settings | Keep introductory offers beside your menu. | 3 real taps; stable phone scale |
| 4.20–8.40s | Choose the first-visit offer | The current offer is 25% for first-time clients. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review the menu choices | Check your offer before making it available. | 0 real taps; stable phone scale |
| 12.60–16.80s | Save the first-visit offer | Eligibility is checked when the client books. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Eligibility is checked when the client books.

Video: [MP4](../videos/luster-how-to-first-visit.mp4)
Cover: [PNG](../thumbnails/luster-how-to-first-visit.png)
Actual capture evidence: [JSON](../verification/first-visit-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/first-visit.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

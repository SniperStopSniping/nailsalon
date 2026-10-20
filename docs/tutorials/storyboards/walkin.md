# Add a walk-in

Feature IDs: F003
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Today → Walk-in → service → available time → client details → Book Walk-in Now

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 21.0 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open Quick Walk-in | Keep walk-in visits in the same appointment calendar. | 1 real taps; stable phone scale |
| 4.20–8.40s | Choose the treatment | Luster uses its duration to find available times. | 2 real taps; stable phone scale |
| 8.40–12.60s | Pick an available time | Reserve a time that fits today’s working hours. | 1 real taps; stable phone scale |
| 12.60–16.80s | Add the client details | Use a clear name and the right contact number. | 2 real taps; stable phone scale |
| 16.80–21.00s | Save the walk-in booking | The visit appears in your salon’s Today view. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: The visit appears in your salon’s Today view.

Video: [MP4](../videos/luster-how-to-walkin.mp4)
Cover: [PNG](../thumbnails/luster-how-to-walkin.png)
Actual capture evidence: [JSON](../verification/walkin-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/walkin.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

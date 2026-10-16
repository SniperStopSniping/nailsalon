# Record confirmed nonattendance

Feature IDs: F033
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Today → upcoming appointment → Details: Show → Mark no-show → confirmed nonattendance reason → Confirm no-show

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 21.0 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open the appointment | The client has confirmed they cannot attend. | 1 real taps; stable phone scale |
| 4.20–8.40s | Choose Mark No-Show | Reporting opens 24 hours before the visit. | 2 real taps; stable phone scale |
| 8.40–12.60s | Select the correct reason | Use confirmed nonattendance before the visit. | 1 real taps; stable phone scale |
| 12.60–16.80s | Confirm the report | Eligible reports update the shared history. | 1 real taps; stable phone scale |
| 16.80–21.00s | Recorded, with safeguards | Private notes stay local; reports can be corrected. | 0 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Private notes stay local; reports can be corrected.

Video: [MP4](../videos/luster-how-to-no-show.mp4)
Cover: [PNG](../thumbnails/luster-how-to-no-show.png)
Actual capture evidence: [JSON](../verification/no-show-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/no-show.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

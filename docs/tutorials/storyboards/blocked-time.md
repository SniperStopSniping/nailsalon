# Block a break in your calendar

Feature IDs: F005
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Calendar → Availability → Block time → day/time/reason → Save

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 21.3 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your calendar | Keep bookings and your availability together. | 1 real taps; stable phone scale |
| 4.20–8.40s | Choose Block Time | Protect breaks without changing existing bookings. | 2 real taps; stable phone scale |
| 8.40–12.90s | Set your break | Choose the day, start time and end time. | 3 real taps; stable phone scale |
| 12.90–17.10s | Add a private label | Clients see unavailable time, not your reason. | 1 real taps; stable phone scale |
| 17.10–21.30s | Save your blocked time | Keep this hour out of online availability. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Keep this hour out of online availability.

Video: [MP4](../videos/luster-how-to-blocked-time.mp4)
Cover: [PNG](../thumbnails/luster-how-to-blocked-time.png)
Actual capture evidence: [JSON](../verification/blocked-time-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/blocked-time.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

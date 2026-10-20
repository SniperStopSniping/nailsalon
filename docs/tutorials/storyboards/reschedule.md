# Move an appointment

Feature IDs: F004
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Sarah Morgan → Appointments → View appointment → Edit / reschedule → new time → Save changes

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Find the appointment | Open the client whose booking needs to move. | 2 real taps; stable phone scale |
| 4.20–8.40s | Open their bookings | Keep past and upcoming appointments together. | 2 real taps; stable phone scale |
| 8.40–12.60s | Choose a new time | Adjust the booking without creating a duplicate. | 2 real taps; stable phone scale |
| 12.60–16.80s | Save the new time | Luster checks availability before saving the move. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Luster checks availability before saving the move.

Video: [MP4](../videos/luster-how-to-reschedule.mp4)
Cover: [PNG](../thumbnails/luster-how-to-reschedule.png)
Actual capture evidence: [JSON](../verification/reschedule-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/reschedule.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

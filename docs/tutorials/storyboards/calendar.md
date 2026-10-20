# Find appointments in your calendar

Feature IDs: F002
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Calendar → Monthly → appointment date → visit → appointment details

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your calendar | See your salon’s bookings in one place. | 1 real taps; stable phone scale |
| 4.20–8.40s | Choose your view | Use Monthly to move between booking dates. | 1 real taps; stable phone scale |
| 8.40–12.60s | Open the appointment day | Check the client, service and appointment time. | 1 real taps; stable phone scale |
| 12.60–16.80s | See the visit details | Open the booking to manage the appointment. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Open the booking to manage the appointment.

Video: [MP4](../videos/luster-how-to-calendar.mp4)
Cover: [PNG](../thumbnails/luster-how-to-calendar.png)
Actual capture evidence: [JSON](../verification/calendar-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/calendar.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

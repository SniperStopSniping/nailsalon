# Add an appointment

Feature IDs: F003
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Today → New Appointment → service → date/time and technician → client details → Create Appointment → View calendar

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 25.2 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Add an appointment | Keep phone and in-person bookings together. | 1 real taps; stable phone scale |
| 4.20–8.40s | Choose a day & time | Reserve the right time for your client. | 3 real taps; stable phone scale |
| 8.40–12.60s | Find your client | Reuse their details instead of typing again. | 3 real taps; stable phone scale |
| 12.60–16.80s | Choose the treatment | The price and appointment length update together. | 1 real taps; stable phone scale |
| 16.80–21.00s | Save the appointment | Check the summary, then create the booking. | 1 real taps; stable phone scale |
| 21.00–25.20s | Review the saved booking | Find the appointment in your calendar. | 3 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Find the appointment in your calendar.

Video: [MP4](../videos/luster-how-to-manual-appointment.mp4)
Cover: [PNG](../thumbnails/luster-how-to-manual-appointment.png)
Actual capture evidence: [JSON](../verification/manual-appointment-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/manual-appointment.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

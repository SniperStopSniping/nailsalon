# Cancel an appointment clearly

Feature IDs: F004
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Nora Evans → Appointments → View appointment → Cancel appointment → confirm

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Find the client’s booking | Keep the cancellation linked to the right visit. | 2 real taps; stable phone scale |
| 4.20–8.40s | Open the appointment | Review the booking before changing its status. | 2 real taps; stable phone scale |
| 8.40–12.60s | Choose Cancel appointment | An ordinary cancellation is separate from a no-show. | 1 real taps; stable phone scale |
| 12.60–16.80s | Confirm the cancellation | The saved cancellation frees the appointment time. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: The saved cancellation frees the appointment time.

Video: [MP4](../videos/luster-how-to-cancel-appointment.mp4)
Cover: [PNG](../thumbnails/luster-how-to-cancel-appointment.png)
Actual capture evidence: [JSON](../verification/cancel-appointment-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/cancel-appointment.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

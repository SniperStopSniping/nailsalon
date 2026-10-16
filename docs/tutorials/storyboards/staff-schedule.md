# Set technician availability

Feature IDs: F059, F060
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Team → Working Hours → Whose schedule? → Monday end time → Save Schedule

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your team | Manage technician hours from your owner account. | 2 real taps; stable phone scale |
| 4.20–8.40s | Choose a technician | Keep each person’s regular schedule separate. | 2 real taps; stable phone scale |
| 8.40–12.60s | Adjust the weekly shift | Available booking times follow this schedule. | 1 real taps; stable phone scale |
| 12.60–16.80s | Save the schedule | Your technician’s working hours are now saved. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Your technician’s working hours are now saved.

Video: [MP4](../videos/luster-how-to-staff-schedule.mp4)
Cover: [PNG](../thumbnails/luster-how-to-staff-schedule.png)
Actual capture evidence: [JSON](../verification/staff-schedule-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/staff-schedule.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

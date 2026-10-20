# Add a client

Feature IDs: F028
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Add → synthetic name and phone → Save client

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 17.2 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your clients | Keep contact details in your own salon directory. | 1 real taps; stable phone scale |
| 4.20–8.40s | Add a new client | Create their profile before their first visit. | 1 real taps; stable phone scale |
| 8.40–13.00s | Enter their details | Reuse contact details for future appointments. | 3 real taps; stable phone scale |
| 13.00–17.20s | Save the client | Keep their details ready for their next appointment. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Keep their details ready for their next appointment.

Video: [MP4](../videos/luster-how-to-add-client.mp4)
Cover: [PNG](../thumbnails/luster-how-to-add-client.png)
Actual capture evidence: [JSON](../verification/add-client-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/add-client.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

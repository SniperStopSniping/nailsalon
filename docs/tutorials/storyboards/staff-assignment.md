# Assign services to technicians

Feature IDs: F011, F059
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Team → Services & Skills → Marie Dupont → treatments → Save Changes

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open Services & Skills | Choose which treatments each technician performs. | 3 real taps; stable phone scale |
| 4.20–8.40s | Choose the technician | Their service list controls booking choices. | 1 real taps; stable phone scale |
| 8.40–12.60s | Update their treatments | Only tick services this technician can perform. | 1 real taps; stable phone scale |
| 12.60–16.80s | Save the service list | Clients see the technician’s enabled treatments. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: Clients see the technician’s enabled treatments.

Video: [MP4](../videos/luster-how-to-staff-assignment.mp4)
Cover: [PNG](../thumbnails/luster-how-to-staff-assignment.png)
Actual capture evidence: [JSON](../verification/staff-assignment-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/staff-assignment.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

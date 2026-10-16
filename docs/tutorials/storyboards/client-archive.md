# Archive an inactive client

Feature IDs: F032
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Emma Taylor → Client controls → More actions → Archive client → review → confirm

Verification scope: Actual synthetic client archive. Completed cash invoice and historical appointment preserved, not deleted.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open the client’s controls | Keep your active client list tidy without deleting history. | 3 real taps; stable phone scale |
| 4.20–8.40s | Choose Archive client | Use archive for a client you no longer manage actively. | 2 real taps; stable phone scale |
| 8.40–12.60s | Review before archiving | Read what will change and what history stays saved. | 0 real taps; stable phone scale |
| 12.60–16.80s | Confirm the archive | Appointments and payment records remain preserved. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic client archive. Completed cash invoice and historical appointment preserved, not deleted.
Final benefit statement: Appointments and payment records remain preserved.

Video: [MP4](../videos/luster-how-to-client-archive.mp4)
Cover: [PNG](../thumbnails/luster-how-to-client-archive.png)
Actual capture evidence: [JSON](../verification/client-archive-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/client-archive.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

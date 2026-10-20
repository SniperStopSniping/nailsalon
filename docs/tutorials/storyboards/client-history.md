# Understand a client’s history

Feature IDs: F028
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Emma Taylor → Overview → Client profile section: Appointments → completed appointment

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your clients | Keep your client relationships in one place. | 1 real taps; stable phone scale |
| 4.20–8.40s | Choose a client | Review their profile before their next appointment. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review past visits | Choose Appointments to see the saved visit history. | 1 real taps; stable phone scale |
| 12.60–16.80s | Keep the full picture | See the treatment, date and recorded payment. | 0 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: See the treatment, date and recorded payment.

Video: [MP4](../videos/luster-how-to-client-history.mp4)
Cover: [PNG](../thumbnails/luster-how-to-client-history.png)
Actual capture evidence: [JSON](../verification/client-history-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/client-history.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

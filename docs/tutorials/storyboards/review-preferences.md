# Respect a client’s review preference

Feature IDs: F046
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Emma Taylor → Client controls → Do not send review requests → saved suppression

Verification scope: Actual per-client suppression saved; no review request sent.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your client’s controls | Respect an individual client’s review preferences. | 3 real taps; stable phone scale |
| 4.20–8.40s | Pause review requests | Skip future review requests for this client. | 1 real taps; stable phone scale |
| 8.40–12.60s | Check the saved preference | A request already sending may still arrive. | 0 real taps; stable phone scale |
| 12.60–16.80s | Keep their history intact | This choice does not remove appointments or payments. | 0 real taps; stable phone scale |

Expected and verified result: Actual per-client suppression saved; no review request sent.
Final benefit statement: This choice does not remove appointments or payments.

Video: [MP4](../videos/luster-how-to-review-preferences.mp4)
Cover: [PNG](../thumbnails/luster-how-to-review-preferences.png)
Actual capture evidence: [JSON](../verification/review-preferences-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/review-preferences.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

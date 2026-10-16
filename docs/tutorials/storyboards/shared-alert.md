# Understand recorded shared history

Feature IDs: F034
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Second authorized demo salon → Clients → Maya Singh → Recorded No-Show History

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your client list | Review recorded history before the next booking. | 1 real taps; stable phone scale |
| 4.20–8.40s | Open the client profile | Participating salons see a limited history count. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review recorded history | Reports cover eligible visits in the last 12 months. | 0 real taps; stable phone scale |
| 12.60–16.80s | You choose how to proceed | This warning does not automatically block a client. | 0 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: This warning does not automatically block a client.

Video: [MP4](../videos/luster-how-to-shared-alert.mp4)
Cover: [PNG](../thumbnails/luster-how-to-shared-alert.png)
Actual capture evidence: [JSON](../verification/shared-alert-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/shared-alert.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

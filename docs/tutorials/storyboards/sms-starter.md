# Claim 100 starter SMS credits

Feature IDs: F066
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Text Message Balance → verification status → Claim 100 free texts → updated balance

Verification scope: Actual isolated 100-credit grant and duplicate no-op. Development owner verification was prepared as a fixture, not delivered by SMS.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your SMS balance | Eligible verified owners can claim 100 starter texts. | 1 real taps; stable phone scale |
| 4.20–8.40s | Check your verification | Both your primary email and phone must be verified. | 0 real taps; stable phone scale |
| 8.40–12.60s | Claim your 100 starter texts | No payment is needed for this one-time allowance. | 1 real taps; stable phone scale |
| 12.60–16.80s | Check the updated balance | Core booking stays free; SMS top-ups are optional. | 0 real taps; stable phone scale |

Expected and verified result: Actual isolated 100-credit grant and duplicate no-op. Development owner verification was prepared as a fixture, not delivered by SMS.
Final benefit statement: Core booking stays free; SMS top-ups are optional.

Video: [MP4](../videos/luster-how-to-sms-starter.mp4)
Cover: [PNG](../thumbnails/luster-how-to-sms-starter.png)
Actual capture evidence: [JSON](../verification/sms-starter-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/sms-starter.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

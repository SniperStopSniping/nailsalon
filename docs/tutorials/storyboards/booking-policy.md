# Explain your booking policy

Feature IDs: F014
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Booking Rules & Policies → Booking policy → wording/acknowledgement → Save booking policy

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your booking policy | Keep your appointment terms in one place. | 3 real taps; stable phone scale |
| 4.20–8.40s | Write clear appointment terms | Help clients know what to expect before booking. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review the acknowledgement | Ask clients to confirm the policy before booking. | 0 real taps; stable phone scale |
| 12.60–16.80s | Save the policy | The saved policy appears in your selected places. | 1 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: The saved policy appears in your selected places.

Video: [MP4](../videos/luster-how-to-booking-policy.mp4)
Cover: [PNG](../thumbnails/luster-how-to-booking-policy.png)
Actual capture evidence: [JSON](../verification/booking-policy-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/booking-policy.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

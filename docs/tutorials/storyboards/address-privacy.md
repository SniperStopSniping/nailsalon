# Control address visibility

Feature IDs: F023
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Booking Page → What Clients See → Location → Show my full address after they book → saved draft

Verification scope: Draft only; no address or customer record deleted.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open What Clients See | Choose how much location detail to show publicly. | 3 real taps; stable phone scale |
| 4.20–8.40s | Open your location display | Your exact address stays saved for appointments. | 1 real taps; stable phone scale |
| 8.40–12.60s | Reveal it after booking | Browsing clients see the city; confirmed clients get details. | 1 real taps; stable phone scale |
| 12.60–16.80s | Review the saved draft | Publish separately to apply this display choice. | 0 real taps; stable phone scale |

Expected and verified result: Draft only; no address or customer record deleted.
Final benefit statement: Publish separately to apply this display choice.

Video: [MP4](../videos/luster-how-to-address-privacy.mp4)
Cover: [PNG](../thumbnails/luster-how-to-address-privacy.png)
Actual capture evidence: [JSON](../verification/address-privacy-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/address-privacy.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

# Show a Smart Fit booking

Feature IDs: F020, F006, F015
Audience: Salon owner; customer view is shown at the explicitly labelled handoff.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Booking Page → Open live site → Gel-X Full Set → qualifying Smart Fit time → details → Confirm appointment

Verification scope: Actual Smart Fit offer selected and saved as a confirmed booking. The separate first-visit offer was turned off through the local owner UI before recording because discounts do not stack. No payment, delivered message.
Export: 29.833 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Show clients a Smart Fit | Offer a discount on qualifying gaps in your schedule. | 2 real taps; stable phone scale |
| 4.20–8.40s | Open the client booking page | Show the real booking choices your clients see. | 1 real taps; stable phone scale |
| 8.40–12.60s | Choose the treatment | Review the service, price and appointment length. | 2 real taps; stable phone scale |
| 12.60–16.80s | Select a qualifying Smart Fit | The available gap shows the saved discount and price. | 2 real taps; stable phone scale |
| 16.80–21.43s | Add contact details | Keep booking details and recovery links together. | 3 real taps; stable phone scale |
| 21.43–25.63s | Review and confirm | Review the discount and any tax before confirming. | 2 real taps; stable phone scale |
| 25.63–29.83s | Your booking is saved | The saved total includes the discount and your tax settings. | 0 real taps; stable phone scale |

Expected and verified result: Actual Smart Fit offer selected and saved as a confirmed booking. The separate first-visit offer was turned off through the local owner UI before recording because discounts do not stack. No payment, delivered message.
Final benefit statement: The saved total includes the discount and your tax settings.

Video: [MP4](../videos/luster-how-to-smart-fit-booking.mp4)
Cover: [PNG](../thumbnails/luster-how-to-smart-fit-booking.png)
Actual capture evidence: [JSON](../verification/smart-fit-booking-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/smart-fit-booking.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

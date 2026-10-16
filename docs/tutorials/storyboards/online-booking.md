# Let clients book online

Feature IDs: F006, F015
Audience: Salon owner; customer view is shown at the explicitly labelled handoff.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Booking Page → Open live site → service → extra → date/time → client details → Confirm appointment

Verification scope: Actual synthetic local UI workflow; no production provider outcome implied.
Export: 34.033 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your booking page | Give clients a clear way to book online. | 2 real taps; stable phone scale |
| 4.20–8.40s | See the client experience | Open the same page your clients use. | 1 real taps; stable phone scale |
| 8.40–12.60s | Choose a treatment | Show the service price and appointment length. | 1 real taps; stable phone scale |
| 12.60–16.80s | Add a little nail art | Reserve extra time for the extras they choose. | 2 real taps; stable phone scale |
| 16.80–21.00s | Choose an available time | Clients select from your live availability. | 2 real taps; stable phone scale |
| 21.00–25.63s | Add contact details | Keep booking details and recovery links together. | 3 real taps; stable phone scale |
| 25.63–29.83s | Review & confirm | Check the service, extras, timing and total. | 2 real taps; stable phone scale |
| 29.83–34.03s | The booking is saved | The visit is now part of your salon’s schedule. | 0 real taps; stable phone scale |

Expected and verified result: Actual synthetic local UI workflow; no production provider outcome implied.
Final benefit statement: The visit is now part of your salon’s schedule.

Video: [MP4](../videos/luster-how-to-online-booking.mp4)
Cover: [PNG](../thumbnails/luster-how-to-online-booking.png)
Actual capture evidence: [JSON](../verification/online-booking-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/online-booking.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

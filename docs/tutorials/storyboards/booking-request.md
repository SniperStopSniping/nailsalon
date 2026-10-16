# Approve an online booking request

Feature IDs: F012, F004
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Clients → Isabel Reed → Appointments → pending visit → review details → Confirm appointment

Verification scope: Actual guest request created through the local booking UI, then approved through the owner UI. No real customer, delivered message or payment.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open the client’s request | Review approval bookings before confirming the visit. | 4 real taps; stable phone scale |
| 4.20–8.40s | Review the appointment details | Check the treatment, technician, time and price. | 0 real taps; stable phone scale |
| 8.40–12.60s | Confirm the booking request | Approve only after you are ready to take the visit. | 1 real taps; stable phone scale |
| 12.60–16.80s | Check the confirmed result | The original request now has a confirmed status. | 0 real taps; stable phone scale |

Expected and verified result: Actual guest request created through the local booking UI, then approved through the owner UI. No real customer, delivered message or payment.
Final benefit statement: The original request now has a confirmed status.

Video: [MP4](../videos/luster-how-to-booking-request.mp4)
Cover: [PNG](../thumbnails/luster-how-to-booking-request.png)
Actual capture evidence: [JSON](../verification/booking-request-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/booking-request.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

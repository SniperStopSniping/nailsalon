# Choose booking notifications

Feature IDs: F042
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Settings → Owner & Staff Alerts → recipient/preferences → Save

Verification scope: Synthetic notification recipient saved; no email or SMS sent.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open Owner & Staff Alerts | Choose which booking updates reach your team. | 3 real taps; stable phone scale |
| 4.20–8.40s | Set your notification address | Keep booking updates in the right inbox. | 1 real taps; stable phone scale |
| 8.40–12.60s | Review the email events | Choose the updates your salon needs to receive. | 0 real taps; stable phone scale |
| 12.60–16.80s | Save the notification settings | Delivery still needs a connected email service. | 1 real taps; stable phone scale |

Expected and verified result: Synthetic notification recipient saved; no email or SMS sent.
Final benefit statement: Delivery still needs a connected email service.

Video: [MP4](../videos/luster-how-to-owner-notifications.mp4)
Cover: [PNG](../thumbnails/luster-how-to-owner-notifications.png)
Actual capture evidence: [JSON](../verification/owner-notifications-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/owner-notifications.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

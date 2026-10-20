# Request a review of a no-show

Feature IDs: F033, F034
Audience: Salon owner; customer view is shown at the explicitly labelled handoff.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → No-show records → customer secure appointment link → Request review of this no-show → explanation → Request review → owner No-show records

Verification scope: Actual secure customer request for review, suspended owner record and second authorized synthetic salon count of zero. No payment, refund, delivered message or external shared report. Secure token omitted.
Export: 22.033 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Review a no-show record | Customers can ask for an incorrect report to be reviewed. | 2 real taps; stable phone scale |
| 4.20–8.40s | Customer opens their link | Now showing the customer’s appointment-management view. | 0 real taps; stable phone scale |
| 8.40–12.60s | Explain what needs review | The explanation stays with authorized reviewers. | 2 real taps; stable phone scale |
| 12.60–16.80s | Submit the review request | The eligible shared contribution is paused during review. | 1 real taps; stable phone scale |
| 16.80–22.03s | Owner sees the paused record | Earlier deposits and payments need a separate review. | 2 real taps; stable phone scale |

Expected and verified result: Actual secure customer request for review, suspended owner record and second authorized synthetic salon count of zero. No payment, refund, delivered message or external shared report. Secure token omitted.
Final benefit statement: Earlier deposits and payments need a separate review.

Video: [MP4](../videos/luster-how-to-no-show-review.mp4)
Cover: [PNG](../thumbnails/luster-how-to-no-show-review.png)
Actual capture evidence: [JSON](../verification/no-show-review-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/no-show-review.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

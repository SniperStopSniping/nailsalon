# Prepare client follow-ups

Feature IDs: F030, F044
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: More → Marketing & Messages → Client follow-ups → due client → Snooze 7 days → saved outreach snooze

Verification scope: One synthetic follow-up snoozed for seven days. No customer message sent.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open Insights & Follow-ups | Find clients who may need a personal follow-up. | 3 real taps; stable phone scale |
| 4.20–8.40s | Review the client’s history | Use the recorded reason to choose your next step. | 0 real taps; stable phone scale |
| 8.40–12.60s | Snooze a follow-up | Move a reminder out of today’s worklist. | 1 real taps; stable phone scale |
| 12.60–16.80s | Keep the worklist focused | Outreach is snoozed; payment warnings stay visible. | 0 real taps; stable phone scale |

Expected and verified result: One synthetic follow-up snoozed for seven days. No customer message sent.
Final benefit statement: Outreach is snoozed; payment warnings stay visible.

Video: [MP4](../videos/luster-how-to-followups.mp4)
Cover: [PNG](../thumbnails/luster-how-to-followups.png)
Actual capture evidence: [JSON](../verification/followups-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/followups.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

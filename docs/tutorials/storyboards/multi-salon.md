# Switch between your salons

Feature IDs: F074
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: Header: Switch salon → authorized salon card → Open dashboard → selected salon workspace

Verification scope: Same development owner authorized at both synthetic salons; their names match and the exact listed salon URL identifies the selection.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your salon switcher | Keep each salon’s workspace separate. | 1 real taps; stable phone scale |
| 4.20–8.40s | Choose your other salon | Open the dashboard for the salon you want to manage. | 1 real taps; stable phone scale |
| 8.40–12.60s | Check the active workspace | The selected salon determines the tools and records. | 1 real taps; stable phone scale |
| 12.60–16.80s | Manage the right salon | Here the team workspace includes technician tools. | 0 real taps; stable phone scale |

Expected and verified result: Same development owner authorized at both synthetic salons; their names match and the exact listed salon URL identifies the selection.
Final benefit statement: Here the team workspace includes technician tools.

Video: [MP4](../videos/luster-how-to-multi-salon.mp4)
Cover: [PNG](../thumbnails/luster-how-to-multi-salon.png)
Actual capture evidence: [JSON](../verification/multi-salon-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/multi-salon.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

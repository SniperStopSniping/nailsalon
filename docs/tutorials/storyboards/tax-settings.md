# Configure invoice taxes

Feature IDs: F055
Audience: Salon owner or authorized salon manager.
Starting screen: the real owner dashboard in an isolated synthetic salon.
Navigation: See recorded actions in the storyboard and capture script.

Verification scope: Synthetic example rate only; no tax advice, charge or historical recalculation.
Export: 16.8 seconds; 1080 × 1920; 30 FPS; silent MP4.

The executable flow script is the pre-recording action plan. The timings below are taken from the final edited recording.

| Time | Instruction | Salon benefit / explanation | Visual emphasis |
|---|---|---|---|
| 0.00–4.20s | Open your tax settings | Keep checkout calculations consistent. | 3 real taps; stable phone scale |
| 4.20–8.40s | Turn on tax for checkout | Use the settings that apply to your business. | 0 real taps; stable phone scale |
| 8.40–12.60s | Enter your tax name and rate | Use your own applicable rate; this is sample data. | 2 real taps; stable phone scale |
| 12.60–16.80s | Save your checkout settings | Completed appointments keep their original tax record. | 1 real taps; stable phone scale |

Expected and verified result: Synthetic example rate only; no tax advice, charge or historical recalculation.
Final benefit statement: Completed appointments keep their original tax record.

Video: [MP4](../videos/luster-how-to-tax-settings.mp4)
Cover: [PNG](../thumbnails/luster-how-to-tax-settings.png)
Actual capture evidence: [JSON](../verification/tax-settings-evidence.json)
Editable action script: [flow](../../../tools/tutorials/flows/tax-settings.mjs)

Production notes: actual local screens; synthetic identities; native touch events drive the hand indicator. Navigation/save waiting intervals are cut with the tap and confirmed result retained. Provider-dependent outcomes are explicitly limited.

# Investigation checkpoints

These reports are retained to show the issues found during implementation. They are **not release acceptance results**.

- 17:41 and 17:44: exploratory harness runs, before availability/state and scoring corrections.
- 17:47: corrected single-pair smoke.
- 17:55: first 20-pair-per-category comparison. It exposed blank reply padding and overly broad deferred question references, which have since been corrected.
- 17:59: blank-padding reproduction.
- Later narrow smokes: verify formatting and identify recommendation guard rejections before the final correction.

The final frozen-code benchmark writes separately so CI can evaluate an immutable source head. Its results and the rendered live release evidence accompany the task's final report. Model timings and token-derived costs are real; database/catalogue/availability resolution in these reports is synthetic. Do not present synthetic resolution as live production timing or treat a correct deterministic package/slot render as a model failure.

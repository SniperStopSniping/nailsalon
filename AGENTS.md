# Repository workflow guardrails

- Start every feature or fix from the latest `origin/main` in its own clean branch and worktree. Keep one task per worktree.
- Check `git status` before editing. Treat existing modifications and untracked files as user-owned; preserve them and stop for direction if the requested work overlaps them.
- Never deploy from a dirty worktree or from an uncommitted local state. Production deployments come only from the protected `main` branch.
- Before starting unrelated work, finish the current delivery path: run the relevant checks, commit the scoped changes, push the branch, verify the preview, and open or update its pull request.
- Merge only after required CI and preview checks pass and all review conversations are resolved. Recheck production after merge against the expected Git SHA.

# Builder Storybook compiler qualification

The prior full CI runs reached the real owner browser suites, then Storybook
startup failed because Next15.5's external-Webpack integration imports
`webpack/lib/RuntimeGlobals`, which moved in the locked Webpack5.112.0 package.
The exact registry tarball and lock integrity were checked read-only before the
correction. This is a compiler compatibility failure, not evidence that the
owner browser assertions failed.

Integrated the coordinated release task's tested commits:

- `c2d7234cf9564b1d5f92b1ce4f32c2faf66e8428` as`a6093885`: directly pin the already
  qualified Webpack5.111.1, use that compiler consistently for both Storybook
  commands, retain the existing security refresh and builder dependencies.
- `a9e0cfe18132ba39ff43a0338865713d9757bc66` as`c5020687`: retain both branches'
  reviewed manifest pairs and add this branch's pair. Structural JSON comparison
  proves its package/lock graph equals the qualified pair except the root release
  metadata1.143.3 versus1.143.2. The negative guard still rejects modified and
  mixed manifests; no wildcard bypass was introduced.

No package was installed or upgraded locally. The worktree retained its existing
qualified dependency directory. That means these local checks use Node22.23.2;
the exact branch's clean-install Node24 CI is still independently required.

## Actual checks

At source`c50206875a2c83589c20747c3fd66cebd33ba15d`:

-22 workflow/guard tests passed, zero failures or skips, including changed/mixed
  manifest rejection.
- The real optimized Storybook build passed, using the installed5.111.1 compiler.
- All6 Chromium Storybook interaction tests across2 suites passed against that
  newly built static output. The temporary127.0.0.1 server was stopped afterward.
- Full PR-owned commit-message validation passed after correcting the two newest
  checkpoint subjects. Their original commits remain in a local checkpoint ref;
  the corrected subjects retain byte-identical application source.
- Secret scan passed5389 tracked files, zero generated files and5 reviewed
  commits. No allowlist change or disabled gate was used.

The first local build attempt failed because the synthetic sign-in URL was
missing and Storybook's directory-only Git discovery followed the shared
node_modules directory rather than this worktree's `.git` file. The successful
retry supplied the normal CI sign-in URL and installed Storybook's supported
`STORYBOOK_PROJECT_ROOT` override, targeting this actual worktree. Neither check
was bypassed. The build/test child environment contained only basic process
paths and approved synthetic provider placeholders; no provider credential,
Preview/Production secret or database connection was supplied.

The build retains Storybook's normal bundle-size warnings. This result proves
local compiler/build/interactions compatibility; it does not replace the full
current-head application, database, authorization and customer-booking CI gates.
Old CI39349089161 remains a failed checkpoint and was not restarted or cancelled
for these corrections. No merge, production deployment, migration, environment
write, purchase, credit grant or provider call was made during this correction.

[Exact versions, hashes and test counts](qualification.json).

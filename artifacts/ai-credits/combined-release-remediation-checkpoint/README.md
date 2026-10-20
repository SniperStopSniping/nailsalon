# Combined builder and reviewed release remediation

This checkpoint integrates the seven donor commits identified by the release
task: deletion recovery/migration0113, held public-media cleanup, wrapped-conflict
handling, keyboard focus, fixture contracts and required browser/native database
coverage. The broad integration commit was not blindly cherry-picked. Its scoped
release/Checkly provenance controls and the exact reviewed package/lock from
`1f2162ac` were reconciled with current builder work.

The reviewed Vitest4/Vite6/npm10.9.9/SWC-helper graph removes the old local
Vitest2 declaration mismatch. Matching mock types and test-isolation adaptations
were retained without removing newer owner tests. Full TypeScript now passes.
The nine-case paid-wallet gate and the previously qualified local Webpack selection
remain intact. No local package installation or removal occurred.

Verification: **108 focused tests**, **39 workflow/provenance contracts**, full
TypeScript, lint across **35 changed source files**, and **8 desktop Chromium/
iPhone-profile WebKit deletion-dialog checks** pass. All builder, AI funding,
Canva and isolated-renderer modules remain byte-identical to `b5adefa2`.
That earlier funding head separately passed all26 CI checks, including its
required9 native PostgreSQL wallet cases; it does not qualify this new combined head.

The declared production-only dependency audit reports **zero advisories**. The
complete toolchain audit still reports141 advisories, including107 high and no
critical; those must not be described as an entirely clean dependency audit.
Affected old Sharp/ws copies are development-tool paths; production declares
Sharp0.35.5 and ws8.21.3. The linked local cache's `npm ls` is unqualified because
it reports missing/extraneous entries. Fresh exact-head CI must pass the installed
graph check; no check was waived or package installed to hide that limitation.

[Proof and donor mapping](proof.json). The combined head still needs full CI and
hosted qualification. No Production application deployment, schema migration or
salon-data change was performed. Ten non-secret Production settings were staged
with all AI/purchase activation switches false; no secret was decrypted. Stripe
and OpenAI sign-in are pending for the remaining live provider setup. These checks
made no new provider generation, real payment or outbound customer message.

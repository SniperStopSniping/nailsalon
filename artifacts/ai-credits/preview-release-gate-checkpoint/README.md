# Preview release gate checkpoint

Candidate inspected: `78d07b23b33de1a4e0e2213635dc5db866741118`, application source `f481debeaea9a1d6adf1352a061f723f4fdf5310`. This checkpoint adds evidence only. No application, provider configuration or hosted data changed.

## Current local checks

The unchanged **Deposits ladder protected surfaces** step from the candidate's actual CI workflow passed against `origin/main` at `8265697f041e1f6e3adc6462dabef8ba3523384c`. No dependency allowlist or guard was relaxed for this check. [Proof](protected-surfaces-proof.json).

The exact Quick Book case that failed on the older remote PR was run three times in iPhone-emulated WebKit, with zero retries: **3 passed, 0 skipped, 0 unexpected, 0 flaky**. Each repetition covers the existing `cover_profile` fixture at 320px and 390px, with zero through five facts and the long/missing/expired/hidden-media scenarios. The older internal WebKit navigation error did not reproduce in this bounded run. This does not establish that all browser or remote CI cases pass. The fixture mocks authentication/data and is not customer-booking or provider proof. [Browser proof](quick-book-proof.json).

The first local invocation selected zero tests because an anchored title filter omitted Playwright's full-title prefix; it failed and was retained privately. Only the temporary runner's filter was corrected. No application or committed test source changed. All owned browser/Vite/proxy listeners were stopped after completion.

The separately completed [combined local application checkpoint](../combined-local-candidate-checkpoint/README.md) includes real Development sign-in, private draft/public isolation, server authorization checks and a genuine synthetic customer booking through the original Luster flow. It is not replaced by this fixture result. No new model calls, purchases or appointments were made during this metadata/browser phase.

## Hosted state inspected without writes

The Vercel project remains Git-linked to `SniperStopSniping/nailsalon`, with protected `main` as its Production branch and Node 24.x. No ignore-build command or repository branch-deployment override is configured. [Vercel's documented default](https://vercel.com/docs/project-configuration/git-configuration) deploys unspecified branches, so a push must be treated as potentially causing an automatic Preview deployment. The separate `createDeployments` Git-provider option is not used as proof of automatic builds.

The inspected existing AI branch has 21 branch-specific Preview records. The local candidate branch has **zero branch-specific records and zero returned deployments**. The 27 common Preview records are each scoped only to Preview; their values were not inspected. Presence and environment scope do not verify credential validity, pairing, sandbox mode or database isolation. No credential was decrypted for this checkpoint. [Metadata summary](hosted-metadata-proof.json).

The latest five returned deployments for the existing AI branch are older builds. The newest returned READY build is `938522270da150aa770fe106100011b4bd27271e`, which is neither the local AI head nor this combined candidate. The held draft PR #455 still points to `145ab3d5e6398e1baa00a197db7858a20e686f90`. Its old CI failure cannot serve as current-candidate validation. [Old CI diagnosis](older-pr-ci-proof.json).

## Remaining gates

- The owner's earlier hosted approval allowed read-only Preview inspection. Applying the prepared branch-specific Development/sandbox configuration is still awaiting a separate response. No configuration was written, no environment was pulled/decrypted, and neither Production nor Development hosted secrets were accessed.
- The additive hosted schema upgrade, compatible isolated renderer, native hosted auth/upload/runtime checks, and hosted purchase/webhook isolation remain distinct gates. The local migration rehearsal is not a hosted migration.
- The AI pilot already supports bounded private reference/photo bytes in its Preview database. Ordinary **Your Design** uploads use the existing authenticated Cloudinary provider in hosted optimized builds. No Cloudinary configuration appeared in the inspected branch/common Preview names. This is a separate manual-upload acceptance gap; the AI private-image adapter does not prove the manual hosted path works. No Production media credentials were copied or new service provisioned.
- Current combined remote CI, required reviews and the protected-main release path have not run. No push, PR update, merge, deployment or promotion occurred. No new test link represents this candidate.

Metadata came from GET-only project/environment/deployment inspections, with `decrypt=false` for environment records. Only whitelisted counts, names/IDs, flags and source references are included here; raw logs, environment responses, credentials and private upload content stay outside Git. The [manifest](manifest.json) uses explicit path/sha256 entries.

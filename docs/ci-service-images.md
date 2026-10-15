# CI service image sources

## Why the registry is explicit

On 9 October 2026, two successive PR CI runs failed before application tests
started because Docker Hub rejected anonymous pulls of `postgres:16-alpine`.
The affected runs were [37990631070](https://github.com/SniperStopSniping/nailsalon/actions/runs/37990631070)
and [37992294749](https://github.com/SniperStopSniping/nailsalon/actions/runs/37992294749).

The initial repair used Docker Official Images on ECR Public. On 15 October,
multiple independent runners were rejected by that mirror with
`toomanyrequests: Data limit exceeded`, including runs
[38803071212](https://github.com/SniperStopSniping/nailsalon/actions/runs/38803071212)
and [38810932375](https://github.com/SniperStopSniping/nailsalon/actions/runs/38810932375).
The services now use [Google's public Docker Hub cache](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images)
at `mirror.gcr.io` with the same reviewed official-image digests. No registry
credentials, accounts or additional workflow permissions are introduced.

## Reviewed image identity

The image digests are the exact Docker Hub manifests recorded by the successful
main [application test job 114015146378](https://github.com/SniperStopSniping/nailsalon/actions/runs/37988073319/job/114015146378)
at source `b697b595c75b18454a626d209ce3b0fd181b63d9`.
Each Google-cache manifest was fetched successfully by digest on 15 October. Its SHA256 was computed and matched against that recorded digest, and its Linux amd64 platform was confirmed, before changing the workflow.

| Service | Google cache repository and tag | Pinned manifest digest |
| --- | --- | --- |
| PostgreSQL | `mirror.gcr.io/library/postgres:16-alpine` | `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` |
| Redis | `mirror.gcr.io/library/redis:7-alpine` | `sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499` |

The workflow uses `repository:tag@digest`. The tag documents the intended major
version; the digest selects the reviewed content. Both indexes include Linux
amd64 images, as used by the existing Ubuntu runners.

This changes the download source and pins already exercised image content.
Product routes, database engines, test commands, isolation settings, health
checks, required checks, permissions, timeouts and failure handling stay the same.
Actual hosted container pulls and the complete required test matrix must still
pass before release; manifest identity alone is not a test result.

The first hosted ECR mirror run [37993470724](https://github.com/SniperStopSniping/nailsalon/actions/runs/37993470724)
successfully started all ten PostgreSQL services. It also exposed the disposable
database guard's exact legacy image-name check. That guard accepts the exact digest-pinned Google reference above, the previously reviewed ECR reference, and the existing local `postgres:16-alpine` reference. Untagged, unpinned, different-digest and other
registry/repository images remain rejected. Loopback-only port mapping, the
job-specific Docker network, and live database/session attestation still apply.
The guard tests cover these accepted references and unsafe alternatives. They
also read the actual CI workflow and attest each configured PostgreSQL image,
so changing a workflow reference without updating the guard fails locally.

## Updating or reverting

When intentionally updating a service image, review the new official image,
record its digest and update every matching workflow reference and the
`CI services use the reviewed digest-pinned Docker Official Images from the Google cache`
guard in `scripts/ci-workflow.node-test.mjs`. Run the full required CI matrix.
For PostgreSQL, also update the exact reviewed reference in
`src/libs/disposableDatabaseTarget.ts` and its acceptance tests. Keep the image
allowlist exact; do not bypass container or live-session attestation.

If this mirror is unavailable, reverting the registry change preserves the
existing checks but may reintroduce Docker Hub's pull limit. Do not remove the
database tests, weaken the required aggregate, or use an unreviewed image merely
to obtain a passing run.

# Private owner test link

This branch is a functional pilot, not the full essential release. The entry is
`/ai-website-test`, enabled only by `APP_ENV=preview` plus
`BUSINESS_SETUP_PREVIEW_TRIAL=true`. It uses normal Clerk Development sign-in and
verified email, reuses the existing onboarding owner-account resolver, and makes
one private empty test salon per signed-in identity. A database marker check and
transaction lock prevent wrong-environment writes and duplicate creation. Existing
salons and their settings are never copied or reset. Normal owner checks protect
all subsequent routes. Keep Vercel access protection on the app deployment.

Required server configuration on this branch's Preview target:
- Dedicated Preview `DATABASE_URL`, `LUSTER_NONPROD_DB_HOSTS`, `APP_ENV=preview`.
- Existing Preview Clerk test keys; no production credentials.
- `BUSINESS_SETUP_AI_ENABLED=true`, `BUSINESS_SETUP_PUBLISH_ENABLED=true`.
- `BUSINESS_SETUP_PREVIEW_TRIAL=true` and `CUSTOM_SITE_PREVIEW_PRIVATE_IMAGES=true`.
- `OPENAI_API_KEY_CUSTOM_SITES` as a sensitive secret, never a NEXT_PUBLIC value.
- `CUSTOM_SITE_TRIAL_BUDGET_CAD=33.61` after freezing the local ledger.
- `NEXT_PUBLIC_APP_URL` and `CLERK_AUTHORIZED_PARTIES` equal the exact private alias.
- `CUSTOM_SITE_RENDER_ORIGIN` is a separate registrable site, plus
  `CUSTOM_SITE_ISOLATED_ORIGIN_VERIFIED=true` only after header/isolation checks.
- Billing and SMS activation flags remain false. No email, SMS, Google or n8n
  credentials/connections are added. Preview crons are not activated.

Private images are decoded with the existing image normalization code and stored
as immutable bounded bytes in the Preview DB, not ephemeral serverless disk.
Limit: 3MB input, 750KB normalized image, 24 assets/15MB per salon, 2MB total website
photos per artifact. PDFs are private references, at most6 pages; they are never
public assets. This does not replace the production authenticated-media adapter.

Apply migrations0098–0103 only with the repository's fixed Preview wrapper and
attested Preview URL. Check the applied journal first. No production migration
or deployment is authorized. The CLI is64.0.2;64.1.0 is recommended by the plugin,
but no concrete incompatibility requiring an upgrade was found for this pilot.

Budget transfer: local ledger consumed CAD6.384406 from10 OpenAI calls and is
frozen at exactly that cap. The hosted ledger/environment cap may be CAD33.61,
keeping total authorized allowance below CAD40. Do not re-enable the local budget
or create a second40CAD ledger. Unknown provider usage retains its reservation.
Raw outputs remain private; diagnostics contain token/cost counts and record IDs.

Disabling AI preserves saved drafts, published frontends and ordinary booking.
For pilot rollback disable its entry/generation flags or re-alias the prior tested
Preview deployment; never delete paid-call evidence or reverse appointments.

Deployment note: create a Git-source Preview using the exact branch and committed
SHA. An uploaded-files CLI Preview did not receive the branch-specific trial
flags and returned404; the Git-source Preview received them. Keep the secrets
scoped to this branch. Normal Clerk sign-up may require an organization according
to the existing Development instance settings. Email verification is required
before creating the test salon; the entry provides an explicit email-code step.

Hosted entry verification found a Next server-action redirect client failure across
the protected Preview auth/admin layouts. The trial entry now calls a same-origin
authenticated POST and uses a full navigation. The endpoint verifies email and
resolves the owner on the server; no browser identity or salon is accepted.

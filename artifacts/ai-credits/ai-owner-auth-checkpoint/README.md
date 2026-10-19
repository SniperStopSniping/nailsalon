# AI entry authentication checkpoint

Application source: `0879b3b7ca62e2268c0c0d798b57e3d14acd2946` on the isolated AI branch. This is a scoped local adaptation of the owner-session fix from `e65fb5164af91311f54eb61bdf48dc357003fd12`; it is **not** a claim that the broader audit branch or final release candidate has been merged or verified.

## Change

The AI sign-in/signup card now obtains the genuine current pending-session token for its organization request, checks that the same task/session remains selected before dispatch and activation, suppresses stale/unmounted responses, and permits only one automatic attempt per task. Retry remains an explicit owner action. The integration client adds the optional Bearer header only to this organization endpoint. Ordinary cookie-based calls remain supported.

AI SignUp, sign-in links, salon-creation link and requested return URL are preserved. Shared sign-in status/error copy now says “Opening your Luster account…” / “We couldn’t finish signing you in. Try again.” It does not expose an arbitrary provider error to the owner. Server authorization rules, bookings, catalog, payments, migrations, AI pricing and spending caps are unchanged.

## Deterministic and build evidence

The first imported regression checks reproduced **six failures** against the previous AI application: missing token dispatch, stale token/session activation, disappearance of a pending session, and raw error exposure. See [before checks](regression-before-proof.json).

The adapted implementation passed **151 tests across12 distinct affected files**, covering the owner card, AI/normal entry pages, client, account gate, identity/provider boundaries, organization API, onboarding continuation/integration and setup editor. See [passing checks](regression-after-proof.json). The final command accidentally used a `.tsx` suffix for the `.ts` client suite; that exact client suite was then run separately. The11-file140-test result and the distinct11-test client result are both represented, without double counting. One newly added assertion initially used an unavailable Vitest matcher; it was corrected to the installed matcher pair before the passing runs.

Scoped ESLint and diff checks passed. The optimized build, including its typecheck and credential scanner, passed:4846 tracked/600 generated files, zero server-canary matches. [Build proof](optimized-build-proof.json). Only an owned prior build's recomputable webpack cache was removed for space; its optimized server/static, metadata, certificates and prior evidence were preserved. The existing disk-reserve guard was not weakened.

## Genuine owner-facing acceptance

- [New owner](new-owner-proof.json): started in an empty Chromium context using the real signup widget, official Clerk Development testing support and native provider responses/cookies. The browser observed the genuine `choose-organization` pending state. Exactly **one same-origin organization POST** carried a Bearer token and returned200. No token value was logged. The verified active owner received exactly one private salon draft, owner membership, zero services/appointments/AI credit entries, and anonymous public404. Refresh retained the draft. No session, organization, membership or credit was seeded directly.
- [Returning owner](returning-owner-proof.json): a fresh iPhone13-emulated WebKit context, without restored cookies, completed actual password sign-in, More → Luster AI, the existing published Cobalt site preview and refresh. It loaded the same saved business. The browser checked six documents and82 critical text responses against four actual private credential values, with zero leaks and zero unreadable critical responses. Emulation is not a physical-iPhone test.
- [Tenant isolation](tenant-isolation-proof.json): using these native owner sessions, both actors received200 for their own setup/custom-site reads and403 for the other salon, four checks each way. Other-salon responses did not contain the synthetic business/address. A private address present in an authorized owner's own response is recorded as `containsSyntheticPrivateAddress`, not treated as a public leak. The existing published revision8, one appointment, CAD9.775907 credit balance and seven prior model-call rows were unchanged.

[New owner builder](new-owner-builder.png) · [Existing owner sign-in](returning-owner-sign-in.png) · [Returning owner preview controls](returning-owner-preview.png).

This checkpoint makes **no new model-generation, visual-reference recreation, payment, publication or customer-booking-completion claim**. Those remain separately attributed to the earlier [fresh funded owner checkpoint](../fresh-stripe-owner-checkpoint/README.md). Here only authentication/owner access changed; native model-call counts stayed unchanged. The local runtime blocked model/payment provider hosts and disabled purchases. Actual Clerk authentication calls did occur; `modelCalls:0` refers specifically to AI generation.

The genuine new test account used the last available Development organization slot:49→50. No old identities were deleted and no capacity upgrade was purchased. Preserve `user_3KtFizglWSwZX852mkLEyeWePw0` / `org_3KtFjiIuJVL5aUFw0qyMFh89bU8` and the earlier active fixtures. Further **new-account** tests in this Development instance need a separately authorized disposable-fixture cleanup or capacity change. This is not a statement about the separate Production instance.

All owned3443/3444/3445 runtime children stopped cleanly afterward; other tasks' resources and the local databases were preserved. No push, PR update, merge, hosted configuration write, hosted migration or deployment occurred. Preview write approval and broader combined/hosted/Production release gates remain outstanding.

Visual review also caught hardcoded “draft” labels inside an otherwise published owner's private preview. They are still present in0879 and are the next local UX correction; this checkpoint does not conceal or claim to fix them. The owner preview correctly continues to disable bookings independently of the published public site.

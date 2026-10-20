# Production AI funded by paid credits

The owner clarified that production usage should be funded by customers buying
AI credits. The optional fixed operator ceiling previously required a separate
lifetime amount even when a salon had prepaid. Production can now explicitly use
`CUSTOM_SITE_PRODUCTION_FUNDING_MODE=paid_credits`, with the fixed-cap variable
absent. Ambiguous/unknown configuration is rejected.

Each salon's verified net **production** purchases fund provider expense, up to
half their retail credit value. Expense uses the same frozen accounting
conversion as the admitted request. Pending/unknown calls remain counted; a failed
request still returns the customer's hold. Refunds/disputes reduce funding,
recovery grants and sandbox payments do not create it, and another salon cannot
fund the request. Salon/account locks serialize provider admission and verified
refunds. A new verified purchase can fund further work without resetting prior
expense. This is a gross allocation before payment fees and actual FX, not a
guaranteed net profit margin.

The first purchase is allowed before any funding exists. Generation still needs
a paid credit reservation and the existing failure/rate limits. Optional fixed
production ceilings retain their existing behavior. The isolated CAD80 trial and
its historical/unknown costs are unchanged. No migration or new funding table is
needed: existing verified purchases and retained provider-call evidence are used.

Verification: **63 focused tests**, **22 workflow contracts**, scoped TypeScript,
and scoped ESLint passed. An initial synthetic-history fixture lacked its required
historical reservation identifier; after correction its intentionally large
expense also polluted later shared-cap tests. That fixture now removes only its
own synthetic row during teardown. These were test-fixture corrections, not
changes to production expense retention.

The nine-case native PostgreSQL suite is not locally qualified: the existing
loopback server reports missing `global/pg_filenode.map`. No unrelated server was
stopped or repaired. Required CI now demands all **nine** database cases with zero
skips, including a refund arriving during token counting while another funded
salon continues. Full local type checking encounters the previously known
Vitest4-versus-branch-Vitest2 graph mismatch; scoped checks pass and clean
exact-head CI remains required.

[Proof](proof.json). These are deterministic provider/payment doubles and isolated
database tests. No real model call, Stripe payment, Production change or deployment
was performed. Runtime launch configuration and final combined release gates
remain incomplete.

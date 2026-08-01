# Preview service-image fixtures

This runner manages synthetic Preview-only data for service-image visual review. Never use it against Production. It does not load dotenv files, run migrations, deploy code, or call provider APIs.

Run `npm run db:fixture:preview -- <plan|apply|verify|reset>`. Every command connects only after static validation, then checks the live TLS session, non-elevated role, serializable transaction with row filtering forced to fail closed, exact 64-migration ledger ending in `0063_booking_policy_acknowledgments`, required schema, the exact catalog-visible incoming-FK allowlist, and fixture ownership. Mutation commands acquire deterministic relation locks before FK discovery. `reset` also needs `LUSTER_PREVIEW_FIXTURE_RESET_CONFIRM=DELETE_SYNTHETIC_PREVIEW_FIXTURES`. Required process inputs include the PostgreSQL connection, `LUSTER_PREVIEW_FIXTURE_ENV=preview`, exact database/host/TLS/application-name markers, `LUSTER_PREVIEW_FIXTURE_VERSION=service-images-v1`, `LUSTER_PREVIEW_FIXTURE_CONFIRM=CREATE_SYNTHETIC_PREVIEW_FIXTURES`, and an approved `LUSTER_PREVIEW_TARGET_FINGERPRINT`.

For supervised macOS execution, use a small owner-maintained one-process wrapper stored outside this repository. Invoke it with only the action, so shell history contains only the wrapper path and `plan`, `apply`, `verify`, or `reset`. The wrapper must disable tracing, obtain the Preview connection directly from macOS Keychain without echoing it, obtain the separately reviewed target-marker inputs from a secure store or non-echoing prompts, export them only in the wrapper process for its `npm` child, never print them, and unset them with an exit trap. It must validate the action before invoking this repository command. No new repository dependency is required.

A sanitized wrapper shape is below. Store it outside the repository with owner-only permissions; it contains no secret. Load the required, separately reviewed marker inputs by the same secure/non-echoing method before the `npm` child. Do not replace the Keychain capture with interactive secret entry.

```zsh
#!/bin/zsh
set -euo pipefail
set +x
case "${1-}" in
  plan|apply|verify|reset) action="$1" ;;
  *) exit 64 ;;
esac
typeset keychain_item
IFS= read -r -s 'keychain_item?Keychain item label: '
printf '\n'
cleanup() { unset DATABASE_URL keychain_item action; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
typeset -x DATABASE_URL
DATABASE_URL="$(/usr/bin/security find-generic-password -w -s "$keychain_item")"
npm run db:fixture:preview -- "$action"
```

Never type or paste the database URL into a normal interactive command, use an inline secret assignment, run an interactive `export` containing it, pass it as a process argument, save it to plaintext, or store it in `.env*`. Do not route it through the clipboard; if an exceptional supervised process used the clipboard before this run, clear both the current clipboard and any clipboard-manager history first. Do not enable shell tracing or print environment dumps.

The expected fingerprint is a comparison marker for `lowercase-host|5432|role|database`. Obtain or verify its approved value separately from the connection URL. Computing it from that same URL in the wrapper or invocation does not provide independent attestation and must not be described as doing so.

The first hosted action must be `plan` against the direct, non-pooled Preview endpoint. Pooled endpoints are unsupported and are expected to fail closed. `plan` is read-only and reports aggregate counts; no `apply` is authorized until that exact plan report and target attestation have been independently reviewed.

The deterministic scope is two salons, two locations, twelve image-bearing services, two technicians, twelve assignments, two add-ons, two add-on rules, one unmapped synthetic admin, and two owner memberships. The default salon omits `showServiceImages`; the comparison salon stores `showServiceImages=false`. Public booking review needs no provider identity. Optional Settings access requires a separately created Clerk Development user ID plus `LUSTER_PREVIEW_CLERK_ENV=development` and `LUSTER_PREVIEW_ADMIN_CONFIRM=MAP_SYNTHETIC_DEVELOPMENT_USER`; the runner validates and stores the trimmed ID without logging or calling Clerk. A Settings save creates application audit history, so reset safely refuses until those non-allowlisted rows are reviewed separately.

`apply` reconciles both synthetic salons to the canonical fixture specification. A later apply can therefore overwrite manual Settings-toggle changes made only for visual review; verify the toggle, record the result, and expect the next apply to restore the canonical default/ON and explicit-OFF states.

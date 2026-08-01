# Preview service-image fixtures

This runner manages synthetic Preview-only data for service-image visual review. Never use it against Production. It does not load dotenv files, run migrations, deploy code, or call provider APIs.

Run `npm run db:fixture:preview -- <plan|apply|verify|reset>`. Every command connects only after static validation, then verifies the actual node-postgres client transport before its first query. Before authentication, the runner supplies an immutable TLS configuration with certificate rejection enabled, the independently attested hostname, TLS 1.2 minimum, and an explicit snapshot of Node's bundled root certificates. Supplying `ca` explicitly prevents ambient extra or system roots from expanding this trust set. The connected transport must be a real Node `TLSSocket` using TLS 1.2 or 1.3, an authorized peer certificate matching that host, and a completed bidirectional handshake. Plain, unauthorized, unverifiable, incomplete, or unsupported transports fail closed. `NODE_TLS_REJECT_UNAUTHORIZED=0`, `NODE_USE_SYSTEM_CA`, external CA environment overrides, and Node options or process arguments that alter the CA source are always rejected before connection.

`pg_stat_ssl` remains supporting evidence, not the primary client-to-endpoint TLS proof. Managed routing can terminate the verified client TLS connection upstream of the PostgreSQL backend. A verified client transport with backend `ssl=false` or backend visibility absent is reported only as `client TLS verified; backend TLS visibility unavailable/terminated upstream`; it is never represented as backend TLS. Backend `ssl=true` is reported as `client TLS verified; backend TLS visible`. A backend claim cannot rescue an unverified client transport.

The node-postgres compatibility adapter reads the connected `Client.connection.stream` plus the `Client.ssl` and `Client.connection.ssl` references audited against locked `pg` 8.13.0. A runner-created closure binds the expected host, exact frozen TLS configuration, and post-connect adapter together; an unbranded clone or changed shape fails closed. Native TLS and certificate methods are captured when the module loads. The adapter immediately reduces observations to non-secret booleans and fixed result text and never logs the client, socket, certificate, host, or authorization error. The pure evaluator is available only to tests and is not a production attestation API. Any node-postgres or Node upgrade requires re-auditing this boundary.

After transport verification, every command checks the non-elevated role, serializable transaction with row filtering forced to fail closed, exact 64-migration ledger ending in `0063_booking_policy_acknowledgments`, required schema, the exact catalog-visible incoming-FK allowlist, and fixture ownership. Mutation commands acquire deterministic relation locks before FK discovery. `reset` also needs `LUSTER_PREVIEW_FIXTURE_RESET_CONFIRM=DELETE_SYNTHETIC_PREVIEW_FIXTURES`. Required process inputs include the PostgreSQL connection, `LUSTER_PREVIEW_FIXTURE_ENV=preview`, `LUSTER_PREVIEW_CONNECTION_MODE=direct`, exact database/host/TLS/application-name markers, `LUSTER_PREVIEW_FIXTURE_VERSION=service-images-v1`, `LUSTER_PREVIEW_FIXTURE_CONFIRM=CREATE_SYNTHETIC_PREVIEW_FIXTURES`, and an approved `LUSTER_PREVIEW_TARGET_FINGERPRINT`. The independently reviewed hostname must use Neon's direct `ep-….*.neon.tech` endpoint shape. A first label ending in `-pooler`, recognized pooler/PgBouncer labels anywhere in the host, non-Neon hosts, and malformed hosts are rejected before connection even when other markers match. Host shape is only target classification; it never substitutes for certificate-authorized live transport evidence.

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

## Isolated Preview migration-ledger read contract

The runner reads only `hash`, `created_at`, and ordering `id` from the exact relation `drizzle.__drizzle_migrations`. The isolated Preview runtime must already have `USAGE` on schema `drizzle`; the only table privilege it needs is `SELECT` on that relation. It does not need relation ownership or membership in an owner or migrator role. Missing read access fails safely with the command stage and bounded SQLSTATE `42501`, rolls back, and never skips or assumes the migration contract. A readable ledger with a wrong count, hash, timestamp, or final migration remains a separate `MIGRATION_REJECTED` failure.

After independent review, an authorized administrator for the isolated Preview database may perform this supervised Preview-only grant:

```sql
GRANT SELECT ON TABLE drizzle.__drizzle_migrations
TO luster_preview_runtime;
```

Do not run that grant against Production. Do not grant `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, ownership, schema `CREATE`, or owner/migrator membership. Verify the narrow contract without inspecting application rows:

```sql
SELECT
  has_schema_privilege('luster_preview_runtime', 'drizzle', 'USAGE') AS schema_usage,
  has_table_privilege('luster_preview_runtime', 'drizzle.__drizzle_migrations', 'SELECT') AS can_select,
  has_table_privilege('luster_preview_runtime', 'drizzle.__drizzle_migrations', 'INSERT') AS can_insert,
  has_table_privilege('luster_preview_runtime', 'drizzle.__drizzle_migrations', 'UPDATE') AS can_update,
  has_table_privilege('luster_preview_runtime', 'drizzle.__drizzle_migrations', 'DELETE') AS can_delete,
  has_table_privilege('luster_preview_runtime', 'drizzle.__drizzle_migrations', 'TRUNCATE') AS can_truncate,
  has_table_privilege('luster_preview_runtime', 'drizzle.__drizzle_migrations', 'REFERENCES') AS can_reference,
  has_table_privilege('luster_preview_runtime', 'drizzle.__drizzle_migrations', 'TRIGGER') AS can_trigger;
```

Expected: `schema_usage` and `can_select` are true; every write or ownership-adjacent privilege is false. Reverify the runtime attributes and confirm it has no role memberships:

```sql
SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname = 'luster_preview_runtime';

SELECT granted.rolname
FROM pg_catalog.pg_auth_members membership
JOIN pg_catalog.pg_roles member ON member.oid = membership.member
JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
WHERE member.rolname = 'luster_preview_runtime';
```

The attributes must remain `LOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`; the membership query must return no rows. This grant is intentionally not a repository migration because the role and permission are isolated-Preview administration concerns and must never be propagated to Production. To revoke the table permission without changing any other grant:

```sql
REVOKE SELECT ON TABLE drizzle.__drizzle_migrations
FROM luster_preview_runtime;
```

The first hosted action after the supervised grant must be `plan` against the direct, non-pooled Preview endpoint. Pooled endpoints are unsupported and are expected to fail closed. `plan` is read-only and reports aggregate counts; no `apply` is authorized until that exact plan report and target attestation have been independently reviewed.

The deterministic scope is two salons, two locations, twelve image-bearing services, two technicians, twelve assignments, two add-ons, two add-on rules, one unmapped synthetic admin, and two owner memberships. The default salon omits `showServiceImages`; the comparison salon stores `showServiceImages=false`. Public booking review needs no provider identity. Optional Settings access requires a separately created Clerk Development user ID plus `LUSTER_PREVIEW_CLERK_ENV=development` and `LUSTER_PREVIEW_ADMIN_CONFIRM=MAP_SYNTHETIC_DEVELOPMENT_USER`; the runner validates and stores the trimmed ID without logging or calling Clerk. A Settings save creates application audit history, so reset safely refuses until those non-allowlisted rows are reviewed separately.

`apply` reconciles both synthetic salons to the canonical fixture specification. A later apply can therefore overwrite manual Settings-toggle changes made only for visual review; verify the toggle, record the result, and expect the next apply to restore the canonical default/ON and explicit-OFF states.

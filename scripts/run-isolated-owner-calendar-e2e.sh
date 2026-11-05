#!/usr/bin/env bash
# Reuse the CI fixture and normal password-login/impersonation endpoints.
# No provider settings, real credentials, or saved browser state are inherited.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Set the disposable database URL}"
: "${LUSTER_DISPOSABLE_DATABASE:?Set to true for the disposable database}"
: "${LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID:?Set the fixture container ID}"
: "${LUSTER_DISPOSABLE_POSTGRES_NETWORK:?Set the fixture container network}"

# Next loads these files even with an empty inherited environment.
for env_file in .env .env.local .env.development .env.development.local; do
  if [[ -e "$env_file" || -L "$env_file" ]]; then
    printf 'Use a clean worktree without %s.\n' "$env_file" >&2
    exit 1
  fi
done

if curl --silent --output /dev/null --max-time 2 http://localhost:3101/robots.txt; then
  printf 'Port 3101 already has an HTTP server. Stop it before running the isolated check.\n' >&2
  exit 1
fi

log_file="$(mktemp -t luster-owner-calendar)"
test_password="$(openssl rand -hex 24)"
runtime_env=(
  "PATH=$PATH" "HOME=$HOME"
  "CI=true"
  "DATABASE_URL=$DATABASE_URL"
  "LUSTER_DISPOSABLE_DATABASE=$LUSTER_DISPOSABLE_DATABASE"
  "LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID=$LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID"
  "LUSTER_DISPOSABLE_POSTGRES_NETWORK=$LUSTER_DISPOSABLE_POSTGRES_NETWORK"
  "PUBLIC_APP_URL=http://localhost:3101"
  "BILLING_PLAN_ENV=test"
  "CLERK_SECRET_KEY=ci-placeholder-not-a-secret"
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2kubHVzdGVyLmludmFsaWQk"
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in"
  "STRIPE_SECRET_KEY=ci-placeholder-not-a-secret"
  "STRIPE_WEBHOOK_SECRET=ci-placeholder-not-a-secret"
  "STRIPE_CONNECT_WEBHOOK_SECRET=ci-placeholder-not-a-secret"
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=ci-placeholder-not-a-secret"
  "SUPER_ADMIN_AUTH_MODE=password"
  "SUPER_ADMIN_TEST_LOGIN_ENABLED=true"
  "SUPER_ADMIN_TEST_PHONE=4165550101"
  "SUPER_ADMIN_TEST_PASSWORD=$test_password"
  "LEGACY_OTP_AUTH_ENABLED=false"
  "E2E_INSECURE_COOKIES=true"
)
# This command attests both the Docker target and live database session before
# migrating or seeding. Do not start the application if that check fails.
env -i "${runtime_env[@]}" node_modules/.bin/tsx scripts/prepare-e2e-ci-database.ts
env -i "${runtime_env[@]}" node_modules/.bin/next dev --hostname localhost --port 3101 >"$log_file" 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true' EXIT
printf 'Isolated server log: %s\n' "$log_file"
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    cat "$log_file" >&2
    exit 1
  fi
  if curl --silent --fail --output /dev/null --max-time 2 http://localhost:3101/robots.txt; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  printf 'The isolated server did not start. See %s.\n' "$log_file" >&2
  exit 1
fi

env -i "${runtime_env[@]}" \
  E2E_ISOLATED_OWNER_CALENDAR=true E2E_BASE_URL=http://localhost:3101 \
  E2E_SUPER_ADMIN_PHONE=4165550101 "E2E_SUPER_ADMIN_PASSWORD=$test_password" \
  node_modules/.bin/playwright test tests/e2e/isolated-owner-calendar.e2e.ts \
  --project=chromium --no-deps --retries=0 --reporter=line

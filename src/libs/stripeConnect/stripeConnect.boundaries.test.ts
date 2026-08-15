/**
 * Structural boundaries (charter tests 10 and 31).
 *
 * These read the shipped source from disk. They catch the class of regression no
 * runtime test can observe: an account id becoming settable from a request body,
 * a second derivation of expected livemode appearing, the environment-isolation
 * module gaining an import, or the one sanctioned `appointment_deposit` read
 * being reimplemented as raw SQL.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

const CONNECT_ROUTE_DIR = path.join(ROOT, 'src/app/api/integrations/stripe-connect');
const CONNECT_WEBHOOK_ROUTE = path.join(ROOT, 'src/app/api/webhooks/stripe-connect/route.ts');
const BILLING_WEBHOOK_ROUTE = path.join(ROOT, 'src/app/api/webhooks/stripe/route.ts');
const CONNECT_LIB_DIR = path.join(ROOT, 'src/libs/stripeConnect');
const DISCONNECT_ROUTE = path.join(
  ROOT,
  'src/app/api/integrations/stripe-connect/disconnect/route.ts',
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function isTestFile(file: string): boolean {
  return /\.test\.|\.test-/.test(path.basename(file));
}

/**
 * These boundaries are about EXECUTABLE CODE, not prose. The modules below
 * deliberately explain in comments why they do not call
 * `resolveRuntimeEnvironment`, why no `Stripe-Account` header is needed, and why
 * `poisoned` has no write site — documentation that would otherwise trip the very
 * greps that enforce those rules. Dropping comment-only lines keeps each
 * assertion pointed at code while leaving the explanations in place.
 */
function codeLines(source: string): { line: string; number: number }[] {
  return source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      return trimmed !== ''
        && !trimmed.startsWith('//')
        && !trimmed.startsWith('*')
        && !trimmed.startsWith('/*');
    });
}

function codeOnly(source: string): string {
  return codeLines(source).map(({ line }) => line).join('\n');
}

/** Every runtime (non-test) file under `src/**`. */
function runtimeSourceFiles(): string[] {
  return walk(path.join(ROOT, 'src')).filter(file => !isTestFile(file));
}

const d2RouteFiles = [
  ...walk(CONNECT_ROUTE_DIR).filter(file => file.endsWith('route.ts')),
  CONNECT_WEBHOOK_ROUTE,
];

describe('test 10 — BIND-1 structural: no request-shaped account-id surface', () => {
  it('no D2 route reads an account id out of a request', () => {
    // BIND-1: `stripe_account_id` values originate EXCLUSIVELY from
    // `stripe.accounts.create` return values in our own server process.
    const offenders = d2RouteFiles.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /(?:searchParams\.get|body)[^\n]*(?:stripeAccountId|account_id)/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});

describe('test 31 — module boundaries', () => {
  it('no Stripe-Account header anywhere in the D2 file set', () => {
    // The platform key addresses connected accounts directly; no D2 call needs
    // an account header, and one appearing would mean a call was re-scoped.
    const files = [...d2RouteFiles, ...walk(CONNECT_LIB_DIR).filter(f => !isTestFile(f))];
    for (const file of files) {
      const source = codeOnly(readFileSync(file, 'utf8'));

      expect({ file, matched: /Stripe-Account|stripeAccount:/.test(source) })
        .toEqual({ file, matched: false });
    }
  });

  it('the two webhook routes reference their OWN secret and not the other', () => {
    const connectSource = readFileSync(CONNECT_WEBHOOK_ROUTE, 'utf8');

    expect(connectSource).toContain('STRIPE_CONNECT_WEBHOOK_SECRET');

    const billingSource = readFileSync(BILLING_WEBHOOK_ROUTE, 'utf8');

    expect(billingSource).toContain('STRIPE_WEBHOOK_SECRET');
    expect(billingSource).not.toContain('STRIPE_CONNECT_WEBHOOK_SECRET');
  });

  it('appointmentDepositSchema is imported only at sanctioned sites', () => {
    // Deliberately NOT "no import outside Schema.ts": that form is unsatisfiable
    // against a correct build, because the DEPOSITS_IN_FLIGHT refusal is a real
    // runtime read. Test files import the symbol by design and are excluded.
    //
    // D2 wrote NOTHING to this table, so at D2's head there was exactly one
    // sanctioned site. D4 is the PR that creates and resolves deposit rows, so
    // the allowlist below is enumerated rather than counted: each entry is a
    // deliberate site, and an unlisted importer still fails.
    const importers = runtimeSourceFiles().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /\bappointmentDepositSchema\b/.test(source);
    });

    expect(importers.sort()).toEqual([
      // D2: the disconnect route's DEPOSITS_IN_FLIGHT refusal (read-only).
      path.join(ROOT, 'src/app/api/integrations/stripe-connect/disconnect/route.ts'),
      // D4: creates the deposit row in the booking transaction, and fences a
      // reschedule that would strand a live deposit.
      path.join(ROOT, 'src/app/api/appointments/route.ts'),
      // D4: the read-only manage-token hold state and its server view.
      path.join(ROOT, 'src/app/[locale]/[slug]/manage/[token]/ManageAppointmentView.tsx'),
      path.join(ROOT, 'src/app/api/public/appointments/manage/[token]/route.ts'),
      // D4: the public session-status poll surface (read-only, no writes).
      path.join(ROOT, 'src/app/api/public/deposits/session-status/route.ts'),
      // D4: the reaper and THE module boundary that owns every hold-moving CAS.
      path.join(ROOT, 'src/libs/depositHoldReaper.ts'),
      path.join(ROOT, 'src/libs/deposits/holdWriters.ts'),
      path.join(ROOT, 'src/models/Schema.ts'),
      // D5: the payment-confirmation layer. Each entry is a deliberate site.
      // The Connect route reads the table only to match a `refund.*` event to a
      // deposit; the two libs under `deposits/` are the single confirm writer
      // and the refund core; `depositWebhookEvents` reads it for the admission
      // cap; `depositReconcile` is the sweep; `depositOutboxHandlers` reads it
      // to build the refund notice.
      path.join(ROOT, 'src/app/api/webhooks/stripe-connect/route.ts'),
      path.join(ROOT, 'src/libs/depositReconcile.ts'),
      path.join(ROOT, 'src/libs/deposits/confirmDepositPayment.ts'),
      path.join(ROOT, 'src/libs/deposits/depositOutboxHandlers.ts'),
      path.join(ROOT, 'src/libs/deposits/depositWebhookEvents.ts'),
      path.join(ROOT, 'src/libs/deposits/lateDepositRecovery.ts'),
      // D6: admin read/mutation surfaces, refund lifecycle and money guards,
      // plus the purge predicate's deposit-state exclusions.
      path.join(ROOT, 'src/app/api/admin/appointments/[id]/deposit/route.ts'),
      path.join(ROOT, 'src/app/api/admin/deposits/route.ts'),
      path.join(ROOT, 'src/libs/deposits/depositLifecycle.ts'),
      path.join(ROOT, 'src/libs/deposits/depositMoneyGuard.ts'),
      path.join(ROOT, 'src/libs/deposits/depositRefund.ts'),
      path.join(ROOT, 'src/libs/salonPurge.ts'),
      // D6.1: canonical read-time credit, refund/forfeiture presentation,
      // reporting/export, historical consumer guards, and reward repricing
      // fences. These are tenant-scoped readers except for the forfeiture
      // lifecycle writer, which preserves the existing appointment->deposit
      // lock order.
      path.join(ROOT, 'src/app/api/admin/clients/[id]/route.ts'),
      path.join(ROOT, 'src/app/api/appointments/history/route.ts'),
      path.join(ROOT, 'src/app/api/rewards/redeem/route.ts'),
      path.join(ROOT, 'src/app/api/rewards/redeem-points/route.ts'),
      path.join(ROOT, 'src/app/api/super-admin/organizations/[id]/export/route.ts'),
      path.join(ROOT, 'src/libs/depositCredit.server.ts'),
      path.join(ROOT, 'src/libs/deposits/depositForfeiture.ts'),
      path.join(ROOT, 'src/libs/financialReportingServer.ts'),
      path.join(ROOT, 'src/libs/queries.ts'),
    ].sort());
  });

  it('the disconnect route uses the mapped schema, never raw SQL on the table', () => {
    // Without this, the exemption above could be "satisfied" by dropping the
    // import and hand-writing SQL — exactly the improvisation the older,
    // unsatisfiable boundary invited.
    const source = readFileSync(DISCONNECT_ROUTE, 'utf8');
    const rawSqlTemplates = source.match(/sql`[^`]*`/g) ?? [];
    for (const template of rawSqlTemplates) {
      expect(template).not.toContain('appointment_deposit');
    }

    expect(source).not.toMatch(/db\.execute\([^)]*appointment_deposit/);
  });

  it('31(a) the livemode producer\'s host stays import-free by construction', () => {
    // That zero-import property is what lets an unauthenticated public page
    // graph consume `computeExpectedLivemode` without pulling the Stripe SDK.
    // No runtime test can observe this.
    const source = readFileSync(path.join(ROOT, 'src/libs/environmentIsolation.ts'), 'utf8');

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).toContain('export function computeExpectedLivemode');
  });

  it('31(b) exactly one producer, and no second derivation inside D2', () => {
    const files = [
      ...walk(CONNECT_LIB_DIR).filter(f => !isTestFile(f)),
      CONNECT_WEBHOOK_ROUTE,
    ];

    for (const file of files) {
      const offendingLines = codeLines(readFileSync(file, 'utf8'))
        .filter(({ line }) => /sk_live_|resolveRuntimeEnvironment/.test(line))
        // The single permitted line is the import of the one pure producer.
        .filter(({ line }) => !/import \{ computeExpectedLivemode \} from '@\/libs\/environmentIsolation'/.test(line))
        .map(({ line, number }) => `${number}: ${line.trim()}`);

      expect({ file, offendingLines }).toEqual({ file, offendingLines: [] });
    }
  });

  it('the account-lifecycle handlers invent NO escalation of their own', () => {
    // `poisoned` is declared-and-reserved for the reconcile sweep, which owns
    // the generic escalation. An `attempts >= 8 -> poisoned` branch grown here
    // would fork the lifecycle across two writers.
    //
    // The Connect ROUTE is now a shared file: the payment-confirmation layer
    // added its own dispatch to it, and that layer legitimately maps a torn
    // confirm onto `poisoned`. So the assertion is scoped to the account
    // handlers rather than to the file — which is the property that was always
    // meant, and which a whole-file grep only approximated while this route had
    // one owner.
    for (const file of walk(CONNECT_LIB_DIR).filter(f => !isTestFile(f))) {
      const occurrences = codeLines(readFileSync(file, 'utf8'))
        .filter(({ line }) => line.includes('poisoned'))
        // The ONLY permitted occurrences are the entries in the exported
        // vocabulary arrays in webhookEvents.ts.
        .filter(({ line }) => !(
          file.endsWith('webhookEvents.ts') && /^\s*'poisoned',\s*$/.test(line)
        ))
        .map(({ line, number }) => `${number}: ${line.trim()}`);

      expect({ file, occurrences }).toEqual({ file, occurrences: [] });
    }

    const routeSource = readFileSync(CONNECT_WEBHOOK_ROUTE, 'utf8');
    const dispatcherSource = readFileSync(
      path.join(CONNECT_LIB_DIR, 'accountWebhookDispatch.ts'),
      'utf8',
    );

    expect(routeSource).toContain('dispatchAccountWebhook({');

    for (const handler of ['handleAccountUpdated', 'handleDeauthorized']) {
      const start = dispatcherSource.indexOf(`async function ${handler}(`);

      expect(start).toBeGreaterThan(-1);

      // Up to the next top-level function declaration.
      const rest = dispatcherSource.slice(start + 1);
      const nextFunction = rest.search(/\nasync function |\nfunction /);
      const body = nextFunction === -1 ? rest : rest.slice(0, nextFunction);

      expect({ handler, escalates: codeOnly(body).includes('poisoned') })
        .toEqual({ handler, escalates: false });
    }
  });
});

'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { z } from 'zod';

const reportSchema = z.object({
  keysReady: z.boolean(),
  totalClaims: z.number().int().nonnegative(),
  missingEmail: z.number().int().nonnegative(),
  missingPhone: z.number().int().nonnegative(),
  purgedClaims: z.number().int().nonnegative(),
  ready: z.boolean(),
  newClaimsEnabled: z.boolean(),
});

type Report = z.infer<typeof reportSchema>;
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'loaded'; report: Report };

const REPORT_ERROR = 'Free-text readiness could not be checked. Try refreshing the report.';
const REQUEST_TIMEOUT_MS = 15_000;

function guidance(report: Report): string {
  if (!report.keysReady) {
    return 'Identity protection needs setup. Check the platform configuration before enabling new free-text claims.';
  }
  if (!report.ready) {
    return report.newClaimsEnabled
      ? 'New claims are enabled, but earlier allowances still need verified contact links. Review the history before treating duplicate-claim protection as complete.'
      : 'Earlier allowances need verified contact links. Review the history before enabling new free-text claims.';
  }
  return report.newClaimsEnabled
    ? 'New free-text claims are enabled. Each owner still needs a verified email and phone number.'
    : 'The identity checks are complete. New claims are still paused in the platform configuration; review the result before enabling them.';
}

/** Reuses the protected, read-only report. This panel cannot grant credits or enable claims. */
export function StarterIdentityReadinessPanel() {
  const headingId = useId();
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    const timeout = setTimeout(() => {
      controller.abort();
      setState({ kind: 'error', message: REPORT_ERROR });
    }, REQUEST_TIMEOUT_MS);
    async function load() {
      try {
        const response = await fetch('/api/super-admin/billing/starter-identity-readiness', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) {
            setState({ kind: 'error', message: 'Sign in to super admin to check free-text claims.' });
          }
          return;
        }
        if (!response.ok) {
          throw new Error('Readiness unavailable');
        }
        const body = await response.json();
        const report = reportSchema.parse(body?.data);
        if (!controller.signal.aborted) {
          setState({ kind: 'loaded', report });
        }
      } catch {
        if (!controller.signal.aborted) {
          setState({ kind: 'error', message: REPORT_ERROR });
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [refresh]);

  return (
    <section aria-labelledby={headingId} className="owner-theme-scope mb-8 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-5 text-[var(--owner-ink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold">Free-text claims</h2>
        <button
          type="button"
          className="owner-action min-h-11 gap-2"
          disabled={state.kind === 'loading'}
          onClick={() => setRefresh(value => value + 1)}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh report
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--owner-muted)]">Readiness for the one-time 100-text welcome allowance.</p>
      <div role="status" aria-live="polite" className="mt-4 text-sm leading-relaxed">
        {state.kind === 'loading' && 'Checking free-text readiness…'}
        {state.kind === 'error' && state.message}
        {state.kind === 'loaded' && (
          <>
            <p className="font-semibold">{state.report.newClaimsEnabled ? 'New claims enabled' : 'New claims paused'}</p>
            <p className="mt-1">{guidance(state.report)}</p>
          </>
        )}
      </div>
      {state.kind === 'loaded' && (
        <dl className="mt-5 grid gap-4 border-t border-[var(--owner-line)] pt-4 sm:grid-cols-2">
          {[
            ['Historical allowances', state.report.totalClaims],
            ['Without a verified email link', state.report.missingEmail],
            ['Without a verified phone link', state.report.missingPhone],
            ['Claims from deleted salons', state.report.purgedClaims],
          ].map(([label, count]) => (
            <div key={label}>
              <dt className="text-sm text-[var(--owner-muted)]">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{Number(count).toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-5 text-sm leading-relaxed text-[var(--owner-muted)]">Checking this report does not add texts or change any settings. It shows counts only, never owner contact details.</p>
    </section>
  );
}

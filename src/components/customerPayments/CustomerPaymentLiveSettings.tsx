'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';

const responseSchema = z.object({ revision: z.number().int().nonnegative(), enabled: z.boolean(), cancellationPolicy: z.string(), platformFeeCents: z.literal(0), mode: z.literal('optional_full'), feePayer: z.literal('salon'), setupAvailable: z.boolean().optional() });
type Policy = z.infer<typeof responseSchema>;

export function CustomerPaymentLiveSettings({ salonSlug, onDirtyChange }: { salonSlug: string; onDirtyChange?: (dirty: boolean) => void }) {
  const id = useId();
  const [saved, setSaved] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const pending = useRef<{ requestId: string; expectedRevision: number; enabled: boolean; cancellationPolicy: string } | null>(null);
  const endpoint = `/api/admin/salon/customer-payments/live?salonSlug=${encodeURIComponent(salonSlug)}`;
  const dirty = !!saved && (saved.enabled !== enabled || saved.cancellationPolicy !== policy);
  useEffect(() => {
    onDirtyChange?.(dirty || busy || uncertain);
    return () => onDirtyChange?.(false);
  }, [dirty, busy, uncertain, onDirtyChange]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(endpoint, { cache: 'no-store', signal });
    if (!response.ok) {
      throw new Error('Payment settings unavailable');
    }
    const next = responseSchema.parse(await response.json());
    if (!signal?.aborted) {
      setSaved(next);
      setEnabled(next.enabled);
      setPolicy(next.cancellationPolicy);
    }
  }, [endpoint]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) {
        setError('Could not load customer payment settings. Sign in as the salon owner and try again.');
      }
    });
    return () => controller.abort();
  }, [load]);

  async function refresh() {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await load();
      pending.current = null;
      setUncertain(false);
      setError('');
    } catch {
      setError('Could not confirm the saved settings. Please try refreshing again.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function save() {
    if (lock.current || !saved || (!pending.current && (!dirty || (enabled && !policy.trim())))) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    pending.current ??= { requestId: crypto.randomUUID(), expectedRevision: saved.revision, enabled, cancellationPolicy: policy };
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.current) });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (response.status === 409 && result?.error?.code === 'PAYMENT_WORKSPACE_CONNECT_SETUP_REQUIRED') {
          pending.current = null;
          setError('Finish Stripe setup and refresh its connection status before enabling customer payments.');
          return;
        }
        throw new Error('Save was not confirmed');
      }
      responseSchema.parse(await response.json());
      // A retry receipt may describe an earlier version. Re-read before showing
      // the current enabled state or declaring that this save is complete.
      await load();
      pending.current = null;
      setUncertain(false);
      setMessage('Customer payment settings saved.');
    } catch {
      setUncertain(true);
      setError('The saved result could not be confirmed. Retry the same save or refresh before making another change.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const button = 'min-h-11 rounded-xl border border-neutral-300 px-4 py-3 text-sm font-semibold disabled:opacity-50';
  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className="space-y-4 rounded-xl border border-neutral-200 p-4">
      <h3 id={`${id}-title`} className="text-lg font-semibold">Customer payments</h3>
      <p className="text-sm text-neutral-600">Let customers pay their appointment balance securely with Stripe. Required booking deposits are credited toward the total.</p>
      <fieldset disabled={!saved || busy || uncertain} className="space-y-4">
        <legend className="sr-only">Customer payment settings</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={enabled} disabled={!saved?.setupAvailable && !saved?.enabled} onChange={event => setEnabled(event.target.checked)} />
          Accept online customer payments
        </label>
        {!saved?.setupAvailable && <p className="text-sm text-amber-900">Online payment setup is not ready yet. Complete Stripe setup before turning this on.</p>}
        <p className="text-sm text-neutral-600">Luster platform fee: $0. Stripe processing fees are paid by your salon. Customers can pay in person where your deposit rules allow.</p>
        <label htmlFor={`${id}-policy`} className="block text-sm font-medium">Cancellation and refund policy</label>
        <textarea id={`${id}-policy`} value={policy} maxLength={5000} rows={4} onChange={event => setPolicy(event.target.value)} className="w-full rounded-xl border border-neutral-300 p-3 text-sm" />
        <p className="text-sm text-neutral-600">Turning payments off stops new requests. Existing payment links must be closed from the appointment, and payment history and refunds remain available.</p>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${button} bg-black text-white`} disabled={busy || !saved || (!uncertain && (!dirty || (enabled && !policy.trim())))} onClick={() => void save()}>{busy ? 'Saving…' : uncertain ? 'Retry this save' : 'Save payment settings'}</button>
        <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>Refresh status</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {message && <p role="status" className="text-sm text-green-800">{message}</p>}
    </section>
  );
}

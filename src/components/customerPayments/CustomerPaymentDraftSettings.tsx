'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { CustomerPaymentDraftResponse, CustomerPaymentDraftWrite } from '@/libs/customerPayments/settings';
import { customerPaymentDraftSettingsSchema, DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS } from '@/libs/customerPayments/settings';

function parseResponse(value: unknown): CustomerPaymentDraftResponse {
  const result = value as Partial<CustomerPaymentDraftResponse> | null;
  if (!result || result.testOnly !== true || result.collectionEnabled !== false || !Number.isSafeInteger(result.revision) || result.revision! < 0) {
    throw new Error('Invalid draft response');
  }
  return { testOnly: true, collectionEnabled: false, revision: result.revision!, settings: customerPaymentDraftSettingsSchema.parse(result.settings) };
}

/** Authenticated persistence of TEST drafts only; no provider or deposit activation. */
export function CustomerPaymentDraftSettings({ salonSlug, onDirtyChange }: { salonSlug: string; onDirtyChange?: (dirty: boolean) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<CustomerPaymentDraftResponse | null>(null);
  const [settings, setSettings] = useState({ ...DEFAULT_CUSTOMER_PAYMENT_DRAFT_SETTINGS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const pending = useRef<CustomerPaymentDraftWrite | null>(null);
  const locked = useRef(false);
  const endpoint = `/api/admin/salon/customer-payments?salonSlug=${encodeURIComponent(salonSlug)}`;
  const dirty = draft !== null && JSON.stringify(settings) !== JSON.stringify(draft.settings);
  useEffect(() => {
    onDirtyChange?.(dirty || uncertain || busy);
    return () => onDirtyChange?.(false);
  }, [dirty, uncertain, busy, onDirtyChange]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, { signal, cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Draft unavailable');
      }
      const value = parseResponse(await response.json());
      if (!signal?.aborted) {
        setDraft(value);
        setSettings(value.settings);
        setConflict(false);
        setMessage('');
      }
    } catch {
      if (!signal?.aborted) {
        setError('Could not load the test draft. Check your owner access and try again.');
      }
    } finally {
      if (!signal?.aborted) {
        setBusy(false);
      }
    }
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save() {
    if (!draft || busy || locked.current || conflict) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setMessage('');
    setError('');
    pending.current ??= { settings, expectedRevision: draft.revision, requestId: crypto.randomUUID() };
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.current) });
      if (response.status === 409) {
        pending.current = null;
        setUncertain(false);
        setConflict(true);
        setError('The saved draft changed. Reload it before editing or saving again.');
        return;
      }
      if (!response.ok) {
        throw new Error('Save unavailable');
      }
      const value = parseResponse(await response.json());
      setDraft(value);
      setSettings(value.settings);
      pending.current = null;
      setUncertain(false);
      setMessage('Test draft saved. Live collection remains off. Existing deposits are unchanged.');
    } catch {
      setUncertain(true);
      setError('Save outcome is not confirmed. Retry this same save to check it safely before making more changes.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={busy} className="space-y-4 rounded-xl border p-4">
      <h3 id={`${id}-title`} className="text-lg font-semibold">Customer payments · Test draft</h3>
      <p>This saves an owner-only test draft. It cannot activate collection, connect a bank account or change existing required deposits.</p>
      <fieldset disabled={!draft || busy || uncertain || conflict} className="space-y-3">
        <legend className="sr-only">Test payment draft</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />
          Allow online-payment preparation in this test draft
        </label>
        <p>Customers may choose online or in person only where the existing deposit policy permits it. Required full payment and customer-paid fees are unavailable.</p>
        <label htmlFor={`${id}-fee`} className="block">Salon-paid Luster fee (CAD cents)</label>
        <input
          id={`${id}-fee`}
          type="number"
          min="0"
          max="10000"
          step="1"
          value={settings.platformFeeCents}
          onChange={(event) => {
            const cents = Number(event.target.value);
            if (Number.isSafeInteger(cents) && cents >= 0 && cents <= 10000) {
              setSettings({ ...settings, platformFeeCents: cents });
            }
          }}
          className="min-h-11 w-full rounded-lg border p-2"
        />
        <p>100 cents = CAD 1.00, a test placeholder. Stripe processing costs are not added as an estimated customer charge.</p>
        <label htmlFor={`${id}-policy`} className="block">Draft cancellation and refund wording</label>
        <textarea id={`${id}-policy`} value={settings.cancellationPolicy} maxLength={5000} rows={4} onChange={event => setSettings({ ...settings, cancellationPolicy: event.target.value })} className="w-full rounded-lg border p-2" />
        <p>Refunds remain possible. These draft terms are not published to customers.</p>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy || !draft || conflict || (!dirty && !uncertain)} onClick={() => void save()} className="min-h-11 rounded-lg border px-4">{busy ? 'Please wait…' : uncertain ? 'Retry same save' : 'Save test draft'}</button>
        <button type="button" disabled={busy || uncertain} onClick={() => void load()} className="min-h-11 rounded-lg border px-4">Reload saved draft</button>
      </div>
    </section>
  );
}

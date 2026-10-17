'use client';

import { useRef, useState } from 'react';

import type { AiBuilderEntry } from './entry.server';

const navigate = (url: string) => window.location.assign(url);
export function OpenAiBuilder({ locale, onNavigate = navigate }: { locale: string; onNavigate?: (url: string) => void }) {
  const [choices, setChoices] = useState<{ slug: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function open(salonSlug?: string) {
    if (locked.current) {
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/business-setup/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(salonSlug ? { salonSlug } : {}) });
      const result = await response.json() as { data?: AiBuilderEntry; error?: string };
      if (!response.ok || !result.data) {
        throw new Error(result.error ?? 'We could not open your saved business. Please try again.');
      }
      if (result.data.kind === 'choose') {
        setChoices(result.data.salons);
      } else {
        onNavigate(`/${locale}/admin/business-setup?salon=${encodeURIComponent(result.data.slug)}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not open your saved business. Please try again.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="ai-entry-account" aria-busy={busy} aria-label="Open your AI builder">
      {choices.length
        ? (
            <>
              <h2>Which business are we working on?</h2>
              <p>We’ll start with its saved website, services and settings.</p>
              <div className="ai-entry-choices">{choices.map(salon => <button type="button" className="ai-entry-secondary" disabled={busy} key={salon.slug} onClick={() => void open(salon.slug)}>{salon.name}</button>)}</div>
            </>
          )
        : (
            <>
              <h2>Let’s bring your business to life.</h2>
              <p>Your existing details come with you. New businesses start with a private draft.</p>
              <button type="button" className="ai-entry-primary" disabled={busy} onClick={() => void open()}>{busy ? 'Opening your saved business…' : 'Continue to my AI builder'}</button>
            </>
          )}
      {busy && <p role="status">Opening your saved business…</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

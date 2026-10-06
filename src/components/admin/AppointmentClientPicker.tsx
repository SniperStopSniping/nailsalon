'use client';

import { Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatPhoneForDisplay, normalizePhone } from '@/libs/phone';

export type AppointmentClient = { id: string; fullName: string | null; phone: string; email: string | null };

/** Searches the existing tenant-scoped directory; selecting only fills the form. */
export function AppointmentClientPicker({ salonSlug, onSelect }: {
  salonSlug: string;
  onSelect: (client: AppointmentClient) => void;
}) {
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<AppointmentClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const search = query.trim();
    setClients([]);
    setError(false);
    setSearched(false);
    setLoading(search.length >= 2 && Boolean(salonSlug));
    if (search.length < 2 || !salonSlug) {
      return () => controller.abort();
    }
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ salonSlug, search, limit: '8', page: '1', sortBy: 'name', sortOrder: 'asc' });
        const response = await fetch(`/api/admin/clients?${params}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Client search failed');
        }
        const result = await response.json();
        if (!controller.signal.aborted) {
          setClients(Array.isArray(result.data?.clients) ? result.data.clients : []);
          setSearched(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, retry, salonSlug]);

  return (
    <div className="nap-client-picker">
      <label htmlFor="appointment-client-search">Find an existing client</label>
      <div className="nap-search">
        <Search aria-hidden="true" />
        <input id="appointment-client-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or phone number" autoComplete="off" />
      </div>
      <div aria-live="polite">
        {loading && (
          <p className="nap-helper flex items-center gap-2">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Searching clients…
          </p>
        )}
        {error && (
          <p className="nap-helper">
            Client search is unavailable. You can enter their details below.
            {' '}
            <button type="button" className="nap-link" onClick={() => setRetry(value => value + 1)}>Retry search</button>
          </p>
        )}
        {searched && !clients.length && <p className="nap-helper">No matching clients. Enter their details below to add the appointment.</p>}
      </div>
      {clients.length > 0 && (
        <ul className="nap-client-results" aria-label="Matching clients">
          {clients.map((client) => {
            const phone = normalizePhone(client.phone);
            const supported = /^\d{10}$/.test(phone);
            return (
              <li key={client.id}>
                <button type="button" disabled={!supported} onClick={() => onSelect({ ...client, phone })}>
                  <strong>{client.fullName || 'Client'}</strong>
                  <span>{formatPhoneForDisplay(phone)}</span>
                  {!supported && <span>This booking form requires a 10-digit phone number.</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

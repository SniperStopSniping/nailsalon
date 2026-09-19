'use client';

import { LoaderCircle, Search, Star, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { LusterClientSms } from '@/components/admin/LusterClientSms';
import { DEFAULT_REVIEW_MESSAGE, renderReviewMessage } from '@/libs/reviewRequests';

type ComposerClient = {
  id: string;
  fullName: string | null;
  phone: string;
};

type MessageChoice = 'blank' | 'google_review';
type ReviewMessageSettings = {
  googleReviewUrl: string | null;
  messageTemplate: string;
  businessName: string;
};

export function MarketingMessageComposer({
  salonSlug,
  salonName,
  googleReviewUrl,
}: {
  salonSlug: string;
  salonName: string;
  googleReviewUrl: string | null;
}) {
  const [clients, setClients] = useState<ComposerClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<ComposerClient | null>(null);
  const [choice, setChoice] = useState<MessageChoice>('blank');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewSettings, setReviewSettings] = useState<ReviewMessageSettings>({
    googleReviewUrl,
    messageTemplate: DEFAULT_REVIEW_MESSAGE,
    businessName: salonName,
  });

  const loadClients = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonSlug,
        sortBy: 'recent',
        sortOrder: 'desc',
        page: '1',
        limit: '100',
      });
      const [clientsResponse, reviewResponse] = await Promise.all([
        fetch(`/api/admin/clients?${params}`, { cache: 'no-store', signal }),
        fetch(`/api/admin/review-requests/settings?salonSlug=${encodeURIComponent(salonSlug)}`, { cache: 'no-store', signal }),
      ]);
      const [clientsPayload, reviewPayload] = await Promise.all([
        clientsResponse.json().catch(() => null),
        reviewResponse.json().catch(() => null),
      ]);
      if (!clientsResponse.ok) {
        throw new Error(clientsPayload?.error?.message || 'Clients could not be loaded.');
      }
      setClients(Array.isArray(clientsPayload?.data?.clients) ? clientsPayload.data.clients : []);
      if (reviewResponse.ok && reviewPayload?.data) {
        setReviewSettings({
          googleReviewUrl: reviewPayload.data.googleReviewUrl ?? googleReviewUrl,
          messageTemplate: reviewPayload.data.messageTemplate ?? DEFAULT_REVIEW_MESSAGE,
          businessName: reviewPayload.data.businessName ?? salonName,
        });
      }
    } catch (cause) {
      if (!signal?.aborted) {
        setError(cause instanceof Error ? cause.message : 'Clients could not be loaded.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [googleReviewUrl, salonName, salonSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void loadClients(controller.signal);
    return () => controller.abort();
  }, [loadClients]);

  const visibleClients = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) {
      return clients;
    }
    return clients.filter(client =>
      `${client.fullName ?? ''} ${client.phone}`.toLocaleLowerCase().includes(query));
  }, [clients, search]);

  let draft = '';
  if (selectedClient && choice === 'google_review' && reviewSettings.googleReviewUrl) {
    draft = renderReviewMessage({
      template: reviewSettings.messageTemplate,
      clientName: selectedClient.fullName,
      businessName: reviewSettings.businessName,
      reviewLink: reviewSettings.googleReviewUrl,
    });
  }

  return (
    <div className="space-y-4" data-testid="marketing-write-message">
      <section className="rounded-[20px] bg-[var(--owner-surface)] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <h2 className="text-[18px] font-semibold text-[var(--owner-ink)]">Choose what to send</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={choice === 'blank'}
            onClick={() => setChoice('blank')}
            className={`min-h-14 rounded-[14px] border p-3 text-left text-[14px] font-semibold ${choice === 'blank' ? 'border-[var(--owner-accent)] bg-rose-50 text-[var(--owner-accent)]' : 'border-[var(--owner-line)] bg-white text-[var(--owner-ink)]'}`}
          >
            <UserRound className="mb-1 size-4" />
            New message
          </button>
          <button
            type="button"
            aria-pressed={choice === 'google_review'}
            onClick={() => setChoice('google_review')}
            className={`min-h-14 rounded-[14px] border p-3 text-left text-[14px] font-semibold ${choice === 'google_review' ? 'border-[var(--owner-accent)] bg-rose-50 text-[var(--owner-accent)]' : 'border-[var(--owner-line)] bg-white text-[var(--owner-ink)]'}`}
          >
            <Star className="mb-1 size-4" />
            Google review
          </button>
        </div>
        {choice === 'google_review' && !reviewSettings.googleReviewUrl && (
          <p role="status" className="mt-3 text-[13px] text-amber-800">
            Add your Google review link in Google reviews before choosing a client.
          </p>
        )}
      </section>

      <section className="rounded-[20px] bg-[var(--owner-surface)] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <label htmlFor="marketing-client-search" className="text-[14px] font-semibold text-[var(--owner-ink)]">Choose a client</label>
        <div className="mt-2 flex min-h-12 items-center gap-2 rounded-[14px] border border-[var(--owner-line)] bg-white px-3">
          <Search className="size-4 text-[var(--owner-muted)]" aria-hidden="true" />
          <input
            id="marketing-client-search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search name or phone"
            className="min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        </div>
        {loading
          ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-[var(--owner-muted)]" role="status">
                <LoaderCircle className="size-4 animate-spin" />
                {' '}
                Loading clients…
              </p>
            )
          : error
            ? <button type="button" onClick={() => void loadClients()} className="mt-4 min-h-11 text-sm font-semibold text-[var(--owner-accent)] underline">Try loading clients again</button>
            : (
                <div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto" data-testid="marketing-client-picker">
                  {visibleClients.map(client => (
                    <button
                      key={client.id}
                      type="button"
                      disabled={choice === 'google_review' && !reviewSettings.googleReviewUrl}
                      onClick={() => setSelectedClient(client)}
                      className="flex min-h-12 w-full items-center justify-between rounded-[14px] border border-[var(--owner-line)] bg-white px-3 text-left disabled:opacity-40"
                    >
                      <span className="font-semibold text-[var(--owner-ink)]">{client.fullName || 'Client'}</span>
                      <span className="text-xs text-[var(--owner-muted)]">{client.phone}</span>
                    </button>
                  ))}
                  {visibleClients.length === 0 && <p className="py-6 text-center text-sm text-[var(--owner-muted)]">No clients found.</p>}
                </div>
              )}
      </section>

      {selectedClient && (
        <LusterClientSms
          key={`${salonSlug}:${selectedClient.id}`}
          salonSlug={salonSlug}
          salonName={salonName}
          clientId={selectedClient.id}
          recipientPhone={selectedClient.phone}
          composerOpen
          composerTitle={choice === 'google_review' ? 'Send Google review link' : `Text ${selectedClient.fullName || 'client'}`}
          initialDraft={draft}
          purpose={choice === 'google_review' ? 'google_review' : undefined}
          onClose={() => setSelectedClient(null)}
          showHistory={false}
        />
      )}
    </div>
  );
}

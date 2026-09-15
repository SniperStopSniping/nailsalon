'use client';

import { MessageCircle, RotateCcw, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';

import {
  buildResolvedMenuOrder,
  type MenuOrderIntent,
  type MenuService,
  parseMenuOrderIntent,
  requiresNamedSelection,
} from './menuOrderParser';
import {
  ownerMenuAssistantCopy,
  type OwnerMenuAssistantLocale,
} from './ownerMenuAssistantCopy';

type OrderedService = MenuService;

type Proposal = {
  id: string;
  status: 'ready' | 'no_op';
  oldOrder: OrderedService[];
  newOrder: OrderedService[];
};

type Receipt = {
  id: string;
  status: 'applied' | 'already_applied' | 'undone' | 'already_undone' | 'undo_unavailable';
  oldOrder?: OrderedService[];
  newOrder?: OrderedService[];
  currentOrder?: OrderedService[];
};

type ContextResponse = {
  data: { menu: MenuService[] };
};

type ActionResponse = {
  data: { proposal?: Proposal; receipt?: Receipt };
};

export type OwnerMenuAssistantTransport = {
  getContext: (salonSlug: string, signal: AbortSignal) => Promise<Response>;
  getStatus: (salonSlug: string, proposalId: string, signal: AbortSignal) => Promise<Response>;
  post: (body: Record<string, unknown>) => Promise<Response>;
};

const defaultTransport: OwnerMenuAssistantTransport = {
  getContext: (salonSlug, signal) => fetch(
    `/api/admin/owner-assistant/menu-order?salonSlug=${encodeURIComponent(salonSlug)}`,
    { signal },
  ),
  getStatus: (salonSlug, proposalId, signal) => fetch(
    `/api/admin/owner-assistant/menu-order?salonSlug=${encodeURIComponent(salonSlug)}&proposalId=${encodeURIComponent(proposalId)}`,
    { signal },
  ),
  post: body => fetch('/api/admin/owner-assistant/menu-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
};

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // The server validates the public UUID contract. This compatibility path is
  // only for test/older browser environments without randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 0x3) | 0x8).toString(16);
  });
}

async function readError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? 'The menu assistant could not complete that request.';
}

function serviceLabel(service: MenuService, services: readonly MenuService[]): string {
  const duplicateCount = services.filter(candidate => candidate.name.trim().toLocaleLowerCase() === service.name.trim().toLocaleLowerCase()).length;
  return duplicateCount > 1 ? `${service.name} · #${service.id}` : service.name;
}

function MenuPreview({ label, services }: { label: string; services: OrderedService[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--owner-muted)]">{label}</p>
      <ol className="mt-1 space-y-1 text-sm text-[var(--owner-ink)]">
        {services.map((service, index) => (
          <li key={service.id} className="flex gap-2">
            <span className="w-5 text-right text-[var(--owner-muted)]">
              {index + 1}
              .
            </span>
            <span>{serviceLabel(service, services)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The first dark-launched owner assistant deliberately handles one action:
 * moving a service in a salon-owned menu. The server is authoritative for
 * feature admission, tenant scope, freshness, idempotency, apply and undo.
 */
export function OwnerMenuAssistant({
  salonSlug,
  locale = 'en',
  transport = defaultTransport,
}: {
  salonSlug: string | null;
  locale?: OwnerMenuAssistantLocale;
  transport?: OwnerMenuAssistantTransport;
}) {
  const copy = ownerMenuAssistantCopy[locale];
  const [enabled, setEnabled] = useState(false);
  const [menu, setMenu] = useState<MenuService[]>([]);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [intent, setIntent] = useState<MenuOrderIntent | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'apply' | 'undo' | null>(null);
  const [recoveringProposalId, setRecoveringProposalId] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const sessionRef = useRef(0);

  const clearConversation = useCallback(() => {
    setOpen(false);
    setRequest('');
    setIntent(null);
    setSourceId('');
    setTargetId('');
    setProposal(null);
    setReceipt(null);
    setMessage(null);
    setBusy(null);
    setRecoveringProposalId(null);
    setNeedsRefresh(false);
  }, []);

  const closeConversation = useCallback(() => {
    if (busy) {
      setMessage(copy.wait);
      return;
    }
    // Closing is not a reset: preserve a confirmed receipt and recovery key
    // so an owner can safely reopen after a lost response.
    setOpen(false);
  }, [busy, copy.wait]);

  useEffect(() => {
    sessionRef.current += 1;
    const session = sessionRef.current;
    clearConversation();
    setEnabled(false);
    setMenu([]);
    if (!salonSlug) {
      return undefined;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await transport.getContext(salonSlug, controller.signal);
        if (session !== sessionRef.current || controller.signal.aborted) {
          return;
        }
        // A 404 is the intentional disabled-by-default state. Do not display
        // a disabled control or reveal the dark-launched feature.
        if (response.status === 404 || response.status === 403) {
          return;
        }
        if (!response.ok) {
          return;
        }
        const payload = await response.json() as ContextResponse;
        if (session === sessionRef.current) {
          setMenu(payload.data.menu);
          setEnabled(true);
        }
      } catch {
        // Context admission is deliberately silent: failed admission must not
        // turn a disabled, optional tool into a distracting dashboard error.
      }
    })();
    return () => controller.abort();
  }, [salonSlug, transport, clearConversation]);

  const needsSelection = useMemo(
    () => intent !== null && requiresNamedSelection(menu, intent),
    [intent, menu],
  );

  const prepare = useCallback(async (candidate: MenuOrderIntent, selected?: { sourceId?: string; targetId?: string }) => {
    if (!salonSlug || busy) {
      return;
    }
    const resolved = buildResolvedMenuOrder(menu, candidate, selected);
    if (!resolved) {
      setMessage(copy.chooseDifferent);
      return;
    }
    const requestKey = createIdempotencyKey();
    const session = sessionRef.current;
    setBusy('prepare');
    setMessage(null);
    setProposal(null);
    setReceipt(null);
    try {
      const response = await transport.post({
        salonSlug,
        action: 'prepare',
        idempotencyKey: requestKey,
        orderedIds: resolved.orderedIds,
      });
      if (session !== sessionRef.current) {
        return;
      }
      if (!response.ok) {
        if (response.status === 409 || response.status === 400) {
          setNeedsRefresh(true);
          throw new Error(copy.stale);
        }
        throw new Error(await readError(response));
      }
      if (session !== sessionRef.current) {
        return;
      }
      const payload = await response.json() as ActionResponse;
      if (session !== sessionRef.current) {
        return;
      }
      const nextProposal = payload.data.proposal;
      if (!nextProposal) {
        throw new Error(copy.noPreview);
      }
      setProposal(nextProposal);
      if (nextProposal.status === 'no_op') {
        setMessage(copy.noOp);
      }
    } catch (error) {
      if (session === sessionRef.current) {
        setMessage(error instanceof Error ? error.message : 'The menu preview could not be prepared. Try again.');
      }
    } finally {
      if (session === sessionRef.current) {
        setBusy(null);
      }
    }
  }, [busy, copy.chooseDifferent, copy.noOp, copy.noPreview, copy.stale, menu, salonSlug, transport]);

  const submitRequest = useCallback(() => {
    if (busy || needsRefresh || recoveringProposalId) {
      return;
    }
    const parsed = parseMenuOrderIntent(request);
    setProposal(null);
    setReceipt(null);
    setMessage(null);
    if (!parsed) {
      setIntent(null);
      setMessage(copy.invalid);
      return;
    }
    setIntent(parsed);
    setSourceId('');
    setTargetId('');
    if (requiresNamedSelection(menu, parsed)) {
      setMessage(copy.chooseNames);
      return;
    }
    void prepare(parsed);
  }, [busy, copy.chooseNames, copy.invalid, menu, needsRefresh, prepare, recoveringProposalId, request]);

  const apply = useCallback(async () => {
    if (!proposal || proposal.status !== 'ready' || !salonSlug || busy || needsRefresh) {
      return;
    }
    setBusy('apply');
    setMessage(null);
    const session = sessionRef.current;
    try {
      const response = await transport.post({
        salonSlug,
        action: 'apply',
        proposalId: proposal.id,
      });
      if (session !== sessionRef.current) {
        return;
      }
      if (!response.ok) {
        if (response.status === 409) {
          setNeedsRefresh(true);
          throw new Error(copy.stale);
        }
        throw new Error(await readError(response));
      }
      if (session !== sessionRef.current) {
        return;
      }
      const payload = await response.json() as ActionResponse;
      if (session !== sessionRef.current) {
        return;
      }
      if (!payload.data.receipt) {
        throw new Error(copy.noConfirmation);
      }
      setReceipt(payload.data.receipt);
      setRecoveringProposalId(null);
      setProposal(null);
      setMenu(payload.data.receipt.currentOrder ?? payload.data.receipt.newOrder ?? menu);
    } catch (error) {
      if (session === sessionRef.current) {
        setRecoveringProposalId(proposal.id);
        setMessage(error instanceof Error ? error.message : 'The menu change could not be applied. Try again.');
      }
    } finally {
      if (session === sessionRef.current) {
        setBusy(null);
      }
    }
  }, [busy, copy.noConfirmation, copy.stale, menu, needsRefresh, proposal, salonSlug, transport]);

  const undo = useCallback(async () => {
    if (!receipt || !salonSlug || busy || needsRefresh) {
      return;
    }
    setBusy('undo');
    setMessage(null);
    const session = sessionRef.current;
    try {
      const response = await transport.post({
        salonSlug,
        action: 'undo',
        proposalId: receipt.id,
      });
      if (session !== sessionRef.current) {
        return;
      }
      if (!response.ok) {
        if (response.status === 409) {
          setNeedsRefresh(true);
          throw new Error(copy.unsafeUndo);
        }
        throw new Error(await readError(response));
      }
      if (session !== sessionRef.current) {
        return;
      }
      const payload = await response.json() as ActionResponse;
      if (session !== sessionRef.current) {
        return;
      }
      const nextReceipt = payload.data.receipt;
      if (!nextReceipt) {
        throw new Error(copy.noUndoConfirmation);
      }
      setReceipt(nextReceipt);
      setRecoveringProposalId(null);
      if (nextReceipt.status === 'undo_unavailable') {
        setMessage(copy.undoUnavailable);
        return;
      }
      setMenu(nextReceipt.currentOrder ?? nextReceipt.newOrder ?? nextReceipt.oldOrder ?? menu);
    } catch (error) {
      if (session === sessionRef.current) {
        setRecoveringProposalId(receipt.id);
        setMessage(error instanceof Error ? error.message : 'The menu could not be restored. Try again.');
      }
    } finally {
      if (session === sessionRef.current) {
        setBusy(null);
      }
    }
  }, [busy, copy.noUndoConfirmation, copy.undoUnavailable, copy.unsafeUndo, menu, needsRefresh, receipt, salonSlug, transport]);

  const recover = useCallback(async () => {
    const proposalId = recoveringProposalId ?? proposal?.id ?? receipt?.id;
    if (!salonSlug || !proposalId || busy) {
      return;
    }
    const session = sessionRef.current;
    setBusy('apply');
    try {
      const response = await transport.getStatus(salonSlug, proposalId, new AbortController().signal);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      if (session !== sessionRef.current) {
        return;
      }
      const payload = await response.json() as ActionResponse;
      if (session !== sessionRef.current) {
        return;
      }
      if (payload.data.receipt) {
        setReceipt(payload.data.receipt);
        setProposal(null);
        setMenu(payload.data.receipt.currentOrder ?? payload.data.receipt.newOrder ?? menu);
      } else if (payload.data.proposal) {
        setProposal(payload.data.proposal);
      }
      setRecoveringProposalId(null);
      setMessage(null);
    } catch (error) {
      if (session === sessionRef.current) {
        setMessage(error instanceof Error ? error.message : 'The request status could not be checked.');
      }
    } finally {
      if (session === sessionRef.current) {
        setBusy(null);
      }
    }
  }, [busy, menu, proposal, receipt, recoveringProposalId, salonSlug, transport]);

  const refreshMenu = useCallback(async () => {
    if (!salonSlug || busy) {
      return;
    }
    const session = sessionRef.current;
    setBusy('prepare');
    try {
      const response = await transport.getContext(salonSlug, new AbortController().signal);
      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const payload = await response.json() as ContextResponse;
      if (session !== sessionRef.current) {
        return;
      }
      setMenu(payload.data.menu);
      setProposal(null);
      setReceipt(null);
      setRecoveringProposalId(null);
      setNeedsRefresh(false);
      setMessage(copy.refreshed);
    } catch (error) {
      if (session === sessionRef.current) {
        setMessage(error instanceof Error ? error.message : copy.refreshFailed);
      }
    } finally {
      if (session === sessionRef.current) {
        setBusy(null);
      }
    }
  }, [busy, copy.refreshed, copy.refreshFailed, salonSlug, transport]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <button
        aria-label={copy.open}
        className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-40 flex min-h-11 items-center gap-2 rounded-full bg-[var(--owner-accent)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg outline-none transition hover:bg-[var(--owner-accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2 sm:bottom-6 sm:right-6"
        data-testid="owner-menu-assistant-launcher"
        onClick={() => setOpen(true)}
        type="button"
      >
        <MessageCircle aria-hidden="true" size={18} />
        <span>{copy.launcher}</span>
      </button>

      <DialogShell
        contentClassName="max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-2xl bg-[var(--owner-surface)] p-5 shadow-2xl sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl"
        contentTestId="owner-menu-assistant-dialog"
        isOpen={open}
        maxWidthClassName="max-w-lg"
        onClose={closeConversation}
        alignClassName="items-end justify-center p-0 sm:items-center sm:p-4"
        overlayTestId="owner-menu-assistant-overlay"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="owner-title text-xl font-semibold text-[var(--owner-ink)]">{copy.title}</h2>
            <p className="mt-1 text-sm text-[var(--owner-muted)]">{copy.description}</p>
          </div>
          <button aria-label={copy.close} className="rounded-lg p-2 text-[var(--owner-muted)] focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]" onClick={closeConversation} type="button"><X aria-hidden="true" size={18} /></button>
        </div>

        <label className="mt-5 block text-sm font-medium text-[var(--owner-ink)]" htmlFor="owner-menu-assistant-request">{copy.prompt}</label>
        <div className="mt-2 flex gap-2">
          <input
            className="min-h-11 flex-1 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-ground)] px-3 text-sm text-[var(--owner-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
            id="owner-menu-assistant-request"
            onChange={event => setRequest(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitRequest();
              }
            }}
            placeholder={copy.placeholder}
            value={request}
          />
          <Button aria-label={copy.prepare} disabled={busy !== null || needsRefresh || recoveringProposalId !== null || request.trim().length === 0} onClick={submitRequest} type="button" variant="ownerPrimary"><Send aria-hidden="true" size={16} /></Button>
        </div>
        <p className="mt-2 text-xs text-[var(--owner-muted)]">{copy.supported}</p>

        {needsSelection && intent && (
          <div className="mt-4 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-ground)] p-3" data-testid="owner-menu-assistant-selection">
            <p className="text-sm font-medium text-[var(--owner-ink)]">{copy.chooseExact}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-[var(--owner-muted)]">
                {copy.move}
                <select className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--owner-line)] bg-[var(--owner-surface)] px-2 text-[var(--owner-ink)]" onChange={event => setSourceId(event.target.value)} value={sourceId}>
                  <option value="">{copy.selectService}</option>
                  {menu.map(service => <option key={service.id} value={service.id}>{serviceLabel(service, menu)}</option>)}
                </select>
              </label>
              <label className="text-sm text-[var(--owner-muted)]">
                {intent.placement === 'before' ? copy.before : copy.after}
                <select className="mt-1 block min-h-10 w-full rounded-lg border border-[var(--owner-line)] bg-[var(--owner-surface)] px-2 text-[var(--owner-ink)]" onChange={event => setTargetId(event.target.value)} value={targetId}>
                  <option value="">{copy.selectService}</option>
                  {menu.map(service => <option key={service.id} value={service.id}>{serviceLabel(service, menu)}</option>)}
                </select>
              </label>
            </div>
            <Button className="mt-3" disabled={!sourceId || !targetId || sourceId === targetId || busy !== null} onClick={() => void prepare(intent, { sourceId, targetId })} type="button" variant="ownerSecondary">{copy.preview}</Button>
          </div>
        )}

        {proposal && (
          <section className="mt-4 rounded-xl border border-[var(--owner-line)] p-4" data-testid="owner-menu-assistant-proposal">
            <h3 className="font-semibold text-[var(--owner-ink)]">{copy.review}</h3>
            <p className="mt-1 text-sm text-[var(--owner-muted)]">{copy.unchanged}</p>
            <p className="mt-1 text-sm text-[var(--owner-muted)]">{copy.menuScope}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <MenuPreview label={copy.current} services={proposal.oldOrder} />
              <MenuPreview label={copy.afterApplying} services={proposal.newOrder} />
            </div>
            {proposal.status === 'ready' && <Button className="mt-4" data-testid="owner-menu-assistant-apply" disabled={busy !== null || needsRefresh} onClick={() => void apply()} type="button" variant="ownerPrimary">{busy === 'apply' ? copy.applying : copy.apply}</Button>}
          </section>
        )}

        {receipt && (
          <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="owner-menu-assistant-receipt" role="status">
            <p className="font-semibold text-emerald-900">{receipt.status === 'undone' || receipt.status === 'already_undone' ? copy.restored : receipt.status === 'undo_unavailable' ? copy.unavailable : copy.updated}</p>
            {(receipt.status === 'applied' || receipt.status === 'already_applied') && (
              <Button className="mt-3" data-testid="owner-menu-assistant-undo" disabled={busy !== null || needsRefresh} onClick={() => void undo()} type="button" variant="ownerSecondary">
                <RotateCcw aria-hidden="true" size={16} />
                {busy === 'undo' ? copy.restoring : copy.undo}
              </Button>
            )}
          </section>
        )}

        {message && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="owner-menu-assistant-message" role="status">
            <p>{message}</p>
            {recoveringProposalId && !needsRefresh && (
              <Button className="mt-2" disabled={busy !== null} onClick={() => void recover()} type="button" variant="ownerSecondary">
                {copy.checkStatus}
              </Button>
            )}
            {needsRefresh && (
              <Button className="mt-2" disabled={busy !== null} onClick={() => void refreshMenu()} type="button" variant="ownerSecondary">
                {copy.refresh}
              </Button>
            )}
          </div>
        )}
      </DialogShell>
    </>
  );
}

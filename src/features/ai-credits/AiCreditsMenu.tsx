'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DialogShell } from '@/components/ui/dialog-shell';

import { AI_CREDIT_PACKS, type AiCreditPackKey, formatAiCredits, isAiCreditPackKey } from './catalog';
import { AI_CREDITS_CHANGED, aiCreditRequest, type AiCreditsOverview, safeAiCheckoutUrl } from './client';

type PurchaseResult = { data: { status: 'ready' | 'pending' | 'paid' | 'expired'; purchaseId?: string; url?: string } };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const historyLabels = { purchase: 'Credits added', usage: 'AI changes', reversal: 'Payment adjustment', recovery: 'Credits returned' };
const navigateToCheckout = (url: string) => window.location.assign(url);

export function AiCreditsMenu({ salonSlug, locale, onNavigate = navigateToCheckout, promptWhenEmpty = false }: { salonSlug: string; locale: string; onNavigate?: (url: string) => void; promptWhenEmpty?: boolean }) {
  const [open, setOpen] = useState(false);
  const [wallet, setWallet] = useState<AiCreditsOverview | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const attempts = useRef<Partial<Record<AiCreditPackKey, string>>>({});
  const storageKey = `luster-ai-credit-purchase:${salonSlug}`;

  const load = useCallback(async (signal?: AbortSignal) => {
    const value = await aiCreditRequest<AiCreditsOverview>(salonSlug, undefined, signal);
    if (!signal?.aborted) {
      setWallet(value);
    }
    return value;
  }, [salonSlug]);

  function clearAttempt() {
    attempts.current = {};
    try {
      localStorage.removeItem(storageKey);
    } catch { /* The server also retains the purchase attempt. */ }
  }

  function clearReturn() {
    const url = new URL(window.location.href);
    url.searchParams.delete('credits');
    url.searchParams.delete('purchase');
    window.history.replaceState(window.history.state, '', url);
  }

  // Only server confirmation resolves the return state. The query string is
  // a hint to check a payment, never evidence that it succeeded or was cancelled.
  const checkPayment = useCallback(async (purchaseId: string, poll = false) => {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setWorking(true);
    setError('');
    const request = new AbortController();
    controller.current = request;
    try {
      for (let attempt = 0; attempt < (poll ? 6 : 1); attempt++) {
        setNotice('Checking your payment…');
        const result = await aiCreditRequest<PurchaseResult>(salonSlug, { action: 'reconcile', purchaseId }, request.signal);
        await load(request.signal);
        if (request.signal.aborted) {
          return;
        }
        if (result.data.status === 'paid' || result.data.status === 'expired') {
          attempts.current = {};
          try {
            localStorage.removeItem(storageKey);
          } catch { /* Server records still provide recovery. */ }
          clearReturn();
          setNotice(result.data.status === 'paid' ? 'Payment confirmed. Your credit balance is updated.' : 'That checkout has ended. No credits were added.');
          return;
        }
        if (attempt < (poll ? 5 : 0)) {
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, 2000);
            request.signal.addEventListener('abort', () => {
              window.clearTimeout(timer);
              resolve();
            }, { once: true });
          });
        }
        if (request.signal.aborted) {
          return;
        }
      }
      setNotice('Your payment is still being checked. You can check again without making another payment.');
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Your payment could not be checked yet.');
        setNotice('Your saved website is safe. Please check this payment before starting another.');
      }
    } finally {
      if (controller.current === request) {
        if (!request.signal.aborted) {
          setWorking(false);
        }
        controller.current = null;
        lock.current = false;
      }
    }
  }, [load, salonSlug, storageKey]);

  useEffect(() => {
    const request = new AbortController();
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      attempts.current = Object.fromEntries(Object.entries(stored).filter(([key, value]) => isAiCreditPackKey(key) && typeof value === 'string' && uuid.test(value)));
    } catch {
      attempts.current = {};
    }
    const query = new URL(window.location.href).searchParams;
    const purchaseId = query.get('purchase');
    if (query.has('credits')) {
      setOpen(true);
    }
    void load(request.signal).then((value) => {
      if (!request.signal.aborted && promptWhenEmpty && value.data.availableMicroCad === 0 && value.data.reservedMicroCad === 0) {
        setOpen(true);
      }
      if (!request.signal.aborted && purchaseId && uuid.test(purchaseId)) {
        void checkPayment(purchaseId, true);
      }
    }).catch((cause) => {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Your credits could not be checked.');
      }
    });
    const refresh = () => {
      void load(request.signal).catch(() => { /* Keep the last verified balance until the next check. */ });
    };
    window.addEventListener(AI_CREDITS_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      request.abort();
      controller.current?.abort();
      window.removeEventListener(AI_CREDITS_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [checkPayment, load, storageKey, promptWhenEmpty]);

  async function buy(packKey: AiCreditPackKey) {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setWorking(true);
    setError('');
    setNotice('Opening secure checkout…');
    const request = new AbortController();
    controller.current = request;
    try {
      const operationId = attempts.current[packKey] ?? crypto.randomUUID();
      attempts.current[packKey] = operationId;
      try {
        localStorage.setItem(storageKey, JSON.stringify(attempts.current));
      } catch { /* The server resumes any active purchase for this owner. */ }
      const result = await aiCreditRequest<PurchaseResult>(salonSlug, { action: 'checkout', packKey, operationId, locale: locale === 'fr' ? 'fr' : 'en' }, request.signal);
      if (result.data.status === 'ready') {
        const url = safeAiCheckoutUrl(result.data.url);
        if (!url) {
          throw new Error('Secure checkout could not be opened. Your purchase is saved; please try again.');
        }
        onNavigate(url);
      } else {
        await load(request.signal);
        if (result.data.status === 'paid' || result.data.status === 'expired') {
          clearAttempt();
        }
        setNotice(result.data.status === 'paid' ? 'That payment is confirmed. Your balance is updated.' : result.data.status === 'expired' ? 'That checkout has ended. Choose a pack to start a new purchase.' : 'An earlier payment is being checked. Please avoid starting another payment.');
      }
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Checkout could not be opened.');
        setNotice('Try again to continue the same purchase.');
        await load(request.signal).catch(() => undefined);
      }
    } finally {
      if (controller.current === request) {
        if (!request.signal.aborted) {
          setWorking(false);
        }
        controller.current = null;
        lock.current = false;
      }
    }
  }

  async function cancel(purchaseId: string) {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setWorking(true);
    setError('');
    const request = new AbortController();
    controller.current = request;
    try {
      const result = await aiCreditRequest<PurchaseResult>(salonSlug, { action: 'cancel', purchaseId }, request.signal);
      await load(request.signal);
      if (result.data.status === 'expired' || result.data.status === 'paid') {
        clearAttempt();
        clearReturn();
      }
      setNotice(result.data.status === 'expired' ? 'Checkout cancelled. No credits were added.' : result.data.status === 'paid' ? 'Payment was already confirmed. Your balance is updated.' : 'Checkout is still being checked. Please avoid starting another payment.');
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Checkout could not be cancelled yet.');
      }
    } finally {
      if (controller.current === request) {
        if (!request.signal.aborted) {
          setWorking(false);
        }
        controller.current = null;
        lock.current = false;
      }
    }
  }

  const pending = wallet?.data.pendingPurchase;
  return (
    <>
      <button type="button" className="setup-credit-trigger" onClick={() => setOpen(true)}>
        AI credits
        {wallet ? ` · ${formatAiCredits(wallet.data.availableMicroCad)}` : ''}
      </button>
      <DialogShell isOpen={open} onClose={() => setOpen(false)} initialFocusRef={closeRef} maxWidthClassName="max-w-lg">
        <section role="dialog" aria-modal="true" aria-labelledby="ai-credits-title" className="luster-ai-credits">
          <div className="ai-credit-heading">
            <div>
              <span className="ai-credit-eyebrow">LUSTER AI</span>
              <h2 id="ai-credits-title">Bring your ideas to life.</h2>
            </div>
            <button ref={closeRef} type="button" aria-label="Close AI credits" onClick={() => setOpen(false)}>×</button>
          </div>
          <p>Design your website. Update services, prices, appointment lengths, hours, and booking settings. Review changes before they go live.</p>
          <div className="ai-credit-balance">
            <span>AI credits available</span>
            <strong>{wallet ? formatAiCredits(wallet.data.availableMicroCad) : 'Checking…'}</strong>
            <span>CAD</span>
          </div>
          {Boolean(wallet?.data.reservedMicroCad) && (
            <p>
              {formatAiCredits(wallet!.data.reservedMicroCad)}
              {' '}
              is set aside for AI work in progress. Unused credits return to your balance.
            </p>
          )}
          {Boolean(wallet?.data.debtMicroCad) && (
            <p>
              An earlier payment was reversed.
              {formatAiCredits(wallet!.data.debtMicroCad)}
              {' '}
              of your next top-up covers that adjustment.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status" aria-live="polite">{notice}</p>}
          {!wallet && <button type="button" onClick={() => void load().then(() => setError('')).catch(cause => setError(cause.message))}>Check balance again</button>}
          {pending && (
            <div className="ai-credit-pending">
              <p>You have a credit purchase in progress.</p>
              <button type="button" disabled={working} onClick={() => void checkPayment(pending.id)}>Check payment</button>
              {pending.canManage
                ? (
                    <>
                      <button type="button" disabled={working || !wallet?.purchasesEnabled} onClick={() => void buy(pending.packKey)}>Continue checkout</button>
                      <button type="button" disabled={working} onClick={() => void cancel(pending.id)}>Cancel checkout</button>
                    </>
                  )
                : <p>The owner who started it can continue or cancel checkout.</p>}
            </div>
          )}
          {wallet?.purchasesEnabled && !pending && (
            <div className="ai-credit-packs" aria-label="Choose AI credits">
              {Object.values(AI_CREDIT_PACKS).map(pack => (
                <button key={pack.key} type="button" disabled={working} onClick={() => void buy(pack.key)}>
                  <strong>{formatAiCredits(pack.creditMicroCad)}</strong>
                  <span>CAD · one-time</span>
                  {pack.key === 'ai_10_cad_v1' && <span>Start here</span>}
                </button>
              ))}
            </div>
          )}
          {wallet && !wallet.purchasesEnabled && <p>Credit purchases are not available yet. Your existing balance, saved website, and bookings are safe.</p>}
          <p className="ai-credit-small">Every pack includes the same AI features. Usage depends on your requests. Credits do not expire. Ordinary bookings and manual editing do not use AI credits.</p>
          {Boolean(wallet?.data.history.length) && (
            <details>
              <summary>Credit history</summary>
              <ul>
                {wallet!.data.history.map(item => (
                  <li key={item.id}>
                    <span>
                      {historyLabels[item.kind]}
                      <small>{new Date(item.createdAt).toLocaleDateString('en-CA')}</small>
                    </span>
                    <strong>
                      {item.amountMicroCad > 0 ? '+' : '−'}
                      {Math.abs(item.amountMicroCad) > 0 && Math.abs(item.amountMicroCad) < 10_000 ? 'less than $0.01' : formatAiCredits(Math.abs(item.amountMicroCad))}
                    </strong>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </DialogShell>
    </>
  );
}

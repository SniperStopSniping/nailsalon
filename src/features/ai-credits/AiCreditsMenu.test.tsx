import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AiCreditsMenu } from './AiCreditsMenu';
import { AI_CREDITS_CHANGED, type AiCreditsOverview, safeAiCheckoutUrl } from './client';

const purchaseId = '98f1e8de-fd2e-4a63-a5c7-c66e9d0d2751';
let wallet: AiCreditsOverview;
let calls: any[];
let payment: 'pending' | 'paid' | 'expired';
let checkoutError: boolean;
let checkoutUrl: string;
const navigate = vi.fn();

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/admin/business-setup?salon=synthetic');
  calls = [];
  payment = 'pending';
  checkoutError = false;
  checkoutUrl = 'https://checkout.stripe.com/c/pay/synthetic';
  navigate.mockClear();
  wallet = { purchasesEnabled: true, data: { availableMicroCad: 10_000_000, reservedMicroCad: 0, debtMicroCad: 0, pendingPurchase: null, history: [] } };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.body) {
      return Response.json(wallet);
    }
    const body = JSON.parse(String(options.body));
    calls.push(body);
    if (body.action === 'checkout') {
      if (checkoutError) {
        throw new TypeError('Network connection lost');
      }
      return Response.json({ data: { status: 'ready', url: checkoutUrl, purchaseId } });
    }
    if (body.action === 'cancel') {
      wallet.data.pendingPurchase = null;
      return Response.json({ data: { status: 'expired', purchaseId } });
    }
    if (payment === 'paid') {
      wallet.data.availableMicroCad = 20_000_000;
      wallet.data.pendingPurchase = null;
    }
    return Response.json({ data: { status: payment, purchaseId } });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function open() {
  render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} />);
  await screen.findByRole('button', { name: 'AI credits · $10.00' });
  fireEvent.click(screen.getByRole('button', { name: 'AI credits · $10.00' }));
  return screen.findByRole('dialog', { name: 'Bring your ideas to life.' });
}

it('shows the balance, fixed packs and feature scope without charging or starting checkout', async () => {
  const dialog = await open();

  expect(within(dialog).getByRole('button', { name: '$10.00 CAD · one-time Start here' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '$20.00 CAD · one-time' })).toBeInTheDocument();
  expect(within(dialog).getByText(/Ordinary bookings and manual editing/)).toBeInTheDocument();
  expect(calls).toEqual([]);
});

it('offers the credit choice before an unfunded owner tries a paid request, without starting checkout', async () => {
  wallet.data.availableMicroCad = 0;
  render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} promptWhenEmpty />);
  await screen.findByRole('dialog', { name: 'Bring your ideas to life.' });

  expect(calls).toEqual([]);
  expect(navigate).not.toHaveBeenCalled();
});

it('shows a tiny measured charge without pretending it was zero', async () => {
  wallet.data.history = [{ id: 'tiny', kind: 'usage', amountMicroCad: -98, createdAt: '2026-10-17T12:00:00Z' }];
  await open();
  fireEvent.click(screen.getByText('Credit history'));

  expect(screen.getByText('−less than $0.01')).toBeInTheDocument();
});

it('labels a temporary hold and refreshes the closed credit strip after work finishes', async () => {
  vi.useFakeTimers();
  wallet.data.availableMicroCad = 8_000_000;
  wallet.data.reservedMicroCad = 2_000_000;
  await act(async () => {
    render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} />);
  });

  expect(screen.getByRole('button', { name: 'AI credits · $8.00 available · $2.00 set aside' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  wallet.data.availableMicroCad = 9_986_265;
  wallet.data.reservedMicroCad = 0;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });

  expect(screen.getByRole('button', { name: 'AI credits · $9.99' })).toBeInTheDocument();

  const requests = vi.mocked(fetch).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
  expect(calls).toEqual([]);
});

it('bounds automatic hold checks without starting a purchase or another AI request', async () => {
  vi.useFakeTimers();
  wallet.data.availableMicroCad = 8_000_000;
  wallet.data.reservedMicroCad = 2_000_000;
  await act(async () => {
    render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(610_000);
  });
  const requests = vi.mocked(fetch).mock.calls.length;

  expect(requests).toBe(61);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });

  expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
  expect(calls).toEqual([]);
  expect(navigate).not.toHaveBeenCalled();
});

it('does not let an older balance response replace a newer confirmed balance', async () => {
  render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} />);
  await screen.findByRole('button', { name: 'AI credits · $10.00' });
  let resolveOld!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => {
    resolveOld = resolve;
  }));
  fireEvent.focus(window);
  wallet.data.availableMicroCad = 20_000_000;
  fireEvent.focus(window);
  await screen.findByRole('button', { name: 'AI credits · $20.00' });
  await act(async () => {
    resolveOld(Response.json({ ...wallet, data: { ...wallet.data, availableMicroCad: 1_000_000 } }));
  });

  expect(screen.getByRole('button', { name: 'AI credits · $20.00' })).toBeInTheDocument();
});

it('aborts a pending hold check and stops polling when the credit strip unmounts', async () => {
  vi.useFakeTimers();
  wallet.data.availableMicroCad = 8_000_000;
  wallet.data.reservedMicroCad = 2_000_000;
  let resolvePending!: (response: Response) => void;
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} />);
  });
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => {
    resolvePending = resolve;
  }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });

  expect(vi.mocked(fetch).mock.calls).toHaveLength(2);

  const request = vi.mocked(fetch).mock.calls.at(-1)![1];
  const requests = vi.mocked(fetch).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);

  view.unmount();

  expect(request?.signal?.aborted).toBe(true);

  await act(async () => {
    resolvePending(Response.json(wallet));
    await vi.advanceTimersByTimeAsync(30_000);
  });

  expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
});

it('does not display another salon’s cached or late-returning balance', async () => {
  const view = render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} />);
  await screen.findByRole('button', { name: 'AI credits · $10.00' });
  let resolveOld!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => {
    resolveOld = resolve;
  }));
  fireEvent.focus(window);
  wallet.data.availableMicroCad = 3_000_000;
  view.rerender(<AiCreditsMenu salonSlug="another" locale="en" onNavigate={navigate} />);
  await screen.findByRole('button', { name: 'AI credits · $3.00' });
  await act(async () => {
    resolveOld(Response.json({ ...wallet, data: { ...wallet.data, availableMicroCad: 1_000_000 } }));
  });

  expect(screen.getByRole('button', { name: 'AI credits · $3.00' })).toBeInTheDocument();
  expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).toContain('salonSlug=another');
});

it('opens only a server-provided Stripe checkout without passing client amounts or credentials', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: '$10.00 CAD · one-time Start here' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(checkoutUrl));

  expect(calls[0]).toEqual({ salonSlug: 'synthetic', action: 'checkout', packKey: 'ai_10_cad_v1', operationId: expect.any(String), locale: 'en' });
  expect(JSON.stringify(localStorage)).not.toContain('stripe.com');
});

it('retains one operation across a lost checkout response, refresh and retry', async () => {
  checkoutError = true;
  await open();
  fireEvent.click(screen.getByRole('button', { name: '$10.00 CAD · one-time Start here' }));
  await screen.findByRole('alert');
  const operationId = calls[0].operationId;
  cleanup();
  checkoutError = false;
  await open();
  fireEvent.click(screen.getByRole('button', { name: '$10.00 CAD · one-time Start here' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));

  expect(calls[1].operationId).toBe(operationId);
});

it('ignores payment-success text until the server verifies the purchase', async () => {
  window.history.replaceState({}, '', `/admin/business-setup?salon=synthetic&credits=success&purchase=${purchaseId}`);
  wallet.data.pendingPurchase = { id: purchaseId, packKey: 'ai_10_cad_v1', canManage: true };
  payment = 'expired';
  render(<AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={navigate} />);

  await screen.findByText('That checkout has ended. No credits were added.');

  expect(screen.queryByText(/Payment confirmed/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'AI credits · $10.00' })).toBeInTheDocument();
  expect(calls[0]).toEqual({ salonSlug: 'synthetic', action: 'reconcile', purchaseId });
  expect(window.location.search).not.toContain('credits=');
});

it('resumes an unfinished purchase from the server on another device and checks it without buying again', async () => {
  wallet.data.pendingPurchase = { id: purchaseId, packKey: 'ai_10_cad_v1', canManage: true };
  await open();

  expect(screen.queryByRole('button', { name: '$10.00 CAD · one-time Start here' })).not.toBeInTheDocument();

  payment = 'paid';
  fireEvent.click(screen.getByRole('button', { name: 'Check payment' }));
  await screen.findByText('Payment confirmed. Your credit balance is updated.');

  expect(screen.getByRole('button', { name: 'AI credits · $20.00' })).toBeInTheDocument();
  expect(calls.map(body => body.action)).toEqual(['reconcile']);
});

it('keeps purchasing disabled while preserving the balance and history', async () => {
  wallet.purchasesEnabled = false;
  wallet.data.history = [{ id: 'history', kind: 'usage', amountMicroCad: -15000, createdAt: '2026-10-17T12:00:00Z' }];
  await open();

  expect(screen.getByText(/Credit purchases are not available yet/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '$10.00 CAD · one-time Start here' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Credit history'));

  expect(screen.getByText('AI changes')).toBeInTheDocument();
  expect(calls).toEqual([]);
});

it('does not expose another owner’s cancel/continue controls and refreshes after usage', async () => {
  wallet.data.pendingPurchase = { id: purchaseId, packKey: 'ai_10_cad_v1', canManage: false };
  await open();

  expect(screen.queryByRole('button', { name: 'Cancel checkout' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue checkout' })).not.toBeInTheDocument();

  wallet.data.availableMicroCad = 9_500_000;
  act(() => window.dispatchEvent(new Event(AI_CREDITS_CHANGED)));

  await screen.findByRole('button', { name: 'AI credits · $9.50' });
});

it('verifies cancellation on the server and never grants credits from cancelling', async () => {
  wallet.data.pendingPurchase = { id: purchaseId, packKey: 'ai_10_cad_v1', canManage: true };
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel checkout' }));
  await screen.findByText('Checkout cancelled. No credits were added.');

  expect(calls).toEqual([{ salonSlug: 'synthetic', action: 'cancel', purchaseId }]);
  expect(screen.getByRole('button', { name: 'AI credits · $10.00' })).toBeInTheDocument();
});

it('rejects unsafe checkout redirects and can close without losing saved credit state', async () => {
  checkoutUrl = 'https://evil.invalid/fake-checkout';
  await open();
  fireEvent.click(screen.getByRole('button', { name: '$10.00 CAD · one-time Start here' }));
  await screen.findByRole('alert');

  expect(navigate).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Close AI credits' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it.each(['javascript:alert(1)', 'https://checkout.stripe.com.evil.invalid/pay', 'https://checkout.stripe.com@evil.invalid', 'http://checkout.stripe.com', 'https://checkout.stripe.com:123/pay'])('rejects a non-Stripe navigation: %s', (value) => {
  expect(safeAiCheckoutUrl(value)).toBeNull();
});

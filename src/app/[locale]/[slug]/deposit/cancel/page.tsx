import { DepositStatusPanel } from '../DepositStatusPanel';

/**
 * Stripe's `cancel_url` target — one of the four durable re-entry paths.
 *
 * It works only because `cancel_url` carries the `{CHECKOUT_SESSION_ID}`
 * template too: without it this page would arrive with no query parameter at
 * all, and could neither render the hold expiry nor produce the resume link.
 */
export default function DepositCancelPage() {
  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#fbf6f1] px-4 py-14">
      <div className="mx-auto max-w-md">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-rose-700">Booking deposit</p>
        <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-7 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Your slot is still held</h1>
          <DepositStatusPanel variant="cancel" />
        </div>
      </div>
    </main>
  );
}

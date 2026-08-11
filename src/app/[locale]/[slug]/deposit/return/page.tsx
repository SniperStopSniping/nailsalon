import { DepositStatusPanel } from '../DepositStatusPanel';

/**
 * Stripe's `success_url` target.
 *
 * IN THE TENANT TREE deliberately. A page under `[locale]/(unauth)/deposit/...`
 * would 404 for every shared-host salon AFTER a real client had already paid.
 */
export default function DepositReturnPage() {
  return (
    <main className="min-h-[calc(100vh-60px)] bg-[#fbf6f1] px-4 py-14">
      <div className="mx-auto max-w-md">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-rose-700">Booking deposit</p>
        <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-7 shadow-sm">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Thank you</h1>
          <DepositStatusPanel variant="return" />
        </div>
      </div>
    </main>
  );
}

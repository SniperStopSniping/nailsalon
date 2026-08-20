import { DepositStatusPanel } from '../DepositStatusPanel';

/**
 * Stripe's `success_url` target.
 *
 * IN THE TENANT TREE deliberately. A page under `[locale]/(unauth)/deposit/...`
 * would 404 for every shared-host salon AFTER a real client had already paid.
 *
 * S3 (Stage 1) — DELIBERATELY NOT publication-gated, and this is the recorded
 * exemption. Two reasons, both repository-grounded:
 *
 *  1. It is a durable Stripe re-entry target. Gating it on publication would
 *     404 a client who has ALREADY PAID if the salon were unpublished between
 *     checkout and return — the exact failure the in-tree placement above
 *     exists to prevent, and the same principle that keeps capability-token
 *     routes ungated.
 *  2. It exposes NO salon data to gate. The page takes no salon props and
 *     renders no salon field; every value shown is fetched client-side by
 *     `DepositStatusPanel` from `/api/public/deposits/session-status`, keyed on
 *     the Stripe `session_id` — a capability the visitor must already hold.
 *
 * Pinned by the class-E cases in `stage1.routeTaxonomy.test.ts`.
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

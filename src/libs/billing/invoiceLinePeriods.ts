/**
 * R-6: ONE reading of "what period did this invoice actually pay for".
 *
 * Both the webhook (`invoice.payment_succeeded`, full subscription refunds)
 * and the hourly reconcile used to derive coverage with their own inline
 * min/max over `invoice.lines.data`. That reading was wrong in two ways that
 * money depends on:
 *
 *   1. It counted EVERY line. A renewal invoice routinely carries a
 *      proration line for the PREVIOUS (possibly refunded) cycle alongside
 *      the subscription line for the new one; taking `min(period.start)`
 *      across both dragged the paid window back into refunded territory and
 *      made a legitimate renewal read as refunded coverage forever.
 *   2. A truncated line page (`has_more`) was treated as if the visible
 *      lines were the whole invoice — silently narrowing coverage instead of
 *      admitting the bounds are unknown.
 *
 * So coverage is now an explicit three-state answer: `ok` with half-open
 * bounds, `no_subscription_lines` (the invoice is real but bills no
 * non-proration subscription line for THIS subscription — proration-only or
 * invoice-item-only), or `unknown` (the line set could not be read at all).
 * Callers must decide deliberately for each kind; none of them may guess.
 */
import 'server-only';

import type Stripe from 'stripe';

import { stripe } from '@/libs/stripe';

export type SubscriptionCoverage =
  | { kind: 'ok'; start: Date; end: Date }
  | { kind: 'no_subscription_lines' }
  | { kind: 'unknown' };

/**
 * `line.subscription` is `string | Subscription | null`. Stripe leaves it
 * null on the lines of a subscription's OWN invoice (the link is implied by
 * the invoice), so null means "this invoice's subscription", never "some
 * other subscription".
 */
function lineSubscriptionId(line: Stripe.InvoiceLineItem, invoiceSubscriptionId: string): string {
  const raw = line.subscription;
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw !== null && raw !== undefined && typeof raw === 'object') {
    return raw.id;
  }
  return invoiceSubscriptionId;
}

/**
 * The half-open coverage the NON-PRORATION subscription lines of
 * `subscriptionId` describe: `min(period.start)` … `max(period.end)`.
 *
 * `undefined`/`null` lines are `unknown` — the caller could not read the
 * line set and must hold, never assume. A readable line set with no
 * qualifying line is `no_subscription_lines`, which is a different (and
 * far more common) situation: a proration-only credit invoice, or an
 * invoice-item-only charge.
 */
export function subscriptionLinePeriods(
  lines: Stripe.InvoiceLineItem[] | undefined | null,
  subscriptionId: string,
): SubscriptionCoverage {
  if (lines === undefined || lines === null) {
    return { kind: 'unknown' };
  }

  let start: number | null = null;
  let end: number | null = null;
  for (const line of lines) {
    if (line.type !== 'subscription' || line.proration === true) {
      continue;
    }
    if (lineSubscriptionId(line, subscriptionId) !== subscriptionId) {
      continue;
    }
    const lineStart = line.period?.start ?? 0;
    const lineEnd = line.period?.end ?? 0;
    if (lineStart <= 0 || lineEnd <= 0) {
      continue;
    }
    start = start === null ? lineStart : Math.min(start, lineStart);
    end = end === null ? lineEnd : Math.max(end, lineEnd);
  }

  if (start === null || end === null) {
    return { kind: 'no_subscription_lines' };
  }
  // Degenerate bounds are deliberately still `ok`: the writers reject them
  // (REFUND_COVERAGE_INVALID / INVALID_PAID_PERIOD) with zero writes, and
  // that anomaly is more informative than collapsing it into "no lines".
  return { kind: 'ok', start: new Date(start * 1000), end: new Date(end * 1000) };
}

/**
 * The invoice's COMPLETE line set.
 *
 * `invoice.lines` is a truncated page: Stripe embeds only the first handful
 * and sets `has_more`. Only then is the extra API call made; the common case
 * costs nothing.
 *
 * A Stripe failure while paging PROPAGATES. It is a transient infrastructure
 * problem, not a fact about the invoice, and the two are not interchangeable:
 * swallowing it into `null` (⇒ `unknown` coverage) made the caller hold the
 * event TERMINALLY — no retry, and for the payment path no operator exit
 * either, so one rate-limited minute could strand a paid invoice forever.
 * Thrown, the webhook route's own catch marks the event `failed_retryable`
 * and Stripe redelivers, bounded by the 8-attempt poison ladder. The
 * reconcile route has TWO callers with different needs: its drift comparison
 * reads `invoice.lines.data` directly and never pages, while (PR-6a) its
 * refund-evidence re-assert DOES page through this helper — a throw there is
 * caught per invoice and recorded as `refund_evidence_unverifiable`, so one
 * unreadable invoice can never abort the pass.
 *
 * `null` is therefore reserved for STRUCTURALLY unreadable input: no
 * `lines.data` array at all, or a truncated page on an invoice with no id to
 * page against. Those are facts about the object, and retrying cannot change
 * them.
 */
export async function loadInvoiceLines(invoice: Stripe.Invoice): Promise<Stripe.InvoiceLineItem[] | null> {
  const page = invoice.lines as Stripe.ApiList<Stripe.InvoiceLineItem> | undefined | null;
  const data = page?.data;
  if (!Array.isArray(data)) {
    return null;
  }
  if (page?.has_more !== true) {
    return data;
  }
  if (typeof invoice.id !== 'string' || invoice.id.length === 0) {
    return null;
  }
  return stripe.invoices
    .listLineItems(invoice.id, { limit: 100 })
    .autoPagingToArray({ limit: 1000 });
}

import 'server-only';

import { inArray } from 'drizzle-orm';

import type { CustomerPaymentCapture } from '@/models/customerPaymentSchema';

import { isCustomerPaymentLedgerTestEnabled } from '../ledgerTestGate';
import type { OfflineFixtureCaptureEvidence } from '../provenance';
import { providerCorrelationFingerprint } from '../provider/correlation';

type Reader = { select: (fields?: Record<string, unknown>) => any };
const fail = (): never => {
  throw new Error('CUSTOMER_PAYMENT_PROVENANCE_RECONCILIATION_REQUIRED');
};

/** Reads immutable bindings, not permission to write. Legacy sources never touch 0124. */
export async function readOfflineFixtureCaptureEvidence(database: Reader, captures: readonly CustomerPaymentCapture[]): Promise<OfflineFixtureCaptureEvidence[]> {
  const fixtures = captures.filter(capture => capture.source === 'offline_fixture_test');
  if (fixtures.length === 0) {
    return [];
  }
  if (process.env.NODE_ENV !== 'test' || !isCustomerPaymentLedgerTestEnabled()) {
    fail();
  }
  const { customerPaymentFixtureApplicationSchema: applications, customerPaymentFixtureHoldSchema: holds, customerPaymentFixturePlatformSchema: platforms } = await import('@/models/customerPaymentFixtureApplicationSchema');
  const { customerPaymentPreparedQuoteSchema: quotes } = await import('@/models/customerPaymentSchema');
  const bindings = await database.select().from(applications).where(inArray(applications.captureId, fixtures.map(capture => capture.id)));
  if (!Array.isArray(bindings) || bindings.length !== fixtures.length) {
    fail();
  }
  for (const binding of bindings) {
    if (providerCorrelationFingerprint(binding.sourceEvidence) !== binding.sourceRevision
      || providerCorrelationFingerprint(binding.ownershipEvidence) !== binding.ownershipRevision) {
      fail();
    }
  }
  const quoteRows = await database.select().from(quotes).where(inArray(quotes.id, bindings.map((binding: typeof applications.$inferSelect) => binding.quoteId)));
  const holdRows = await database.select().from(holds).where(inArray(holds.applicationId, bindings.map((binding: typeof applications.$inferSelect) => binding.id)));
  // Read revision last: a newly committed invalidation cannot disappear because
  // its hold was not yet visible to the preceding statement. Mutation paths also
  // require the SQL admission fence; this read alone is not a concurrency lock.
  const platformRows = await database.select().from(platforms).where(inArray(platforms.platformId, bindings.map((binding: typeof applications.$inferSelect) => binding.platformId)));
  if (!Array.isArray(quoteRows) || !Array.isArray(holdRows) || !Array.isArray(platformRows)) {
    fail();
  }
  return fixtures.map((capture) => {
    const matches = bindings.filter((binding: typeof applications.$inferSelect) => binding.captureId === capture.id);
    if (matches.length !== 1) {
      fail();
    }
    const application = matches[0] as typeof applications.$inferSelect;
    const matchingQuotes = quoteRows.filter((quote: typeof quotes.$inferSelect) => quote.id === application.quoteId);
    const matchingPlatforms = platformRows.filter((platform: typeof platforms.$inferSelect) => platform.platformId === application.platformId);
    if (matchingQuotes.length !== 1 || matchingPlatforms.length !== 1) {
      fail();
    }
    return { application, quote: matchingQuotes[0], currentPlatformRevision: matchingPlatforms[0].revision, holds: holdRows.filter((hold: typeof holds.$inferSelect) => hold.applicationId === application.id) };
  });
}

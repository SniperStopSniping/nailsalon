import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { db } from '@/libs/DB';
import { customerPaymentCorrelationMutexSchema as mutex } from '@/models/customerPaymentCorrelationSchema';
import { customerPaymentFixtureAdmissionSchema as admission, customerPaymentFixturePlatformSchema as platforms } from '@/models/customerPaymentFixtureApplicationSchema';

import { requireCustomerPaymentProviderFixtureEnabled } from '../providerTestGate';

type Database = Pick<typeof db, 'select' | 'transaction'>;
export type ProviderFixtureTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const platformSchema = z.string().max(255).regex(/^acct_[A-Za-z0-9]+$/);

/** Entire local fixture callback retries, never a network/provider dispatch. */
export async function withProviderFixtureTransaction<T>(database: Database, callback: (tx: ProviderFixtureTransaction) => Promise<T>): Promise<T> {
  requireCustomerPaymentProviderFixtureEnabled();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.transaction(async (tx) => {
        const locked = await tx.select().from(admission).where(eq(admission.id, 1)).for('update', { noWait: true });
        if (locked.length !== 1) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_ADMISSION_MISSING');
        }
        const changed = await tx.update(admission).set({ revision: sql`${admission.revision} + 1` }).where(eq(admission.id, 1)).returning();
        if (changed.length !== 1) {
          throw new Error('CUSTOMER_PAYMENT_FIXTURE_ADMISSION_WRITE_FAILED');
        }
        const correlationLock = await tx.select().from(mutex).where(eq(mutex.id, 1)).for('update', { noWait: true });
        if (correlationLock.length !== 1) {
          throw new Error('CUSTOMER_PAYMENT_CORRELATION_MUTEX_MISSING');
        }
        return callback(tx);
      }, { isolationLevel: 'repeatable read' });
    } catch (error) {
      const failure = error as { code?: string; cause?: { code?: string } };
      if (attempt >= 3 || !['55P03', '40001', '40P01'].includes(failure.cause?.code ?? failure.code ?? '')) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}

/** Caller must use the admission-first transaction; raw SQL trigger enforces it. */
export async function lockProviderFixturePlatform(tx: ProviderFixtureTransaction, platformId: string) {
  requireCustomerPaymentProviderFixtureEnabled();
  platformSchema.parse(platformId);
  const admissionLock = await tx.select().from(admission).where(eq(admission.id, 1)).for('update', { noWait: true });
  if (admissionLock.length !== 1) {
    throw new Error('CUSTOMER_PAYMENT_FIXTURE_ADMISSION_MISSING');
  }
  await tx.insert(platforms).values({ platformId, revision: 0 }).onConflictDoNothing();
  const [platform] = await tx.select().from(platforms).where(eq(platforms.platformId, platformId)).for('update', { noWait: true });
  if (!platform || !Number.isSafeInteger(platform.revision) || platform.revision < 0) {
    throw new Error('CUSTOMER_PAYMENT_FIXTURE_PLATFORM_MISSING');
  }
  return platform;
}

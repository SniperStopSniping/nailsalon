import 'server-only';

import { isDeepStrictEqual } from 'node:util';

import { and, eq } from 'drizzle-orm';

import { salonLocationSchema, salonSchema } from '@/models/Schema';

import type { CustomerBookingMaterial } from './bookingOperationContracts';
import { CustomerBookingOperationError, type CustomerBookingTransaction } from './operationStore.server';
import { resolveCustomerReviewLocation } from './reviewLocation';

/** The same privacy projection as preparation, now on the creation snapshot. */
export async function validateCustomerReviewLocationInTx(tx: CustomerBookingTransaction, salonId: string, material: CustomerBookingMaterial) {
  const [salon] = await tx.select({ id: salonSchema.id, slug: salonSchema.slug, name: salonSchema.name, settings: salonSchema.settings, address: salonSchema.address, city: salonSchema.city, state: salonSchema.state, zipCode: salonSchema.zipCode, businessHours: salonSchema.businessHours, isActive: salonSchema.isActive, publicationStatus: salonSchema.publicationStatus })
    .from(salonSchema).where(eq(salonSchema.id, salonId)).limit(1);
  if (!salon || !salon.isActive || salon.publicationStatus !== 'published' || !isDeepStrictEqual(material.review.salon, { id: salon.id, slug: salon.slug, name: salon.name })) {
    throw new CustomerBookingOperationError('review_changed');
  }
  if (material.locationId) {
    const [requested] = await tx.select().from(salonLocationSchema).where(and(eq(salonLocationSchema.id, material.locationId), eq(salonLocationSchema.salonId, salonId), eq(salonLocationSchema.isActive, true))).limit(1);
    if (!requested || !isDeepStrictEqual(material.review.location, resolveCustomerReviewLocation(salon, requested))) {
      throw new CustomerBookingOperationError('review_changed');
    }
    return { location: requested, salonBusinessHours: salon.businessHours };
  }
  const [primary] = await tx.select().from(salonLocationSchema).where(and(eq(salonLocationSchema.salonId, salonId), eq(salonLocationSchema.isPrimary, true), eq(salonLocationSchema.isActive, true))).limit(1);
  const [fallback] = primary ? [] : await tx.select().from(salonLocationSchema).where(and(eq(salonLocationSchema.salonId, salonId), eq(salonLocationSchema.isActive, true))).limit(1);
  if (!isDeepStrictEqual(material.review.location, resolveCustomerReviewLocation(salon, primary ?? fallback ?? null))) {
    throw new CustomerBookingOperationError('review_changed');
  }
  return { location: primary ?? fallback ?? null, salonBusinessHours: salon.businessHours };
}

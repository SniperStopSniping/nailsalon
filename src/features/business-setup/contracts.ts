import { z } from 'zod';

import { designBriefSchema } from '@/features/custom-sites/contracts';
import { bookingConfigSchema } from '@/libs/bookingConfig.shared';
import type { resolveBookingExperience } from '@/libs/bookingExperience';
import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import type { BookingPageContentSide } from '@/libs/bookingPageContent';
import { CUSTOMER_SITE_PALETTE_PRESETS, CUSTOMER_SITE_STYLE_PRESETS } from '@/libs/customerSitePresentation';
import { BOOKING_CATEGORIES, SERVICE_CATEGORIES } from '@/models/serviceCatalogTypes';

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u);
const interval = z.object({ open: time, close: time }).strict().refine(v => v.open < v.close, 'Closing time must be after opening time.');
export const hoursSchema = z.object({
  monday: interval.nullable(),
  tuesday: interval.nullable(),
  wednesday: interval.nullable(),
  thursday: interval.nullable(),
  friday: interval.nullable(),
  saturday: interval.nullable(),
  sunday: interval.nullable(),
}).strict();
export type SetupHours = z.infer<typeof hoursSchema>;
export const CLOSED_HOURS: SetupHours = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null };
const id = z.string().min(1).max(100);
export const setupServiceSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable(),
  priceCents: z.number().int().min(0).max(100000000).nullable(),
  durationMinutes: z.number().int().min(5).max(480).nullable(),
  preparationBufferMinutes: z.number().int().min(0).max(120),
  cleanupBufferMinutes: z.number().int().min(0).max(120),
  category: z.enum(SERVICE_CATEGORIES),
  bookingCategory: z.enum(BOOKING_CATEGORIES),
}).strict();
export type SetupService = z.infer<typeof setupServiceSchema> & {
  origin: 'existing' | 'owner' | 'assistant' | 'upload';
  confirmed: boolean;
};
export const businessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().max(120),
  exactAddress: z.string().trim().max(500),
  homeBased: z.boolean(),
  workMode: z.enum(['solo', 'team', 'unknown']).default('unknown'),
  locationDisplayMode: z.enum(['full_address', 'after_booking', 'city_only']),
}).strict();
export const setupOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('design_brief'), values: designBriefSchema }).strict(),
  z.object({ type: z.literal('custom_frontend'), artifactId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('business'), values: businessSchema.partial() }).strict(),
  z.object({ type: z.literal('hours'), values: hoursSchema }).strict(),
  z.object({ type: z.literal('booking'), values: bookingConfigSchema.pick({ currency: true, timezone: true, minimumNoticeMinutes: true, bufferMinutes: true, slotIntervalMinutes: true, confirmationMode: true }).partial().strict() }).strict(),
  z.object({ type: z.literal('service'), values: setupServiceSchema }).strict(),
  z.object({ type: z.literal('confirm_services'), ids: z.array(id).min(1).max(200) }).strict(),
  z.object({ type: z.literal('design'), style: z.enum(CUSTOMER_SITE_STYLE_PRESETS), palette: z.enum(CUSTOMER_SITE_PALETTE_PRESETS), layout: z.enum(['quick_book', 'editorial']) }).strict(),
  z.object({ type: z.literal('copy'), bio: z.string().max(4000), specialtyLine: z.string().max(160) }).strict(),
]);
export type SetupOperation = z.infer<typeof setupOperationSchema>;
export const setupEditSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operationId: z.string().uuid(),
  operations: z.array(setupOperationSchema).min(1).max(50),
}).strict();
export type SetupDocument = {
  schemaVersion: 1;
  business: z.infer<typeof businessSchema>;
  hours: SetupHours;
  booking: z.infer<typeof bookingConfigSchema>;
  bookingPolicy?: ReturnType<typeof resolveBookingExperience>['policy'];
  services: SetupService[];
  designBrief?: z.infer<typeof designBriefSchema>;
  website: {
    config: BookingPageConfigSide;
    content: BookingPageContentSide;
  };
};
/** Essentials for a useful first design; service approval is a later publish gate. */
export function missingDesignDetails(draft: SetupDocument): string[] {
  return [
    (!draft.business.name.trim() || ['Untitled business', 'My test business'].includes(draft.business.name)) && 'business name',
    !draft.business.city.trim() && 'city or area',
    draft.business.workMode === 'unknown' && 'whether you work alone or with a team',
    !Object.values(draft.hours).some(Boolean) && 'opening hours',
    !draft.services.some(service => service.priceCents !== null && service.durationMinutes !== null) && 'a service with its price and appointment length',
  ].filter((item): item is string => Boolean(item));
}
export type SetupChange = {
  path: string;
  before: unknown;
  after: unknown;
};
export type SetupReview = {
  revision: number;
  hash: string;
  changes: SetupChange[];
  blockers: string[];
};
export class SetupError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'STALE' | 'INVALID' | 'NOT_READY' | 'APPROVAL_REQUIRED', message: string) {
    super(message);
    this.name = 'SetupError';
  }
}
/** No model-origin command is capable of confirming financial or timing proposals. */
export function applySetupOperations(document: SetupDocument, operations: SetupOperation[], origin: 'owner' | 'assistant' | 'upload'): SetupDocument {
  const next = structuredClone(document);
  for (const raw of operations) {
    const op = setupOperationSchema.parse(raw);
    switch (op.type) {
      case 'design_brief':
        if (origin !== 'owner') {
          throw new SetupError('FORBIDDEN', 'Only you can choose which images may be used and confirm a design is yours.');
        }
        next.designBrief = op.values;
        break;
      case 'custom_frontend':
        next.website.config.customFrontendId = op.artifactId;
        break;
      case 'business':
        next.business = businessSchema.parse({ ...next.business, ...op.values });
        // Changing to a home salon never implicitly publishes its address.
        if (op.values.homeBased === true && op.values.locationDisplayMode === undefined) {
          next.business.locationDisplayMode = 'city_only';
        }
        next.website.content.locationDisplayMode = next.business.locationDisplayMode;
        break;
      case 'hours':
        next.hours = op.values;
        break;
      case 'booking':
        next.booking = bookingConfigSchema.parse({ ...next.booking, ...op.values });
        break;
      case 'service': {
        const previous = next.services.find(s => s.id === op.values.id);
        if (!previous && !op.values.id.startsWith('draft_')) {
          throw new SetupError('INVALID', 'New services need a draft identity.');
        }
        const service: SetupService = { ...op.values, origin, confirmed: origin === 'owner' };
        if (previous) {
          next.services = next.services.map(s => s.id === service.id ? service : s);
        } else {
          next.services.push(service);
        }
        if (next.services.length > 200) {
          throw new SetupError('INVALID', 'This menu is too large. Please split the update.');
        }
        break;
      }
      case 'confirm_services':
        if (origin !== 'owner') {
          throw new SetupError('FORBIDDEN', 'Review suggested prices and times before accepting them.');
        }
        if (op.ids.some(serviceId => !next.services.some(s => s.id === serviceId))) {
          throw new SetupError('INVALID', 'A selected service no longer exists.');
        }
        next.services = next.services.map(s => op.ids.includes(s.id) ? { ...s, confirmed: true } : s);
        break;
      case 'design':
        if (next.website.config.customFrontendId) {
          throw new SetupError('INVALID', 'Use the custom design conversation or its manual controls to change this website.');
        }
        next.website.config = { ...next.website.config, layout: op.layout, siteStylePreset: op.style, sitePalettePreset: op.palette };
        break;
      case 'copy':
        next.website.content = { ...next.website.content, bio: op.bio, specialtyLine: op.specialtyLine };
        break;
    }
  }
  return next;
}
export function setupReadiness(draft: SetupDocument): string[] {
  const blockers: string[] = [];
  if (!draft.business.name || ['Untitled business', 'My test business'].includes(draft.business.name)) {
    blockers.push('Confirm your business name.');
  }
  if (draft.business.workMode === 'unknown') {
    blockers.push('Confirm whether you work alone or with a team.');
  }
  if (!draft.business.city) {
    blockers.push('Add your city or service area.');
  }
  if (!Object.values(draft.hours).some(Boolean)) {
    blockers.push('Add at least one open day.');
  }
  if (!draft.services.length) {
    blockers.push('Add at least one service.');
  }
  for (const service of draft.services) {
    if (service.priceCents === null || service.durationMinutes === null) {
      blockers.push(`Add the missing price or time for ${service.name}.`);
    }
    if (!service.confirmed) {
      blockers.push(`Review the price and time for ${service.name}.`);
    }
  }
  return blockers;
}

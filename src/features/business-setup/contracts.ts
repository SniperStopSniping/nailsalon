import { z } from 'zod';

import { designBriefSchema } from '@/features/custom-sites/contracts';
import { websiteDetailsSchema } from '@/features/custom-sites/website-details';
import { bookingConfigSchema } from '@/libs/bookingConfig.shared';
import type { resolveBookingExperience } from '@/libs/bookingExperience';
import { bookingPolicyUpdateSchema } from '@/libs/bookingExperience';
import type { BookingPageConfigSide } from '@/libs/bookingPageConfig';
import type { BookingPageContentSide } from '@/libs/bookingPageContent';
import { createReminderRuleId } from '@/libs/communicationReminders.shared';
import { CUSTOMER_SITE_PALETTE_PRESETS, CUSTOMER_SITE_STYLE_PRESETS } from '@/libs/customerSitePresentation';
import { isValidSalonSlug } from '@/libs/tenantSlug';
import { BOOKING_CATEGORIES, SERVICE_CATEGORIES } from '@/models/serviceCatalogTypes';

import { changesProtectedAddOnChoices, type SetupAddOn, setupAddOnSchema } from './add-ons';
import { type SetupDeposit, setupDepositSchema, setupDepositUpdateSchema, type SetupReminders, setupRemindersSchema, setupRemindersUpdateSchema } from './booking-extras';
import { resolveSetupPolicy } from './booking-policy';
import { updateSetupServicePricing } from './service-pricing';

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
  priceDisplayText: z.string().trim().max(240).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).nullable(),
  preparationBufferMinutes: z.number().int().min(0).max(120),
  cleanupBufferMinutes: z.number().int().min(0).max(120),
  category: z.enum(SERVICE_CATEGORIES),
  bookingCategory: z.enum(BOOKING_CATEGORIES),
}).strict();
export type SetupService = z.infer<typeof setupServiceSchema> & {
  origin: 'existing' | 'owner' | 'assistant' | 'upload';
  confirmed: boolean;
  /** Internal safety marker, never accepted from a model or browser operation. */
  priceLabelNeedsReview?: boolean;
};
export const setupStaffSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  isActive: z.boolean(),
  hours: hoursSchema.nullable(),
  serviceIds: z.array(id).max(200).refine(ids => new Set(ids).size === ids.length, 'Choose each service only once.'),
  assignmentMode: z.enum(['preserve', 'explicit']),
}).strict();
export type SetupStaff = z.infer<typeof setupStaffSchema>;
export const businessSchema = z.object({
  name: z.string().trim().min(1).max(120),
  city: z.string().trim().max(120),
  exactAddress: z.string().trim().max(500),
  homeBased: z.boolean(),
  workMode: z.enum(['solo', 'team', 'unknown']).default('unknown'),
  locationDisplayMode: z.enum(['full_address', 'after_booking', 'city_only']),
}).strict();
// Internal, persisted batch: extracted facts keep their upload provenance while
// sharing the same atomic draft revision as the owner's conversational changes.
const websiteDetailsOperation = z.object({ type: z.literal('website_details'), values: websiteDetailsSchema.partial().strict() }).strict();
const uploadOperationSchema = z.discriminatedUnion('type', [
  websiteDetailsOperation,
  z.object({ type: z.literal('business'), values: businessSchema.omit({ workMode: true }).partial() }).strict(),
  z.object({ type: z.literal('hours'), values: hoursSchema }).strict(),
  z.object({ type: z.literal('booking'), values: bookingConfigSchema.pick({ currency: true }).partial().strict() }).strict(),
  z.object({ type: z.literal('service'), values: setupServiceSchema }).strict(),
]);
export const setupOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('site_url'), slug: z.string().trim().toLowerCase().max(47).refine(isValidSalonSlug, 'Choose a valid booking link.') }).strict(),
  z.object({ type: z.literal('deposit'), values: setupDepositUpdateSchema }).strict(),
  z.object({ type: z.literal('reminders'), values: setupRemindersUpdateSchema }).strict(),
  z.object({ type: z.literal('add_on'), values: setupAddOnSchema }).strict(),
  z.object({ type: z.literal('confirm_add_ons'), ids: z.array(id).min(1).max(200) }).strict(),
  z.object({ type: z.literal('booking_policy'), values: bookingPolicyUpdateSchema.shape.policy }).strict(),
  z.object({ type: z.literal('staff'), values: setupStaffSchema }).strict(),
  z.object({ type: z.literal('preview_defaults'), seed: z.string().uuid() }).strict(),
  z.object({ type: z.literal('confirm_hours') }).strict(),
  websiteDetailsOperation,
  z.object({ type: z.literal('import_upload'), referenceIds: z.array(z.string().uuid()).min(1).max(6), operations: z.array(uploadOperationSchema).min(1).max(30) }).strict(),
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
export const setupResetSchema = z.object({ expectedRevision: z.number().int().positive(), operationId: z.string().uuid() }).strict();
export type SetupDocument = {
  schemaVersion: 1;
  /** Owner-controlled conversation boundary; older revisions remain archived. */
  sessionStartRevision?: number;
  previousDraftRevision?: number;
  /** Stable identity lineage across resets/restores, renewed for a new setup. */
  identityNamespace?: string;
  /** Proposed public address. The server protects already published addresses. */
  siteSlug?: string;
  business: z.infer<typeof businessSchema>;
  hours: SetupHours;
  /** Suggested hours are editable draft values, never approved opening hours. */
  hoursOrigin?: 'existing' | 'owner' | 'assistant' | 'upload' | 'suggested';
  booking: z.infer<typeof bookingConfigSchema>;
  bookingPolicy?: ReturnType<typeof resolveBookingExperience>['policy'];
  bookingPolicyEdited?: boolean;
  deposit?: SetupDeposit;
  depositEditedFields?: ('enabled' | 'amountCents')[];
  reminders?: SetupReminders;
  remindersEditedFields?: ('rules' | 'quietHours')[];
  services: SetupService[];
  /** Absent on older revisions; hydrated without rewriting history. */
  addOns?: SetupAddOn[];
  servicePricingVersion?: 1;
  /** Absent on older saved revisions; hydrate from the verified baseline before editing. */
  staff?: SetupStaff[];
  staffUsesExplicitAssignments?: boolean;
  staffEdited?: boolean;
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
export function previewBusinessIdentity(draft: SetupDocument) {
  return {
    name: !draft.business.name.trim() || ['Untitled business', 'My test business'].includes(draft.business.name) ? 'Your salon' : draft.business.name,
    city: draft.business.city || 'Your area',
  };
}
export function needsPreviewDefaults(draft: SetupDocument) {
  return (!draft.hoursOrigin && !Object.values(draft.hours).some(Boolean))
    || !draft.services.length
    || draft.services.some(service => service.origin !== 'existing' && !service.confirmed && (service.priceCents === null || service.durationMinutes === null));
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
  notices?: string[];
  appointmentImpact?: {
    upcomingCount: number;
    outsideHoursCount: number;
    staffAffectedCount: number;
    fingerprint: string;
  };
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
      case 'site_url':
        if (origin !== 'owner') {
          throw new SetupError('FORBIDDEN', 'Choose your booking link in Details before reviewing it.');
        }
        next.siteSlug = op.slug;
        break;
      case 'deposit':
        if (origin === 'upload') {
          throw new SetupError('FORBIDDEN', 'Discuss deposit collection before changing payment settings.');
        }
        next.deposit = { enabled: false, amountCents: null, ...next.deposit, ...op.values };
        next.depositEditedFields = [...new Set([...next.depositEditedFields ?? [], ...Object.keys(op.values) as ('enabled' | 'amountCents')[]])];
        break;
      case 'reminders':
        if (origin === 'upload') {
          throw new SetupError('FORBIDDEN', 'Discuss reminders before changing message preferences.');
        }
        if (!next.reminders) {
          throw new SetupError('INVALID', 'Load your saved reminder preferences before changing them.');
        }
        next.reminders = setupRemindersSchema.parse({ ...next.reminders, ...op.values, ...(op.values.rules ? { rules: op.values.rules.map(rule => next.reminders!.rules.some(saved => saved.id === rule.id) ? rule : { ...rule, id: createReminderRuleId() }) } : {}) });
        next.remindersEditedFields = [...new Set([...next.remindersEditedFields ?? [], ...Object.keys(op.values) as ('rules' | 'quietHours')[]])];
        break;
      case 'add_on': {
        if (origin === 'upload') {
          throw new SetupError('FORBIDDEN', 'Confirm which services an extra belongs to before adding it.');
        }
        const previous = next.addOns?.find(addOn => addOn.id === op.values.id);
        if (!previous && !op.values.id.startsWith('draft_')) {
          throw new SetupError('INVALID', 'New add-ons need a draft identity.');
        }
        const addOn: SetupAddOn = { ...op.values, ...updateSetupServicePricing(previous, op.values, next.booking.currency), origin, confirmed: origin === 'owner', groupId: previous?.groupId ?? null, advancedRules: previous?.advancedRules ?? false };
        if (previous && changesProtectedAddOnChoices(previous, addOn)) {
          throw new SetupError('INVALID', 'This extra has existing selection rules. You can change its name, price and time here; change its service choices and quantity rules in your service library.');
        }
        next.addOns = previous ? next.addOns!.map(item => item.id === addOn.id ? addOn : item) : [...next.addOns ?? [], addOn];
        if (next.addOns.length > 200) {
          throw new SetupError('INVALID', 'This add-on menu is too large. Please split the update.');
        }
        break;
      }
      case 'confirm_add_ons':
        if (origin !== 'owner') {
          throw new SetupError('FORBIDDEN', 'Only you can accept proposed add-on prices and times.');
        }
        if (op.ids.some(addOnId => !next.addOns?.some(addOn => addOn.id === addOnId))) {
          throw new SetupError('INVALID', 'A selected add-on no longer exists.');
        }
        next.addOns = next.addOns?.map(addOn => op.ids.includes(addOn.id) ? { ...addOn, confirmed: true } : addOn);
        break;
      case 'booking_policy':
        if (origin === 'upload') {
          throw new SetupError('FORBIDDEN', 'Discuss booking requirements before changing the appointment agreement.');
        }
        next.bookingPolicy = resolveSetupPolicy(op.values, next.bookingPolicy);
        next.bookingPolicyEdited = true;
        break;
      case 'staff': {
        if (origin === 'upload') {
          throw new SetupError('FORBIDDEN', 'Confirm team details in your conversation or the team controls.');
        }
        const previous = next.staff?.find(person => person.id === op.values.id);
        if (!previous && !op.values.id.startsWith('draft_')) {
          throw new SetupError('INVALID', 'New team members need a draft identity.');
        }
        if (!previous && op.values.assignmentMode !== 'explicit') {
          throw new SetupError('INVALID', 'Choose services for a new team member.');
        }
        next.staff = previous ? next.staff!.map(person => person.id === previous.id ? op.values : person) : [...next.staff ?? [], op.values];
        next.staffEdited = true;
        if (next.staff.length > 50) {
          throw new SetupError('INVALID', 'This team is too large for one setup.');
        }
        break;
      }
      case 'preview_defaults': {
        if (origin !== 'assistant') {
          throw new SetupError('FORBIDDEN', 'Preview suggestions are prepared through the website conversation.');
        }
        if (!next.hoursOrigin && !Object.values(next.hours).some(Boolean)) {
          next.hours = { monday: null, tuesday: { open: '10:00', close: '18:00' }, wednesday: { open: '10:00', close: '18:00' }, thursday: { open: '10:00', close: '18:00' }, friday: { open: '10:00', close: '18:00' }, saturday: { open: '10:00', close: '18:00' }, sunday: null };
          next.hoursOrigin = 'suggested';
        }
        if (!next.services.length) {
          next.services.push({ id: `draft_sample_${op.seed}`, name: 'Signature appointment', description: null, priceCents: 6500, durationMinutes: 60, preparationBufferMinutes: 0, cleanupBufferMinutes: 0, category: 'manicure', bookingCategory: 'manicure', origin: 'assistant', confirmed: false });
        } else {
          next.services = next.services.map(service => service.origin !== 'existing' && !service.confirmed && (service.priceCents === null || service.durationMinutes === null)
            ? { ...service, priceCents: service.priceCents ?? 6500, durationMinutes: service.durationMinutes ?? 60, origin: 'assistant', confirmed: false }
            : service);
        }
        break;
      }
      case 'confirm_hours':
        if (origin !== 'owner') {
          throw new SetupError('FORBIDDEN', 'Only you can accept suggested opening hours.');
        }
        next.hoursOrigin = 'owner';
        break;
      case 'import_upload':
        if (origin !== 'assistant') {
          throw new SetupError('FORBIDDEN', 'Upload details must be read through your conversation.');
        }
        Object.assign(next, applySetupOperations(next, op.operations, 'upload'));
        break;
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
        next.hoursOrigin = next.hoursOrigin === 'suggested' && origin !== 'owner' ? 'suggested' : origin;
        break;
      case 'booking':
        next.booking = bookingConfigSchema.parse({ ...next.booking, ...op.values });
        break;
      case 'service': {
        const previous = next.services.find(s => s.id === op.values.id);
        if (!previous && !op.values.id.startsWith('draft_')) {
          throw new SetupError('INVALID', 'New services need a draft identity.');
        }
        const service: SetupService = { ...op.values, ...updateSetupServicePricing(previous, op.values, next.booking.currency), origin, confirmed: origin === 'owner' };
        if (previous) {
          next.services = next.services.map(s => s.id === service.id ? service : s);
        } else {
          next.services.push(service);
          if (next.staff?.length) {
            next.staffEdited = true;
          }
          const active = next.staff?.filter(person => person.isActive) ?? [];
          if (next.business.workMode === 'solo' && active.length === 1) {
            if (active[0]!.assignmentMode === 'preserve') {
              active[0]!.serviceIds = next.services.map(service => service.id);
            } else {
              active[0]!.serviceIds.push(service.id);
            }
            active[0]!.assignmentMode = 'explicit';
          }
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
      case 'website_details':
        next.website.content.websiteDetails = websiteDetailsSchema.parse({ locationDirections: null, instagram: null, email: null, phone: null, sections: [], ...next.website.content.websiteDetails, ...op.values });
        break;
      case 'copy':
        next.website.content = { ...next.website.content, bio: op.bio, specialtyLine: op.specialtyLine };
        break;
    }
  }
  if (next.staff?.some(person => person.serviceIds.some(serviceId => !next.services.some(service => service.id === serviceId)))) {
    throw new SetupError('INVALID', 'A team member’s selected service is not in this business draft.');
  }
  if (next.addOns?.some(addOn => addOn.serviceIds.some(serviceId => !next.services.some(service => service.id === serviceId)))) {
    throw new SetupError('INVALID', 'An add-on’s selected service is not in this business draft.');
  }
  assertSetupAddressPrivacy(next);
  return next;
}
export function assertSetupAddressPrivacy(document: SetupDocument) {
  const publicText = JSON.stringify({ details: document.website.content.websiteDetails, bio: document.website.content.bio, specialtyLine: document.website.content.specialtyLine, services: document.services.map(service => ({ name: service.name, description: service.description, priceDisplayText: service.priceDisplayText })), policy: document.bookingPolicy?.enabled ? document.bookingPolicy : null });
  if (document.business.locationDisplayMode !== 'full_address' && document.business.exactAddress.trim().length >= 5 && publicText.toLowerCase().includes(document.business.exactAddress.trim().toLowerCase())) {
    throw new SetupError('INVALID', 'Keep your private street address out of public website details and booking wording. Use a nearby intersection or area instead.');
  }
}
export function setupReadiness(draft: SetupDocument): string[] {
  const blockers: string[] = [];
  if (draft.depositEditedFields?.length && draft.deposit?.enabled && (draft.deposit.amountCents === null || !setupDepositSchema.safeParse(draft.deposit).success || draft.booking.currency !== 'CAD')) {
    blockers.push(draft.booking.currency !== 'CAD' ? 'Deposit collection is supported in Canadian dollars only. Keep deposits off to publish in another currency.' : 'Choose a valid deposit amount before enabling collection.');
  }
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
  if (draft.hoursOrigin === 'suggested') {
    blockers.push('Review the suggested opening hours.');
  }
  if (!draft.services.length) {
    blockers.push('Add at least one service.');
  }
  for (const service of draft.services) {
    if (service.priceLabelNeedsReview) {
      blockers.push(`Update or clear the price wording for ${service.name}; its booking price changed.`);
    }
    if (service.priceCents === null || service.durationMinutes === null) {
      blockers.push(`Add the missing price or time for ${service.name}.`);
    }
    if (!service.confirmed) {
      blockers.push(`Review the price and time for ${service.name}.`);
    }
  }
  for (const addOn of draft.addOns ?? []) {
    if ((addOn.origin !== 'existing' && addOn.name === 'New add-on') || addOn.priceCents === null || addOn.durationMinutes === null) {
      blockers.push(`Complete the name, price and time for ${addOn.name}.`);
    }
    if (!addOn.confirmed) {
      blockers.push(`Review the price and extra time for ${addOn.name}.`);
    }
    if (addOn.priceLabelNeedsReview) {
      blockers.push(`Update or clear the price wording for ${addOn.name}; its booking price changed.`);
    }
    if (addOn.id.startsWith('draft_') && addOn.pricingType === 'per_unit' && (!addOn.unitLabel || !addOn.maxQuantity)) {
      blockers.push(`Add a unit name and maximum quantity for ${addOn.name}.`);
    }
    if (addOn.isActive && !addOn.serviceIds.length && addOn.origin !== 'existing') {
      blockers.push(`Choose which services offer ${addOn.name}.`);
    }
  }
  if (draft.business.workMode === 'team' && !draft.staff?.some(person => person.isActive)) {
    blockers.push('Add your team before publishing.');
  }
  if (draft.staffEdited && draft.staff?.length) {
    if (!draft.staff.some(person => person.isActive)) {
      blockers.push('Enable bookings for at least one team member.');
    }
    for (const person of draft.staff.filter(person => person.isActive)) {
      if (person.name === 'New team member') {
        blockers.push('Confirm each team member’s name.');
      }
      if ((person.id.startsWith('draft_') && !person.hours) || (person.hours && !Object.values(person.hours).some(Boolean))) {
        blockers.push(`Add working hours for ${person.name}, or turn off their bookings.`);
      }
    }
    if (draft.staffUsesExplicitAssignments === false && draft.staff.some(person => person.isActive && person.assignmentMode === 'explicit')) {
      for (const person of draft.staff.filter(person => person.isActive && person.assignmentMode === 'preserve')) {
        blockers.push(`Review ${person.name}’s service assignments before changing the team’s booking eligibility.`);
      }
    }
    if (draft.staff.some(person => person.assignmentMode === 'explicit')) {
      for (const service of draft.services) {
        if (!draft.staff.some(person => person.isActive && person.serviceIds.includes(service.id))) {
          blockers.push(`Choose an active team member who can perform ${service.name}.`);
        }
      }
    }
  }
  return blockers;
}

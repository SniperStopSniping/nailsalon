import 'server-only';

import { resolvePublicQuickBookProfile } from '@/app/(unauth)/book/service/quickBookProfile';
import { resolveCatalogDomainView } from '@/libs/bookingCatalog';
import { getBookingConfigForSalon } from '@/libs/bookingConfig';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { resolveBookingPageConfig } from '@/libs/bookingPageConfig';
import { resolveBookingPageContent } from '@/libs/bookingPageContent';
import type { BusinessHours } from '@/libs/bookingPolicy';
import { resolvePublicCatalogSnapshot } from '@/libs/catalogResolver.server';
import { projectPublicBookingCatalog } from '@/libs/publicBookingCatalog';
import { getActiveAddOnsBySalonId, getActiveLocationsBySalonId, getSalonById, getServicesBySalonId } from '@/libs/queries';
import { applyLocationDisplayMode } from '@/libs/salonContent';
import { getPublicBookableServiceIds } from '@/libs/serviceAssignments';
import { resolveSharedSalonProfile } from '@/libs/sharedSalonProfile';
import type { SalonFeatures, SalonSettings } from '@/types/salonPolicy';

/**
 * Customer Assistant's bounded, read-only public fact projection.
 *
 * This is deliberately a second projection over the same *public* catalogue
 * and booking-page inputs, rather than a salon-row serializer.  The assistant
 * may explain only information a visitor can already reach on the live public
 * booking page.  It never receives private notes, raw settings, unpublished
 * booking-page content, staff capabilities, availability internals, or an
 * appointment-derived total.
 */

export type CustomerPublicPrice = {
  /** A current catalogue base price, never a quote for a selection. */
  baseCents: number;
  baseDisplay: string;
  /** Owner-authored public display copy such as "From $45", when configured. */
  displayLabel: string | null;
  /** Present only for a public L1 service family with actual child variants. */
  range: { minCents: number; maxCents: number; display: string } | null;
};

export type CustomerPublicServiceFact = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  durationMinutes: number;
  price: CustomerPublicPrice;
};

export type CustomerPublicAddOnFact = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  pricingType: string;
  durationMinutes: number;
  price: CustomerPublicPrice;
};

export type CustomerPublicFacts = {
  salon: {
    name: string;
    /** Live, publicly displayed profile copy only. */
    description?: string;
    /** Location is redacted by the same live address rule as the booking page. */
    location?: { name?: string; address?: string; locality?: string };
    /** Business hours, not live availability. */
    hours?: { today?: string; weekly: Array<{ day: string; value: string }> };
    /** Only public contact controls that the live Quick Book profile displays. */
    contact?: { phone?: string; email?: string };
    /** Only policy/quick-fact content currently displayed on the live booking page. */
    policies?: Array<{ label: string; text: string }>;
  };
  catalogue: {
    currency: 'CAD' | 'USD';
    services: CustomerPublicServiceFact[];
    addOns: CustomerPublicAddOnFact[];
  };
};

export type LoadCustomerPublicFactsArgs = {
  salonId: string;
  salonSlug: string;
  features: SalonFeatures | null;
  locale: string;
};

const MAX_PUBLIC_SERVICES = 60;
const MAX_PUBLIC_ADD_ONS = 80;
const WEEKDAYS = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
] as const;

function optionalText(value: string | null | undefined, maximum: number): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : null;
}

function formatMoney(cents: number, currency: 'CAD' | 'USD', locale: string): string {
  const safeLocale = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(locale) ? locale : 'en-CA';
  try {
    return new Intl.NumberFormat(safeLocale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(cents / 100);
  } catch {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(cents / 100);
  }
}

function priceFact(input: {
  priceCents: number;
  priceDisplayText: string | null | undefined;
  rangeSummary?: { minPriceCents: number; maxPriceCents: number } | null;
}, currency: 'CAD' | 'USD', locale: string): CustomerPublicPrice {
  const range = input.rangeSummary && input.rangeSummary.minPriceCents !== input.rangeSummary.maxPriceCents
    ? {
        minCents: input.rangeSummary.minPriceCents,
        maxCents: input.rangeSummary.maxPriceCents,
        display: `${formatMoney(input.rangeSummary.minPriceCents, currency, locale)}–${formatMoney(input.rangeSummary.maxPriceCents, currency, locale)}`,
      }
    : null;

  return {
    baseCents: input.priceCents,
    baseDisplay: formatMoney(input.priceCents, currency, locale),
    displayLabel: optionalText(input.priceDisplayText, 120),
    range,
  };
}

function description(value: readonly string[] | null | undefined, fallback?: string | null): string | null {
  const joined = value?.map(item => item.trim()).filter(Boolean).join('\n') ?? '';
  return optionalText(joined || fallback, 600);
}

function formatTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function publicHours(hours: BusinessHours | null | undefined): CustomerPublicFacts['salon']['hours'] | undefined {
  if (!hours) {
    return undefined;
  }
  const weekly = WEEKDAYS.map(([key, day]) => {
    const interval = hours[key];
    const open = interval ? formatTime(interval.open) : null;
    const close = interval ? formatTime(interval.close) : null;
    return {
      day,
      value: open && close ? `${open}–${close}` : 'Closed',
      malformed: Boolean(interval && (!open || !close)),
    };
  });
  if (weekly.some(day => day.malformed)) {
    return undefined;
  }
  return weekly.some(day => day.value !== 'Closed')
    ? { weekly: weekly.map(({ day, value }) => ({ day, value })) }
    : undefined;
}

function isLivePublicSalon(salon: Awaited<ReturnType<typeof getSalonById>>, slug: string): salon is NonNullable<typeof salon> {
  return Boolean(
    salon
    && salon.id
    && salon.slug === slug
    && salon.isActive
    && salon.status === 'active'
    && salon.publicationStatus === 'published'
    && !salon.deletedAt
    && salon.onlineBookingEnabled,
  );
}

/**
 * Loads only the bounded public facts a receptionist can truthfully explain.
 * A missing or unpublished salon fails closed; callers must not substitute a
 * similarly named tenant or invent facts when this fails.
 */
export async function loadCustomerPublicFacts(args: LoadCustomerPublicFactsArgs): Promise<CustomerPublicFacts> {
  const salon = await getSalonById(args.salonId);
  if (!isLivePublicSalon(salon, args.salonSlug)) {
    throw new Error('CUSTOMER_PUBLIC_FACTS_UNAVAILABLE');
  }

  const settings = (salon.settings as SalonSettings | null | undefined) ?? null;
  const [bookingConfig, locations, bookable] = await Promise.all([
    getBookingConfigForSalon(salon.id),
    getActiveLocationsBySalonId(salon.id),
    getPublicBookableServiceIds(salon.id),
  ]);
  const page = resolveBookingPageConfig(settings).live;
  const pageContent = resolveBookingPageContent(settings).live;
  const experience = resolveBookingExperience(settings);
  const sharedProfile = resolveSharedSalonProfile(settings);

  // Reuse the public Quick Book projector for its contact, address, hours and
  // policy gates.  Do not approximate its city-only/after-booking privacy or
  // per-field visibility logic here.
  const quickBook = resolvePublicQuickBookProfile({
    salon: {
      name: salon.name,
      logoUrl: salon.logoUrl ?? null,
      phone: salon.phone ?? null,
      email: salon.email ?? null,
      address: salon.address ?? null,
      city: salon.city ?? null,
      state: salon.state ?? null,
      zipCode: salon.zipCode ?? null,
      businessHours: salon.businessHours ?? null,
    },
    technicians: [],
    locations: locations.map(location => ({
      name: location.name,
      address: location.address ?? null,
      city: location.city ?? null,
      state: location.state ?? null,
      zipCode: location.zipCode ?? null,
      phone: location.phone ?? null,
      email: location.email ?? null,
      businessHours: location.businessHours ?? null,
      isPrimary: location.isPrimary ?? false,
    })),
    bookingExperience: experience,
    reviewUrl: null,
    sharedProfile,
    parkingInstructions: null,
    visibility: page.quickBookProfile,
    bio: pageContent.bio,
    locationDisplayMode: pageContent.locationDisplayMode,
    publicContactPreferences: sharedProfile.callEnabled === null
      && sharedProfile.textEnabled === null
      && sharedProfile.textNumber === null
      ? null
      : {
          callEnabled: sharedProfile.callEnabled === true,
          textEnabled: sharedProfile.textEnabled === true,
          textNumber: sharedProfile.textNumber,
        },
    timeZone: bookingConfig.timezone,
  });

  const exposesEditorialLocation = page.layout !== 'quick_book' && !page.hiddenSections.includes('hoursLocation');
  const exposesEditorialPolicy = page.layout !== 'quick_book'
    && !page.hiddenSections.includes('policies')
    && experience.policy.enabled
    && experience.policy.showOnServicePage
    && Boolean(optionalText(experience.policy.text, 8_000));

  const salonFacts: CustomerPublicFacts['salon'] = { name: salon.name };
  const publicBio = page.layout === 'quick_book'
    ? quickBook.bio
    : (!page.hiddenSections.includes('salonProfile') ? optionalText(pageContent.bio, 1_600) : null);
  if (publicBio) {
    salonFacts.description = publicBio;
  }
  if (page.layout === 'quick_book' && quickBook.location) {
    const location: NonNullable<CustomerPublicFacts['salon']['location']> = {};
    if (quickBook.location.name) {
      location.name = quickBook.location.name;
    }
    if (quickBook.location.addressLine) {
      location.address = quickBook.location.addressLine;
    }
    if (quickBook.location.localityLine) {
      location.locality = quickBook.location.localityLine;
    }
    if (Object.keys(location).length > 0) {
      salonFacts.location = location;
    }
  }
  if (page.layout === 'quick_book' && quickBook.hours) {
    salonFacts.hours = {
      ...(quickBook.hours.todayLabel ? { today: quickBook.hours.todayLabel } : {}),
      weekly: quickBook.hours.weekly,
    };
  } else if (exposesEditorialLocation) {
    // Editorial publishes the Hours & location section independently of the
    // Quick Book profile toggles.  Apply the shared redaction choke point
    // before building facts, rather than accidentally treating hidden
    // Quick Book flags as an editorial privacy rule.
    const primaryLocation = locations.find(location => location.isPrimary) ?? locations[0] ?? null;
    const source = primaryLocation ?? salon;
    const redacted = applyLocationDisplayMode({
      name: primaryLocation?.name ?? null,
      address: source.address ?? null,
      city: source.city ?? null,
      state: source.state ?? null,
      zipCode: source.zipCode ?? null,
    }, pageContent.locationDisplayMode);
    const locality = [optionalText(redacted.city, 120), optionalText(redacted.state, 120), optionalText(redacted.zipCode, 24)]
      .filter((value): value is string => Boolean(value))
      .join(', ');
    const location: NonNullable<CustomerPublicFacts['salon']['location']> = {};
    if (redacted.name) {
      location.name = redacted.name;
    }
    if (optionalText(redacted.address, 400)) {
      location.address = redacted.address;
    }
    if (locality) {
      location.locality = locality;
    }
    if (Object.keys(location).length > 0) {
      salonFacts.location = location;
    }
    const hours = publicHours(source.businessHours ?? null);
    if (hours) {
      salonFacts.hours = hours;
    }
  }
  if (page.layout === 'quick_book' && quickBook.contact) {
    const contact: NonNullable<CustomerPublicFacts['salon']['contact']> = {};
    if (quickBook.contact.phone?.display) {
      contact.phone = quickBook.contact.phone.display;
    }
    if (quickBook.contact.email?.display) {
      contact.email = quickBook.contact.email.display;
    }
    if (Object.keys(contact).length > 0) {
      salonFacts.contact = contact;
    }
  }
  if (page.layout === 'quick_book' && quickBook.policies.length > 0) {
    salonFacts.policies = quickBook.policies;
  } else if (exposesEditorialPolicy) {
    salonFacts.policies = [{
      label: optionalText(experience.policy.title, 160) ?? 'Policies',
      text: optionalText(experience.policy.text, 8_000)!,
    }];
  }

  let services: CustomerPublicServiceFact[];
  let addOns: CustomerPublicAddOnFact[];
  let currency: 'CAD' | 'USD';
  if (resolveCatalogDomainView(args.features) === 'l1') {
    const result = await resolvePublicCatalogSnapshot({ salonId: salon.id, requestedSource: 'live' });
    if (!result.ok) {
      throw new Error('CUSTOMER_PUBLIC_FACTS_UNAVAILABLE');
    }
    const catalogue = projectPublicBookingCatalog(result.snapshot, bookable);
    if (catalogue.services.length > MAX_PUBLIC_SERVICES || catalogue.addOns.length > MAX_PUBLIC_ADD_ONS) {
      throw new Error('CUSTOMER_PUBLIC_FACTS_UNAVAILABLE');
    }
    currency = catalogue.currency;
    services = catalogue.services.map(service => ({
      id: service.id,
      name: service.parentServiceId
        ? `${catalogue.services.find(parent => parent.id === service.parentServiceId)?.name ?? service.name} · ${service.variantLabel ?? service.name}`
        : service.name,
      description: description(service.descriptionItems),
      category: service.category,
      durationMinutes: service.durationMinutes,
      price: priceFact(service, currency, args.locale),
    }));
    addOns = catalogue.addOns.map(addOn => ({
      id: addOn.id,
      name: addOn.name,
      description: description(addOn.descriptionItems),
      category: addOn.category,
      pricingType: addOn.pricingType,
      durationMinutes: addOn.durationMinutes,
      price: priceFact(addOn, currency, args.locale),
    }));
  } else {
    const [rawServices, rawAddOns] = await Promise.all([
      getServicesBySalonId(salon.id),
      getActiveAddOnsBySalonId(salon.id),
    ]);
    const publicServices = rawServices.filter(service => bookable === null || bookable.has(service.id));
    if (publicServices.length > MAX_PUBLIC_SERVICES || rawAddOns.length > MAX_PUBLIC_ADD_ONS) {
      throw new Error('CUSTOMER_PUBLIC_FACTS_UNAVAILABLE');
    }
    currency = bookingConfig.currency;
    services = publicServices.map(service => ({
      id: service.id,
      name: service.name,
      description: description(service.descriptionItems, service.description),
      category: service.category,
      durationMinutes: service.durationMinutes,
      price: priceFact({ priceCents: service.price, priceDisplayText: service.priceDisplayText }, currency, args.locale),
    }));
    addOns = rawAddOns.map(addOn => ({
      id: addOn.id,
      name: addOn.name,
      description: description(addOn.descriptionItems),
      category: addOn.category,
      pricingType: addOn.pricingType,
      durationMinutes: addOn.durationMinutes,
      price: priceFact({ priceCents: addOn.priceCents, priceDisplayText: addOn.priceDisplayText }, currency, args.locale),
    }));
  }

  return { salon: salonFacts, catalogue: { currency, services, addOns } };
}

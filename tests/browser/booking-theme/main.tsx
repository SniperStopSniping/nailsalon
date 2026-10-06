import '@/styles/global.css';

import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';

import { BookConfirmClient } from '@/app/(unauth)/book/confirm/BookConfirmClient';
import { BookServiceClient } from '@/app/(unauth)/book/service/BookServiceClient';
import { BookTechClient } from '@/app/(unauth)/book/tech/BookTechClient';
import { BookTimeClient } from '@/app/(unauth)/book/time/BookTimeClient';
import { isApprovedQuickBookLayout } from '@/components/customer-site/QuickBookPresentation';
import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { resolveCustomerSitePalettePreset } from '@/libs/customerSitePresentation';

import { isMediaQuickBookLayout } from '../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/quick-book/media-layouts';
import { createQuickBookFixture } from './quick-book-fixture';

const query = new URLSearchParams(window.location.search);
// PublicSalonPageShell normally resolves policy versions on the Node server.
// This isolated UI harness runs that shell in a browser; substitute only the
// server crypto adapter, using a fixed synthetic version (never booking auth).
if (query.has('review-policy')) {
  Object.assign(globalThis, { process: { env: {}, getBuiltinModule: () => ({ createHash: () => ({ update: () => ({ digest: () => 'a'.repeat(64) }) }) }) } });
}
const requestedLayout = query.get('quick-book-layout');
const quickBookFixture = (isApprovedQuickBookLayout(requestedLayout) || isMediaQuickBookLayout(requestedLayout)) ? createQuickBookFixture(requestedLayout, query.get('case') ?? 'normal') : null;
const isla = query.has('isla');
const step = query.get('step') ?? 'time';
const palette = resolveCustomerSitePalettePreset(query.get('palette'));
const legacyTheme = query.get('legacy-theme');
const themeKey = legacyTheme ?? 'espresso';
const services = query.has('review-multi')
  ? [{ id: 'service-fixture', name: 'Russian Manicure with detailed cuticle care and a long custom finish', price: 35, duration: 35 }, { id: 'service-second', name: 'Pedicure with a sheer pink finish', price: 45, duration: 45 }]
  : [{ id: 'service-fixture', name: 'Russian Manicure', price: 35, duration: 35, imageUrl: query.has('review-thumbnail') ? '/service-thumbnail.svg' : null }];
const addOns = query.has('review-multi')
  ? [{ id: 'addon-fixed', serviceId: 'service-fixture', name: 'Simple Nail Art', price: 10, duration: 15, quantity: 1 }, { id: 'addon-manual', serviceId: 'service-second', name: 'Custom hand-painted design consultation', price: 0, duration: 10, quantity: 1, priceMode: 'manual_confirmation' as const }]
  : query.has('receipt-details')
    ? [{ id: 'addon-fixture', serviceId: 'service-fixture', serviceName: 'Russian Manicure', name: 'Simple Nail Art', price: 20, duration: 15, quantity: 2, priceDisplayText: '$20.00' }]
    : [];
const reviewedTotal = query.has('review-multi') ? 90 : query.has('receipt-details') ? 55 : 35;
const technician = { id: 'tech-fixture', name: 'Daniela', imageUrl: null };
const bookingFlow = ['service', 'tech', 'time', 'confirm'] as const;
const common = { services, totalPrice: reviewedTotal, totalDuration: query.has('review-multi') ? 105 : query.has('long') ? 210 : query.has('receipt-details') ? 65 : 35, technician, bookingFlow: [...bookingFlow] };
const date = '2026-10-06';
const timeChoices = ['09:30', '10:15', '13:45', '14:00', '14:15', '16:15', '17:00', '18:00', '18:45', '19:30'];
const count = Number(query.get('count') ?? 3);
const available = count === 1 ? ['13:45'] : count === 3 ? ['13:45', '14:00', '14:15'] : timeChoices.slice(0, count);
window.fetch = async (input) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const requestPath = new URL(requestUrl, window.location.origin).pathname;
  if (requestPath === '/api/public/appointments/manage/private-token/next-booking') {
    document.documentElement.dataset.nextBookingRequest = requestUrl;
    return Response.json({ data: { bookingUrl: '/en/theme-fixture/book/time?serviceIds=service-fixture&techId=tech-fixture' } });
  }
  if (requestPath === '/api/appointments/availability') {
    const requestedDate = new URL(requestUrl, window.location.origin).searchParams.get('date') ?? date;
    return Response.json({
      slots: available.map(time => ({ time, startTime: `${requestedDate}T${time}:00-04:00`, availability: 'available' })),
      visibleSlots: [...available, '11:00', '11:15'],
      bookedSlots: ['11:00', '11:15'],
      blockedDurationMinutes: common.totalDuration + 10,
      visibleDurationMinutes: common.totalDuration,
    });
  }
  if (requestPath === '/api/appointments') {
    return Response.json({ data: {
      appointmentId: 'synthetic-appointment',
      appointment: { id: 'synthetic-appointment', status: query.has('pending') ? 'pending' : 'confirmed' },
      manageUrl: query.has('missing-management') ? undefined : '/en/theme-fixture/manage/private-token',
    } }, { status: 201 });
  }
  throw new Error(`Unexpected fixture request: ${String(input)}`);
};

const salon = {
  id: 'synthetic-salon',
  slug: isla ? 'isla-nail-studio' : 'theme-fixture',
  name: 'Isla Nail Studio',
  themeKey,
  status: 'active',
  settings: { bookingExperience: { ...(query.has('primary-color') ? { primaryColor: query.get('primary-color') } : {}), ...(query.has('review-policy') ? { policy: { enabled: true, title: 'Appointment agreement', text: 'Please arrive on time. Changes or cancellations must be made at least 24 hours before your appointment. Contact the salon if you cannot attend.', showBeforeConfirmation: true, acknowledgment: { required: true, text: 'I agree to the appointment policy.' } }, quickFacts: { depositNotice: { enabled: true, label: 'No deposit required.' } } } : {}) } },
} as ComponentProps<typeof PublicSalonPageShell>['salon'];
const bookingPage = {
  layout: 'quick_book',
  quickBookLayout: requestedLayout ?? 'clean_card',
  stylePack: 'default',
  tokenOverrides: null,
  serviceMenuLayout: 'visual_grid',
  quickBookProfile: {
    version: query.has('legacy-profile') ? 0 : 1,
    showTechName: Boolean(quickBookFixture),
    showTechPhoto: false,
    showLocation: false,
    showHours: false,
    showPhone: false,
    showEmail: false,
    showBookingPolicy: false,
    showCancellationPolicy: false,
    showReviews: false,
    showInstagram: false,
    showBio: false,
  },
  sectionOrder: ['salonProfile', 'serviceMenu', 'bookingCta'],
  sectionVariants: {},
  hiddenSections: [],
  businessMode: 'solo',
  startMode: 'services_first',
  siteStylePreset: 'modern',
  sitePalettePreset: palette,
} as const;

createRoot(document.getElementById('root')!).render(
  <PublicSalonPageShell
    appearance={{ mode: query.has('custom-appearance') ? 'custom' : 'theme', themeKey: query.get('page-theme') ?? themeKey }}
    salon={salon}
    bookingPage={{ ...bookingPage, siteStylePreset: legacyTheme ? undefined : bookingPage.siteStylePreset, sitePalettePreset: legacyTheme ? undefined : palette, sectionOrder: [...bookingPage.sectionOrder], hiddenSections: [], quickBookLayout: requestedLayout && (isApprovedQuickBookLayout(requestedLayout) || isMediaQuickBookLayout(requestedLayout)) ? requestedLayout : 'clean_card' }}
    pageName={step === 'time' ? 'book-datetime' : step === 'tech' ? 'book-technician' : `book-${step}`}
  >
    {step === 'service' && (
      <BookServiceClient
        quickBookProfile={quickBookFixture ? { ...quickBookFixture.profile, contact: quickBookFixture.profile.contact ? { ...quickBookFixture.profile.contact, phone: quickBookFixture.profile.contact.phone ? { ...quickBookFixture.profile.contact.phone, actionLabel: 'Call' as const } : null } : null, identity: { ...quickBookFixture.profile.identity, technicianPhotoUrl: quickBookFixture.profile.presentation.portrait.kind === 'custom' ? quickBookFixture.profile.presentation.portrait.url : null }, location: quickBookFixture.profile.location ? { ...quickBookFixture.profile.location, directionsUrl: quickBookFixture.profile.location.directionsUrl ?? '' } : null } : undefined}
        services={isla
          ? [
              ['isla-russian', 'Russian Manicure', 3500, 35, 'manicure', 'gel-x.jpg'],
              ['isla-gel', 'Gel Manicure', 4000, 60, 'manicure', 'gel-manicure.jpg'],
              ['isla-biab', 'BIAB / Builder Gel', 5500, 90, 'manicure', 'builder-gel.jpg'],
              ['isla-extensions', 'Gel-X Extensions', 7000, 90, 'manicure', 'gel-x.jpg'],
              ['isla-french', 'French Manicure', 4500, 60, 'manicure', 'gel-manicure.jpg'],
              ['isla-natural', 'Natural Nail Care', 3000, 30, 'manicure', 'builder-gel.jpg'],
              ['isla-pedi', 'Gel Pedicure', 4500, 60, 'pedicure', 'gel-manicure.jpg'],
              ['isla-combo', 'Manicure + Pedicure', 9000, 150, 'combo', 'gel-x.jpg'],
            ].map(([id, name, price, minutes, category, photo], index) => ({ sortOrder: index, id: String(id), name: String(name), priceCents: Number(price), durationMinutes: Number(minutes), category: category as 'manicure' | 'pedicure' | 'combo', bookingCategory: category as 'manicure' | 'pedicure' | 'combo', description: 'Precise nail care and a beautiful finish.', descriptionItems: [], priceDisplayText: null, templateKey: null, featuredOrder: null, imageUrl: `/isla/${photo}`, resolvedIntroPriceLabel: null }))
          : quickBookFixture
            ? quickBookFixture.menu.services.map(service => ({
              id: service.id,
              name: service.name,
              description: service.longDescription ?? service.shortDescription,
              descriptionItems: [],
              durationMinutes: service.durationMinutes,
              priceCents: service.price.behavior === 'fixed' || service.price.behavior === 'starts_at' ? service.price.amountCents : service.price.behavior === 'range' ? service.price.minCents : 0,
              priceDisplayText: null,
              category: 'manicure',
              bookingCategory: 'manicure' as const,
              templateKey: null,
              featuredOrder: null,
              imageUrl: service.image?.src ?? '',
              resolvedIntroPriceLabel: null,
            }))
            : [{
                id: 'service-fixture',
                name: 'Russian Manicure',
                description: null,
                descriptionItems: [],
                durationMinutes: 35,
                priceCents: 3500,
                priceDisplayText: null,
                category: 'manicure',
                bookingCategory: 'manicure',
                templateKey: null,
                featuredOrder: null,
                imageUrl: '',
                resolvedIntroPriceLabel: null,
              }]}
        addOns={isla ? [{ id: 'isla-extra', name: 'French finish', descriptionItems: [], category: 'nail_art', pricingType: 'fixed', unitLabel: null, maxQuantity: 1, priceCents: 1000, durationMinutes: 15, priceDisplayText: null, isActive: true }] : quickBookFixture ? [{ id: 'qb-fixture-nail-art', name: 'Simple nail art', descriptionItems: ['Fixture nail art option'], category: 'nail_art', pricingType: 'fixed', unitLabel: null, maxQuantity: 1, priceCents: 1000, durationMinutes: 15, priceDisplayText: null, isActive: true }] : undefined}
        serviceAddOnRules={isla ? [{ id: 'isla-extra-rule', serviceId: 'isla-russian', addOnId: 'isla-extra', selectionMode: 'optional', defaultQuantity: null, maxQuantityOverride: null, displayOrder: 1 }] : quickBookFixture ? [{ id: 'qb-fixture-rule', serviceId: quickBookFixture.menu.services[0]!.id, addOnId: 'qb-fixture-nail-art', selectionMode: 'optional', defaultQuantity: null, maxQuantityOverride: null, displayOrder: 1 }] : undefined}
        technicians={isla ? [{ id: 'tech-isla', name: 'Daniela', imageUrl: null, enabledServiceIds: ['isla-russian', 'isla-gel', 'isla-biab', 'isla-extensions', 'isla-french', 'isla-natural', 'isla-pedi', 'isla-combo'], rating: null, reviewCount: 0, primaryLocationId: null }] : undefined}
        bookingFlow={[...bookingFlow]}
        locations={[]}
      />
    )}
    {step === 'time' && <BookTimeClient {...common} locationName="Primary location" minimumNoticeMinutes={120} salonTimeZone="America/Toronto" closedWeekdays={[0]} />}
    {step === 'tech' && <BookTechClient {...common} technicians={[{ ...technician, bookable: true, unavailableReason: null, specialties: [], rating: 0, reviewCount: 0 }]} />}
    {step === 'confirm' && <BookConfirmClient {...common} addOns={addOns} subtotalBeforeDiscount={reviewedTotal} discountAmount={0} salonSlug="theme-fixture" salonId="synthetic-salon" dateStr={date} timeStr="13:45" canonicalStartTime={`${date}T13:45:00-04:00`} rewardsEnabled={!query.has('no-rewards')} location={query.has('receipt-details') || query.has('review-multi') ? { id: 'location-fixture', name: 'Atelier Nail Studio — Demo', address: '100 Demo Lane', city: 'Toronto', state: null, zipCode: null } : null} rebookingSettings={query.has('rebooking') ? { enabled: true, intervalWeeks: 3, message: query.has('rebooking-long') ? 'x'.repeat(300) : 'Secure your next spot now.' } : undefined} />}
  </PublicSalonPageShell>,
);

import '@/styles/global.css';

import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';

import { BookConfirmClient } from '@/app/(unauth)/book/confirm/BookConfirmClient';
import { BookServiceClient } from '@/app/(unauth)/book/service/BookServiceClient';
import { BookTechClient } from '@/app/(unauth)/book/tech/BookTechClient';
import { BookTimeClient } from '@/app/(unauth)/book/time/BookTimeClient';
import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { resolveCustomerSitePalettePreset } from '@/libs/customerSitePresentation';

const query = new URLSearchParams(window.location.search);
// PublicSalonPageShell normally resolves policy versions on the Node server.
// This isolated UI harness runs that shell in a browser; substitute only the
// server crypto adapter, using a fixed synthetic version (never booking auth).
if (query.has('review-policy')) {
  Object.assign(globalThis, { process: { env: {}, getBuiltinModule: () => ({ createHash: () => ({ update: () => ({ digest: () => 'a'.repeat(64) }) }) }) } });
}
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
  slug: 'theme-fixture',
  name: 'Isla Nail Studio',
  themeKey,
  status: 'active',
  settings: { bookingExperience: { ...(query.has('primary-color') ? { primaryColor: query.get('primary-color') } : {}), ...(query.has('review-policy') ? { policy: { enabled: true, title: 'Appointment agreement', text: 'Please arrive on time. Changes or cancellations must be made at least 24 hours before your appointment. Contact the salon if you cannot attend.', showBeforeConfirmation: true, acknowledgment: { required: true, text: 'I agree to the appointment policy.' } }, quickFacts: { depositNotice: { enabled: true, label: 'No deposit required.' } } } : {}) } },
} as ComponentProps<typeof PublicSalonPageShell>['salon'];
const bookingPage = {
  layout: 'quick_book',
  stylePack: 'default',
  tokenOverrides: null,
  serviceMenuLayout: 'visual_grid',
  quickBookProfile: {
    showTechName: false,
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
    bookingPage={{ ...bookingPage, siteStylePreset: legacyTheme ? undefined : bookingPage.siteStylePreset, sitePalettePreset: legacyTheme ? undefined : palette, sectionOrder: [...bookingPage.sectionOrder], hiddenSections: [] }}
    pageName={step === 'time' ? 'book-datetime' : step === 'tech' ? 'book-technician' : `book-${step}`}
  >
    {step === 'service' && (
      <BookServiceClient
        services={[{
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
        bookingFlow={[...bookingFlow]}
        locations={[]}
      />
    )}
    {step === 'time' && <BookTimeClient {...common} locationName="Primary location" minimumNoticeMinutes={120} salonTimeZone="America/Toronto" closedWeekdays={[0]} />}
    {step === 'tech' && <BookTechClient {...common} technicians={[{ ...technician, bookable: true, unavailableReason: null, specialties: [], rating: 0, reviewCount: 0 }]} />}
    {step === 'confirm' && <BookConfirmClient {...common} addOns={addOns} subtotalBeforeDiscount={reviewedTotal} discountAmount={0} salonSlug="theme-fixture" salonId="synthetic-salon" dateStr={date} timeStr="13:45" canonicalStartTime={`${date}T13:45:00-04:00`} rewardsEnabled={!query.has('no-rewards')} location={query.has('receipt-details') || query.has('review-multi') ? { id: 'location-fixture', name: 'Atelier Nail Studio — Demo', address: '100 Demo Lane', city: 'Toronto', state: null, zipCode: null } : null} rebookingSettings={query.has('rebooking') ? { enabled: true, intervalWeeks: 3, message: 'Secure your next spot now.' } : undefined} />}
  </PublicSalonPageShell>,
);

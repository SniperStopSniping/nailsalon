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
const step = query.get('step') ?? 'time';
const palette = resolveCustomerSitePalettePreset(query.get('palette'));
const services = [{ id: 'service-fixture', name: 'Russian Manicure', price: 35, duration: 35 }];
const technician = { id: 'tech-fixture', name: 'Daniela', imageUrl: null };
const bookingFlow = ['service', 'tech', 'time', 'confirm'] as const;
const common = { services, totalPrice: 35, totalDuration: query.has('long') ? 210 : 35, technician, bookingFlow: [...bookingFlow] };
const date = '2026-09-12';
const timeChoices = ['09:30', '10:15', '13:45', '14:00', '14:15', '16:15', '17:00', '18:00', '18:45', '19:30'];
const count = Number(query.get('count') ?? 3);
const available = count === 1 ? ['13:45'] : count === 3 ? ['13:45', '14:00', '14:15'] : timeChoices.slice(0, count);
window.fetch = async (input) => {
  if (String(input).startsWith('/api/appointments/availability')) {
    return Response.json({
      slots: available.map(time => ({ time, startTime: `${date}T${time}:00-04:00`, availability: 'available' })),
      visibleSlots: [...available, '11:00', '11:15'],
      bookedSlots: ['11:00', '11:15'],
      blockedDurationMinutes: common.totalDuration + 10,
      visibleDurationMinutes: common.totalDuration,
    });
  }
  if (String(input) === '/api/appointments') {
    return Response.json({ data: { appointment: { id: 'synthetic-appointment', status: 'confirmed' } } }, { status: 201 });
  }
  throw new Error(`Unexpected fixture request: ${String(input)}`);
};

const salon = {
  id: 'synthetic-salon',
  slug: 'theme-fixture',
  name: 'Isla Nail Studio',
  themeKey: 'espresso',
  status: 'active',
  settings: null,
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
    appearance={{ mode: 'theme', themeKey: 'espresso' }}
    salon={salon}
    bookingPage={{ ...bookingPage, sectionOrder: [...bookingPage.sectionOrder], hiddenSections: [] }}
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
    {step === 'confirm' && <BookConfirmClient {...common} subtotalBeforeDiscount={35} discountAmount={0} salonSlug="theme-fixture" dateStr={date} timeStr="13:45" location={null} />}
  </PublicSalonPageShell>,
);

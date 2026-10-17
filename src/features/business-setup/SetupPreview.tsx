import { BookServiceClient } from '@/app/(unauth)/book/service/BookServiceClient';
import { resolvePublicQuickBookProfile } from '@/app/(unauth)/book/service/quickBookProfile';
import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { getPageAppearance } from '@/libs/pageAppearance';
import { applyLocationDisplayMode } from '@/libs/salonContent';
import { resolveServiceCardImage } from '@/libs/serviceImage';
import { resolveSharedSalonProfile } from '@/libs/sharedSalonProfile';
import type { Salon } from '@/models/Schema';

import { setupPolicyInput } from './booking-policy';
import type { SetupDocument } from './contracts';
import { WEEKDAYS } from './contracts';
import type { readSetupSnapshot } from './drafts.server';
import { setupPreviewBooking } from './preview-data.server';
import { setupServicePriceLabel } from './service-pricing';
import { TeamBookingSummary } from './TeamBookingSummary';
/** Read-only adapter into production components. No canonical rows are written. */
export async function SetupPreview({ salon: liveSalon, document, snapshot }: {
  salon: Salon;
  document: SetupDocument;
  snapshot: Awaited<ReturnType<typeof readSetupSnapshot>>;
}) {
  const bookingPreview = setupPreviewBooking(document, snapshot);
  const settings = {
    ...(liveSalon.settings ?? {}),
    sharedProfile: { ...(liveSalon.settings?.sharedProfile ?? {}), ...(document.business.homeBased ? { businessType: 'home_based' as const } : {}) },
    booking: document.booking,
    ...(document.bookingPolicyEdited ? { bookingExperience: { ...(liveSalon.settings?.bookingExperience ?? {}), policy: setupPolicyInput(document.bookingPolicy) } } : {}),
    bookingPage: { version: 1 as const, live: document.website.config, draft: document.website.config },
    bookingPageContent: { version: 1 as const, live: document.website.content, draft: document.website.content },
  };
  const salon: Salon = { ...liveSalon, name: document.business.name, city: document.business.city, address: document.business.exactAddress || null, businessHours: document.hours, settings };
  // Preview identifiers can never resolve to canonical services at the booking
  // API. The response also has a server-enforced sandbox CSP (no scripts/forms).
  const services = document.services.filter(s => s.priceCents !== null && s.durationMinutes !== null).map((s, index) => ({
    id: `setup_preview_${s.id}`,
    name: s.name,
    description: s.description,
    descriptionItems: [],
    durationMinutes: s.durationMinutes!,
    priceCents: s.priceCents!,
    priceDisplayText: s.priceDisplayText || s.priceLabelNeedsReview ? setupServicePriceLabel(s, document.booking.currency) : null,
    category: s.category,
    bookingCategory: s.bookingCategory,
    templateKey: null,
    featuredOrder: null,
    imageUrl: resolveServiceCardImage({ imageUrl: null, templateKey: null, bookingCategory: s.bookingCategory, name: s.name }),
    resolvedIntroPriceLabel: null,
    sortOrder: index,
  }));
  const rawLocation = { id: 'setup_preview_location', name: 'Visit us', address: document.business.exactAddress || null, city: document.business.city, state: null, zipCode: null, phone: null, email: null, isPrimary: true, businessHours: document.hours };
  const location = applyLocationDisplayMode(rawLocation, document.business.locationDisplayMode);
  const config = document.website.config;
  const content = document.website.content;
  const profile = config.layout === 'quick_book'
    ? resolvePublicQuickBookProfile({
      salon,
      technicians: bookingPreview.technicians,
      locations: [rawLocation],
      bookingExperience: resolveBookingExperience(settings),
      reviewUrl: null,
      sharedProfile: resolveSharedSalonProfile(settings),
      parkingInstructions: null,
      visibility: config.quickBookProfile,
      bio: content.bio,
      locationDisplayMode: document.business.locationDisplayMode,
      timeZone: document.booking.timezone,
      presentation: { layout: config.quickBookLayout, content, gallery: [], technician: null },
    })
    : undefined;
  return (
    <>
      <div className="bg-amber-50 p-3 text-center text-sm text-amber-950">Private draft preview. Booking is disabled here. Availability examples are simulated.</div>
      <TeamBookingSummary document={document} />
      <details className="bg-white p-4 text-sm">
        <summary>Proposed booking setup</summary>
        <p>
          {document.booking.currency}
          {' '}
          ·
          {' '}
          {document.booking.timezone}
          {' '}
          ·
          {' '}
          {document.booking.minimumNoticeMinutes}
          {' '}
          minutes notice ·
          {' '}
          {document.booking.bufferMinutes}
          {' '}
          minutes extra buffer ·
          {' '}
          {document.booking.confirmationMode === 'instant' ? 'Instant confirmation' : 'Owner approval required'}
        </p>
        <p>{WEEKDAYS.map(day => `${day}: ${document.hours[day] ? `${document.hours[day]!.open}–${document.hours[day]!.close}` : 'closed'}`).join(' · ')}</p>
        <p>
          Available team:
          {bookingPreview.technicians.map(t => t.name).join(', ') || 'Team setup still needed'}
        </p>
        <p>
          Simulated times for
          {bookingPreview.service?.name ?? 'your first service'}
          . These use your proposed hours, staff assignments, service time, buffers and notice. Existing appointments, time off and external calendars are excluded from this illustration.
        </p>
        {bookingPreview.examples.map(day => (
          <p key={day.date}>
            {day.date}
            :
            {' '}
            {day.times.join(', ')}
          </p>
        ))}
        {!bookingPreview.examples.length && <p>No example times are available with this setup.</p>}
      </details>
      {services.length < document.services.length && <p className="p-3 text-sm">Services with missing prices or times will appear here after you complete them.</p>}
      <PublicSalonPageShell appearance={await getPageAppearance(salon.id, 'book-service')} pageName="book-service" salon={salon} bookingPage={config} ownerPreview={{ isPreviewing: true, actorType: 'owner' }} isPreviewingDraftConfig salonContentInput={{ services, locations: [rawLocation], technicians: bookingPreview.technicians, addOns: [], lusterFeaturingEnabled: false, content }}>
        <BookServiceClient services={services} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[location]} technicians={[]} currency={document.booking.currency} lusterFeaturingEnabled={false} showNewClientPromo={false} isEmbeddedBuilderPreview quickBookProfile={profile} />
      </PublicSalonPageShell>
    </>
  );
}

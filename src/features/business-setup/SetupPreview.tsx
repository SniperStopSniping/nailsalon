import { BookServiceClient } from '@/app/(unauth)/book/service/BookServiceClient';
import { resolvePublicQuickBookProfile } from '@/app/(unauth)/book/service/quickBookProfile';
import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { resolveBookingExperience } from '@/libs/bookingExperience';
import { getPageAppearance } from '@/libs/pageAppearance';
import { applyLocationDisplayMode } from '@/libs/salonContent';
import { resolveServiceCardImage } from '@/libs/serviceImage';
import { resolveSharedSalonProfile } from '@/libs/sharedSalonProfile';
import type { Salon } from '@/models/Schema';

import { AddOnBookingSummary } from './AddOnBookingSummary';
import { setupPolicyInput } from './booking-policy';
import { BookingExtrasSummary } from './BookingExtrasSummary';
import { BookingSetupSummary } from './BookingSetupSummary';
import type { SetupDocument } from './contracts';
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
    ...(document.depositEditedFields?.length && document.deposit ? { payments: { ...(liveSalon.settings?.payments ?? {}), deposit: { ...(liveSalon.settings?.payments?.deposit ?? {}), enabled: document.deposit.enabled, ...(document.deposit.amountCents === null ? { amountCents: undefined } : { amountCents: document.deposit.amountCents }), activationConfirmed: false } } } : {}),
    ...(document.remindersEditedFields?.length && document.reminders ? { communications: { ...(liveSalon.settings?.communications ?? {}), reminders: { rules: document.reminders.rules }, quietHours: document.reminders.quietHours } } : {}),
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
      <BookingExtrasSummary document={document} />
      <AddOnBookingSummary document={document} />
      <BookingSetupSummary document={document} examples={{ serviceName: bookingPreview.service?.name ?? null, technicianNames: bookingPreview.technicians.map(person => person.name), days: bookingPreview.examples }} />
      {services.length < document.services.length && <p className="p-3 text-sm">Services with missing prices or times will appear here after you complete them.</p>}
      <PublicSalonPageShell appearance={await getPageAppearance(salon.id, 'book-service')} pageName="book-service" salon={salon} bookingPage={config} ownerPreview={{ isPreviewing: true, actorType: 'owner' }} isPreviewingDraftConfig salonContentInput={{ services, locations: [rawLocation], technicians: bookingPreview.technicians, addOns: [], lusterFeaturingEnabled: false, content }}>
        <BookServiceClient services={services} bookingFlow={['service', 'tech', 'time', 'confirm']} locations={[location]} technicians={[]} currency={document.booking.currency} lusterFeaturingEnabled={false} showNewClientPromo={false} isEmbeddedBuilderPreview quickBookProfile={profile} />
      </PublicSalonPageShell>
    </>
  );
}

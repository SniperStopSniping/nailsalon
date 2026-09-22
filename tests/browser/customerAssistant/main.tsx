import '@/styles/global.css';

import type { ComponentProps } from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { BookConfirmClient } from '@/app/(unauth)/book/confirm/BookConfirmClient';
import { BookTimeClient } from '@/app/(unauth)/book/time/BookTimeClient';
import { FindBookingForm } from '@/app/[locale]/[slug]/find-booking/FindBookingForm';
import { CustomerAssistantLauncher } from '@/components/customerAssistant/CustomerAssistantLauncher';
import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';

const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
};
type PageData = { stage: 'time'; props: ComponentProps<typeof BookTimeClient> } | { stage: 'confirm'; props: ComponentProps<typeof BookConfirmClient> };

/** Component fixture; real backend journeys supply actual server-page props. */
export function CustomerAssistantBrowserFixture() {
  const href = useSyncExternalStore(subscribe, () => window.location.href, () => '/');
  const url = new URL(href, 'http://127.0.0.1:3130');
  const atTime = url.pathname.includes('/book/time');
  const atConfirm = url.pathname.includes('/book/confirm');
  const atFindBooking = url.pathname.endsWith('/find-booking');
  const [data, setData] = useState<PageData | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (!atTime && !atConfirm) {
      setData(null);
      return;
    }
    let active = true;
    setData(null);
    setFailure(null);
    const query = new URLSearchParams(new URL(href).search);
    query.set('stage', atTime ? 'time' : 'confirm');
    void fetch(`/api/__fixture/booking-page?${query}`).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Server-page fixture failed: ${response.status}`);
      }
      const page = await response.json() as PageData & { canonicalUrl?: string };
      if (page.canonicalUrl && window.location.pathname + window.location.search !== page.canonicalUrl) {
        window.history.replaceState(null, '', page.canonicalUrl);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
      if (active) {
        setData(page);
      }
    }).catch((error: Error) => {
      if (active) {
        setFailure(error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [href, atTime, atConfirm]);
  const salon = { id: 'synthetic-browser-isla-salon', slug: 'isla-nail-studio', name: 'Synthetic Isla Browser Salon', themeKey: 'espresso', status: 'active', settings: null } as ComponentProps<typeof PublicSalonPageShell>['salon'];
  return (
    <PublicSalonPageShell appearance={{ mode: 'theme', themeKey: 'espresso' }} salon={salon} bookingPage={{ layout: 'quick_book', stylePack: 'default', tokenOverrides: null, serviceMenuLayout: 'visual_grid', quickBookProfile: { showTechName: false, showTechPhoto: false, showLocation: false, showHours: false, showPhone: false, showEmail: false, showBookingPolicy: false, showCancellationPolicy: false, showReviews: false, showInstagram: false, showBio: false }, sectionOrder: ['serviceMenu'], sectionVariants: {}, hiddenSections: [], businessMode: 'solo', startMode: 'services_first' }} pageName={atTime ? 'book-datetime' : atConfirm ? 'book-confirm' : 'book-service'}>
      {atFindBooking && (
        <main className="min-h-[calc(100vh-60px)] bg-[#fbf6f1] px-3 py-14">
          <div className="mx-auto max-w-md">
            <div className="mt-5 rounded-[2rem] border border-stone-200 bg-white p-4 shadow-sm sm:p-7">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950">Find my booking</h1>
              <FindBookingForm salonSlug="isla-nail-studio" salonPhone="+14165550100" />
            </div>
          </div>
        </main>
      )}
      {!atTime && !atConfirm && !atFindBooking && (
        <main className="mx-auto min-h-screen max-w-md bg-stone-50 p-4">
          <h1 className="mb-4 text-xl font-semibold text-neutral-950">Synthetic Booking Test Salon</h1>
          <p className="mb-5 text-sm text-neutral-700">Book your next appointment.</p>
          <CustomerAssistantLauncher salonId="synthetic-browser-isla-salon" salonSlug="isla-nail-studio" locale="en" />
        </main>
      )}
      {(atTime || atConfirm) && !data && <p role="status">{failure ?? 'Loading normal booking…'}</p>}
      {data?.stage === 'time' && <BookTimeClient {...data.props} />}
      {data?.stage === 'confirm' && <BookConfirmClient {...data.props} />}
      {(atTime || atConfirm) && <CustomerAssistantLauncher salonId="synthetic-browser-isla-salon" salonSlug="isla-nail-studio" locale="en" />}
    </PublicSalonPageShell>
  );
}

createRoot(document.getElementById('root')!).render(<CustomerAssistantBrowserFixture />);

import '@/styles/global.css';

import { NextIntlClientProvider } from 'next-intl';
import { createRoot } from 'react-dom/client';

import { NoShowRecordsModal } from '@/components/admin/NoShowRecordsModal';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

const locale = new URLSearchParams(window.location.search).get('locale') === 'fr' ? 'fr' : 'en';

createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-xl">
      <NoShowRecordsModal salonSlug="synthetic-salon" onClose={() => {}} />
    </main>
  </NextIntlClientProvider>,
);

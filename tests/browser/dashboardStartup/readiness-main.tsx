import '@/styles/global.css';

import { NextIntlClientProvider } from 'next-intl';
import { createRoot } from 'react-dom/client';

import AdminPage from '@/app/[locale]/admin/page';
import en from '@/locales/en.json';

// Real owner page; Playwright supplies isolated salon responses. No providers.
createRoot(document.getElementById('root')!).render(<NextIntlClientProvider locale="en" messages={en}><AdminPage /></NextIntlClientProvider>);

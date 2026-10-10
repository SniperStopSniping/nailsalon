import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import FindBookingPage from '@/app/[locale]/[slug]/find-booking/page';
import { ManageAppointmentView } from '@/app/[locale]/[slug]/manage/[token]/ManageAppointmentView';

async function main() {
  const screen = new URLSearchParams(location.search).get('screen');
  const content = screen === 'manage'
    ? await ManageAppointmentView({ token: 'synthetic-private-token', locale: 'en', slug: 'fixture' })
    : await FindBookingPage({ params: Promise.resolve({ slug: 'fixture' }) });
  createRoot(document.getElementById('root')!).render(content);
}
void main();

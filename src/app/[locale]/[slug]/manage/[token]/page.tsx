import type { Metadata } from 'next';

import { ManageAppointmentView } from './ManageAppointmentView';

export const dynamic = 'force-dynamic';

// Private capability page: never indexed, never followed, never previewed.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function ManageAppointmentPage({ params }: { params: { locale: string; slug: string; token: string } }) {
  return (
    <ManageAppointmentView
      token={params.token}
      locale={params.locale}
      slug={params.slug}
    />
  );
}

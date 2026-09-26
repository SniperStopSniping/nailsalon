import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NoShowRecords } from '@/components/super-admin/NoShowRecords';
import { isSuperAdmin } from '@/libs/superAdmin';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'No-show records | Super Admin' };

export default async function NoShowRecordsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!await isSuperAdmin()) {
    redirect(`/${locale}/super-admin-login`);
  }

  return (
    <main className="min-h-screen bg-[#F8F3F0] py-8">
      <div className="mx-auto max-w-7xl px-4 pb-5 sm:px-6 lg:px-8">
        <Link href={`/${locale}/super-admin`} className="text-sm font-medium text-rose-800 hover:underline">← Platform Control Center</Link>
      </div>
      <NoShowRecords />
    </main>
  );
}

import { redirect } from 'next/navigation';

import { SuperAdminDashboard } from '@/components/super-admin/SuperAdminDashboard';
import { isSuperAdmin } from '@/libs/superAdmin';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Super Admin',
  description: 'Platform owner control panel',
};

export default async function SuperAdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const isSuper = await isSuperAdmin();

  if (!isSuper) {
    redirect(`/${locale}/super-admin-login`);
  }

  return <SuperAdminDashboard />;
}

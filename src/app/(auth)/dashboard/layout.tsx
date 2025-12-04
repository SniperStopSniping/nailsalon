'use client';

import { DashboardHeader } from '@/features/dashboard/DashboardHeader';

export default function DashboardLayout(props: { children: React.ReactNode }) {
  return (
    <>
      <div className="shadow-md">
        <div className="mx-auto flex max-w-screen-xl items-center justify-between px-3 py-4">
          <DashboardHeader
            menu={[
              {
                href: '/dashboard',
                label: 'Home',
              },
              // PRO: Link to the /dashboard/todos page
              {
                href: '/dashboard/organization-profile/organization-members',
                label: 'Members',
              },
              {
                href: '/dashboard/organization-profile',
                label: 'Settings',
              },
              // PRO: Link to the /dashboard/billing page
            ]}
          />
        </div>
      </div>

      <div className="min-h-[calc(100vh-72px)] bg-muted">
        <div className="mx-auto max-w-screen-xl px-3 pb-16 pt-6">
          {props.children}
        </div>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';

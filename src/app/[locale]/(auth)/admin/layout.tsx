import type { ReactNode } from 'react';

import { AdminImpersonationBanner } from '@/components/admin/AdminImpersonationBanner';

/**
 * Admin Dashboard Layout
 *
 * iOS-inspired layout with system grouped background.
 * Mobile-first design optimized for salon owners.
 */

export const metadata = {
  title: 'Luster Owner Workspace',
  description: 'Bookings, clients, services, and salon growth tools by Luster',
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8f3f0',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
      }}
    >
      <AdminImpersonationBanner />
      {children}
    </div>
  );
}

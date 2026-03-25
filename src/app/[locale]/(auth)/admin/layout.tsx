import type { ReactNode } from 'react';

import { AdminImpersonationBanner } from '@/components/admin/AdminImpersonationBanner';

/**
 * Admin Dashboard Layout
 *
 * iOS-inspired layout with system grouped background.
 * Mobile-first design optimized for salon owners.
 */

export const metadata = {
  title: 'Admin Dashboard',
  description: 'Salon owner command center',
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f2f2f7', // iOS system grouped background
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
      }}
    >
      <AdminImpersonationBanner />
      {children}
    </div>
  );
}

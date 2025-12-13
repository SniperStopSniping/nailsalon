'use client';

/**
 * Client Profile Demo Page
 *
 * Demonstrates the iOS-style Client Profile design mockup.
 */

import { ClientProfileModal } from '@/components/admin/ClientProfileModal';

export default function ClientProfileDemoPage() {
  return (
    <div className="min-h-screen bg-[#F2F2F7]">
      <ClientProfileModal onClose={() => window.history.back()} />
    </div>
  );
}

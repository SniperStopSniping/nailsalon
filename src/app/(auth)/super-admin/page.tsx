'use client';

/**
 * Super Admin Dashboard
 *
 * Platform owner control center for managing all salons/organizations.
 * Only accessible to users with emails in SUPER_ADMIN_EMAILS env var.
 */

import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SuperAdminDashboard } from '@/components/super-admin/SuperAdminDashboard';

export default function SuperAdminPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    async function checkSuperAdmin() {
      if (!isLoaded) {
        return;
      }

      if (!user) {
        router.push('/sign-in');
        return;
      }

      // Check with backend if user is super admin
      try {
        const response = await fetch('/api/super-admin/organizations?limit=1');
        if (response.status === 403 || response.status === 401) {
          setIsAuthorized(false);
        } else if (response.ok) {
          setIsAuthorized(true);
        } else {
          setIsAuthorized(false);
        }
      } catch {
        setIsAuthorized(false);
      } finally {
        setIsChecking(false);
      }
    }

    checkSuperAdmin();
  }, [isLoaded, user, router]);

  // Loading state
  if (!isLoaded || isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F2F7]">
        <div className="text-center">
          <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
          <p className="text-[15px] text-[#8E8E93]">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Not authorized
  if (isAuthorized === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F2F2F7] px-5">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[#FF3B30]/10">
            <svg
              className="size-8 text-[#FF3B30]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="mb-2 text-[24px] font-bold text-[#1C1C1E]">
            Access Denied
          </h1>
          <p className="mb-6 text-[15px] text-[#8E8E93]">
            You don&apos;t have permission to access the Super Admin dashboard.
            This area is restricted to platform owners only.
          </p>
          <button
            type="button"
            onClick={() => router.push('/admin')}
            className="rounded-xl bg-[#007AFF] px-6 py-3 text-[17px] font-medium text-white transition-opacity active:opacity-80"
          >
            Go to Admin Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Authorized - show dashboard
  return <SuperAdminDashboard />;
}

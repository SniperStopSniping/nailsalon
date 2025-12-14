'use client';

/**
 * Admin Onboarding Page
 *
 * Collects name and email from admins after their first OTP login.
 * Required before they can access the admin dashboard.
 */

import { useParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

// =============================================================================
// Phone Formatting
// =============================================================================

function formatPhoneDisplay(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value;
}

// =============================================================================
// Main Component
// =============================================================================

type AdminUser = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  isSuperAdmin: boolean;
  profileComplete: boolean;
  salons: Array<{ id: string; slug: string; name: string; role: string }>;
};

function AdminOnboardingContent() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';

  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const redirectToDashboard = (userData: AdminUser) => {
    if (userData.isSuperAdmin) {
      router.push(`/${locale}/super-admin`);
    } else if (userData.salons.length > 0) {
      router.push(`/${locale}/admin?salon=${userData.salons[0]?.slug}`);
    } else {
      router.push(`/${locale}/admin`);
    }
  };

  // Fetch current user on mount
  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch('/api/admin/auth/me');

        if (!response.ok) {
          // Not logged in, redirect to login
          router.push(`/${locale}/admin-login`);
          return;
        }

        const data = await response.json();
        const userData = data.user as AdminUser;
        setUser(userData);

        // Pre-fill form with existing data
        if (userData.name) {
          setName(userData.name);
        }
        if (userData.email) {
          setEmail(userData.email);
        }

        // If profile is already complete, redirect to dashboard
        if (userData.profileComplete) {
          redirectToDashboard(userData);
        }
      } catch {
        router.push(`/${locale}/admin-login`);
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, [locale, router, redirectToDashboard]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const response = await fetch('/api/admin/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to save profile');
        return;
      }

      // Redirect to appropriate dashboard
      if (user) {
        redirectToDashboard(user);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100">
        <div className="size-8 animate-spin rounded-full border-4 border-slate-700 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <div className="px-6 pb-8 pt-12 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg">
          <span className="text-3xl">👤</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Complete Your Profile</h1>
        <p className="mt-1 text-slate-600">
          Just a few more details before you get started
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 px-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-sm">
          {/* Phone (Read-only) */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Phone Number
            </label>
            <div className="w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-lg text-slate-600">
              {formatPhoneDisplay(user.phone)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Your phone number is verified and cannot be changed
            </p>
          </div>

          {/* Name */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Full Name
              {' '}
              <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              placeholder="John Smith"
              autoFocus
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          {/* Email */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Email Address
              {' '}
              <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="john@example.com"
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-lg text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              We&apos;ll use this for important notifications
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={saving || !name.trim() || !email.trim()}
            className="w-full rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 py-3.5 font-semibold text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="size-5 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Saving...
                  </span>
                )
              : (
                  'Continue to Dashboard'
                )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <div className="px-6 py-8 text-center">
        <p className="text-sm text-slate-500">
          Need help?
          {' '}
          <a href="mailto:support@example.com" className="font-medium text-slate-700 hover:underline">
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Page Export
// =============================================================================

export default function AdminOnboardingPage() {
  return (
    <Suspense fallback={(
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100">
        <div className="size-8 animate-spin rounded-full border-4 border-slate-700 border-t-transparent" />
      </div>
    )}
    >
      <AdminOnboardingContent />
    </Suspense>
  );
}

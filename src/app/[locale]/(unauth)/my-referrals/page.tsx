'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type ReferralData = {
  id: string;
  refereePhone: string | null;
  refereeName: string | null;
  status: 'sent' | 'claimed' | 'booked' | 'reward_earned' | 'expired';
  createdAt: string;
  claimedAt: string | null;
  expiresAt: string | null;
  hasReferrerReward: boolean;
  daysUntilExpiry: number | null;
  isExpired: boolean;
};

function formatPhone(phone: string): string {
  if (phone.length !== 10) return phone;
  return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function getStatusBadge(status: string, isExpired: boolean) {
  // If expired (either explicitly or via isExpired flag), show expired badge
  if (status === 'expired' || isExpired) {
    return { label: 'Expired', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' };
  }

  switch (status) {
    case 'sent':
      return { label: 'Sent', color: themeVars.primary, bgColor: `color-mix(in srgb, ${themeVars.primary} 20%, transparent)` };
    case 'claimed':
      return { label: 'Claimed', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.15)' };
    case 'booked':
      return { label: 'Booked', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.15)' };
    case 'reward_earned':
      return { label: 'Rewarded!', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.15)' };
    default:
      return { label: status, color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.15)' };
  }
}

export default function MyReferralsPage() {
  const router = useRouter();
  const params = useParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [referrals, setReferrals] = useState<ReferralData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientPhone, setClientPhone] = useState('');
  const [mounted, setMounted] = useState(false);
  const [hasStoredPhone, setHasStoredPhone] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  // Load client phone from cookie
  useEffect(() => {
    setMounted(true);
    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) {
        setClientPhone(phone);
        setHasStoredPhone(true);
      }
    }
  }, []);

  // Normalize phone for API calls - strip non-digits and leading country code "1"
  const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

  // Helper to check if phone is valid (exactly 10 digits)
  const isValidPhone = normalizedPhone.length === 10;

  // Auto-fetch referrals when phone is stored in cookie
  useEffect(() => {
    if (hasStoredPhone && isValidPhone && !hasFetched) {
      fetchReferrals();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStoredPhone, isValidPhone]);

  const fetchReferrals = useCallback(async () => {
    if (!normalizedPhone || normalizedPhone.length !== 10) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/referrals?phone=${normalizedPhone}&salonSlug=${salonSlug}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to fetch referrals');
      }
      const data = await response.json();
      setReferrals(data.data?.referrals || []);
      setHasFetched(true);
    } catch (err) {
      console.error('Error fetching referrals:', err);
      setError(err instanceof Error ? err.message : 'Failed to load referrals');
    } finally {
      setLoading(false);
    }
  }, [normalizedPhone, salonSlug]);

  const handleLookup = () => {
    if (isValidPhone) {
      fetchReferrals();
    }
  };

  const handleBack = () => {
    router.back();
  };

  return (
    <div
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Top bar with back button */}
        <div
          className="relative flex items-center pb-2 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            aria-label="Go back"
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12.5 15L7.5 10L12.5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div
          className="pb-4 pt-2 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <h1
            className="text-3xl font-bold tracking-tight"
            style={{ color: themeVars.titleText }}
          >
            My Referrals
          </h1>
          <p className="mt-1 text-base italic text-neutral-500">
            Track your sharing success
          </p>
        </div>

        {/* Phone lookup (shown if no stored phone or not yet fetched) */}
        {!hasStoredPhone && !hasFetched && (
          <div
            className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: themeVars.cardBorder,
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
              transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
            }}
          >
            <div
              className="h-1"
              style={{
                background: `linear-gradient(to right, ${themeVars.primaryDark}, ${themeVars.primary})`,
                width: mounted ? '100%' : '0%',
                transition: 'width 500ms ease-out 250ms',
              }}
            />
            <div className="p-5">
              <p className="mb-4 text-center text-base text-neutral-600">
                Enter your phone number to view your referrals
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-600">
                  <span>+1</span>
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={clientPhone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setClientPhone(digits.slice(0, 10));
                    setError(null);
                  }}
                  placeholder="Your phone number"
                  className="flex-1 rounded-full bg-neutral-100 px-4 py-2.5 text-base text-neutral-800 outline-none placeholder:text-neutral-400"
                  disabled={loading}
                />
              </div>
              <button
                type="button"
                onClick={handleLookup}
                disabled={!isValidPhone || loading}
                className="mt-4 w-full rounded-full px-6 py-3.5 text-lg font-bold text-neutral-900 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
              >
                {loading ? 'Looking up...' : 'View My Referrals'}
              </button>
            </div>
          </div>
        )}

        {/* Stats Card - only show after lookup or if phone stored */}
        {(hasFetched || hasStoredPhone) && (
          <div
            className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: themeVars.cardBorder,
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
              transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
            }}
          >
            <div
              className="h-1"
              style={{
                background: `linear-gradient(to right, ${themeVars.primaryDark}, ${themeVars.primary})`,
                width: mounted ? '100%' : '0%',
                transition: 'width 500ms ease-out 250ms',
              }}
            />
            <div className="p-5">
              <div className="flex items-center justify-around">
                <div className="text-center">
                  <div className="text-3xl font-bold text-neutral-900">
                    {referrals.length}
                  </div>
                  <div className="mt-1 text-sm font-medium text-neutral-500">Total Sent</div>
                </div>
                <div className="h-12 w-px bg-neutral-200" />
                <div className="text-center">
                  <div className="text-3xl font-bold" style={{ color: themeVars.accent }}>
                    {referrals.filter(r => r.status === 'reward_earned').length}
                  </div>
                  <div className="mt-1 text-sm font-medium text-neutral-500">Rewarded</div>
                </div>
                <div className="h-12 w-px bg-neutral-200" />
                <div className="text-center">
                  <div className="text-3xl font-bold" style={{ color: '#22c55e' }}>
                    ${referrals.filter(r => r.status === 'reward_earned').length * 45}
                  </div>
                  <div className="mt-1 text-sm font-medium text-neutral-500">Earned</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Referrals List Card - only show after lookup or if phone stored */}
        {(hasFetched || hasStoredPhone) && (
          <div
            className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: themeVars.cardBorder,
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
              transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
            }}
          >
            <div className="p-5">
              <h2 className="mb-4 text-lg font-bold text-neutral-900">
                Referral History
              </h2>

              {loading && (
                <div className="py-8 text-center">
                  <div className="text-neutral-500">Loading referrals...</div>
                </div>
              )}

              {!loading && error && (
                <div className="py-8 text-center">
                  <div className="text-red-500">{error}</div>
                </div>
              )}

              {!loading && !error && hasFetched && referrals.length === 0 && (
                <div className="py-8 text-center">
                  <div className="mb-2 text-4xl">💌</div>
                  <p className="mb-1 font-medium text-neutral-900">No referrals yet</p>
                  <p className="text-sm text-neutral-600">
                    Start sharing and earn free manicures!
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push(`/${locale}/invite`)}
                    className="mt-4 rounded-full px-6 py-2.5 text-base font-bold text-neutral-900 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                  >
                    Invite Friends
                  </button>
                </div>
              )}

              {!loading && !error && referrals.length > 0 && (
                <div className="space-y-3">
                  {referrals.map((referral, index) => {
                    const badge = getStatusBadge(referral.status, referral.isExpired);
                    const displayName = referral.refereeName || (referral.refereePhone ? `+1 ${formatPhone(referral.refereePhone)}` : 'Pending claim');
                    const showExpiry = referral.daysUntilExpiry !== null && !referral.isExpired && ['claimed', 'booked'].includes(referral.status);

                    return (
                      <div
                        key={referral.id}
                        className="rounded-xl p-4"
                        style={{
                          background: `linear-gradient(to bottom right, ${themeVars.background}, ${themeVars.selectedBackground})`,
                          opacity: mounted ? 1 : 0,
                          transform: mounted ? 'translateX(0)' : 'translateX(-10px)',
                          transition: `opacity 300ms ease-out ${300 + index * 50}ms, transform 300ms ease-out ${300 + index * 50}ms`,
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="text-base font-semibold text-neutral-900">
                              {displayName}
                            </div>
                            {referral.refereePhone && referral.refereeName && (
                              <div className="mt-0.5 text-sm text-neutral-500">
                                +1 {formatPhone(referral.refereePhone)}
                              </div>
                            )}
                            <div className="mt-0.5 text-sm text-neutral-500">
                              Sent {formatDate(referral.createdAt)}
                            </div>
                            {referral.claimedAt && (
                              <div className="mt-0.5 text-sm text-neutral-500">
                                Claimed {formatDate(referral.claimedAt)}
                              </div>
                            )}
                            {showExpiry && (
                              <div className="mt-1 text-xs text-amber-600">
                                ⏰ {referral.daysUntilExpiry} day{referral.daysUntilExpiry !== 1 ? 's' : ''} left to book
                              </div>
                            )}
                            {referral.hasReferrerReward && referral.status === 'reward_earned' && (
                              <div className="mt-1 text-xs text-green-600">
                                🎁 You earned a free manicure!
                              </div>
                            )}
                          </div>
                          <div
                            className="rounded-full px-3 py-1.5 text-sm font-bold"
                            style={{ color: badge.color, backgroundColor: badge.bgColor }}
                          >
                            {badge.label}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Invite More Button - show after lookup or if phone stored */}
        {!loading && (hasFetched || hasStoredPhone) && (
          <button
            type="button"
            onClick={() => router.push(`/${locale}/invite`)}
            className="w-full rounded-full px-6 py-3.5 text-lg font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
            style={{
              background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
              opacity: mounted ? 1 : 0,
              transition: 'opacity 300ms ease-out 250ms',
            }}
          >
            Invite More Friends
          </button>
        )}

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}

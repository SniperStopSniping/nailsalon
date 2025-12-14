'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

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
  if (phone.length !== 10) {
    return phone;
  }
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
    return { label: 'Expired', color: 'var(--n5-error)', bgColor: 'color-mix(in srgb, var(--n5-error) 15%, transparent)' };
  }

  switch (status) {
    case 'sent':
      return { label: 'Sent', color: 'var(--n5-accent)', bgColor: `color-mix(in srgb, var(--n5-accent) 20%, transparent)` };
    case 'claimed':
      return { label: 'Claimed', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.15)' };
    case 'booked':
      return { label: 'Booked', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.15)' };
    case 'reward_earned':
      return { label: 'Rewarded!', color: 'var(--n5-success)', bgColor: 'color-mix(in srgb, var(--n5-success) 15%, transparent)' };
    default:
      return { label: status, color: 'var(--n5-ink-muted)', bgColor: 'color-mix(in srgb, var(--n5-ink-muted) 15%, transparent)' };
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
  const [hasStoredPhone, setHasStoredPhone] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  // Load client phone from cookie
  useEffect(() => {
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
      setError(err instanceof Error ? err.message : 'Failed to load referrals');
    } finally {
      setLoading(false);
    }
  }, [normalizedPhone, salonSlug]);

  // Auto-fetch referrals when phone is stored in cookie
  useEffect(() => {
    if (hasStoredPhone && isValidPhone && !hasFetched) {
      fetchReferrals();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasStoredPhone, isValidPhone]);

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
      className="flex min-h-screen justify-center bg-[var(--n5-bg-page)] py-4"
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Top bar with back button */}
        <div className="relative flex items-center pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="hover:bg-[var(--n5-bg-card)]/50 z-10 flex size-10 items-center justify-center rounded-full transition-all duration-150 active:scale-95"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
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

          {/* Salon name - centered */}
          <div
            className="font-heading absolute left-1/2 -translate-x-1/2 text-xl font-semibold text-[var(--n5-accent)]"
          >
            {salonName}
          </div>
        </div>

        {/* Title section */}
        <div className="pt-2 text-center">
          <h1 className="font-heading text-2xl font-bold text-[var(--n5-ink-main)]">My Referrals</h1>
          <p className="font-body mt-1 text-sm text-[var(--n5-ink-muted)]">
            Track your referrals and rewards
          </p>
        </div>

        {/* Phone lookup (shown if no stored phone or not yet fetched) */}
        {!hasStoredPhone && !hasFetched && (
          <div className="rounded-xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <p className="mb-4 text-center text-sm text-neutral-600">
              Enter your phone number to view your referrals
            </p>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-xs text-neutral-600">
                <span className="mr-1">+1</span>
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
                className="flex-1 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                disabled={loading}
              />
            </div>
            <button
              type="button"
              onClick={handleLookup}
              disabled={!isValidPhone || loading}
              className="font-body mt-4 w-full bg-[var(--n5-button-primary-bg)] py-3 text-sm font-semibold text-[var(--n5-button-primary-text)] transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderRadius: 'var(--n5-radius-pill)' }}
            >
              {loading ? 'Looking up...' : 'View My Referrals'}
            </button>
          </div>
        )}

        {/* Stats Card - only show after lookup or if phone stored */}
        {(hasFetched || hasStoredPhone) && (
          <div className="rounded-xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="flex items-center justify-around">
              <div className="text-center">
                <div className="text-2xl font-bold text-neutral-900">
                  {referrals.length}
                </div>
                <div className="text-sm text-neutral-500">Total Sent</div>
              </div>
              <div className="h-10 w-px bg-neutral-200" />
              <div className="text-center">
                <div className="font-body text-2xl font-bold text-[var(--n5-accent)]">
                  {referrals.filter(r => r.status === 'reward_earned').length}
                </div>
                <div className="font-body text-sm text-[var(--n5-ink-muted)]">Rewarded</div>
              </div>
              <div className="h-10 w-px bg-neutral-200" />
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: '#22c55e' }}>
                  $
                  {referrals.filter(r => r.status === 'reward_earned').length * 45}
                </div>
                <div className="text-sm text-neutral-500">Earned</div>
              </div>
            </div>
          </div>
        )}

        {/* Referrals List */}
        <div className="space-y-3">
          {loading && (
            <div className="rounded-xl bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <div className="text-neutral-500">Loading referrals...</div>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <div className="text-red-500">{error}</div>
            </div>
          )}

          {!loading && !error && hasFetched && referrals.length === 0 && (
            <div className="rounded-xl bg-white p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <div className="mb-2 text-3xl">💌</div>
              <p className="mb-1 font-medium text-neutral-900">No referrals yet</p>
              <p className="text-sm text-neutral-600">
                Start sharing and earn free manicures!
              </p>
              <button
                type="button"
                onClick={() => router.push(`/${locale}/invite`)}
                className="font-body mt-4 bg-[var(--n5-button-primary-bg)] px-6 py-2.5 text-sm font-semibold text-[var(--n5-button-primary-text)] transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                style={{ borderRadius: 'var(--n5-radius-pill)' }}
              >
                Invite Friends
              </button>
            </div>
          )}

          {!loading && !error && referrals.length > 0 && (
            <>
              <h2 className="text-sm font-semibold text-neutral-900">
                Referral History
              </h2>
              {referrals.map((referral) => {
                const badge = getStatusBadge(referral.status, referral.isExpired);
                const displayName = referral.refereeName || (referral.refereePhone ? `+1 ${formatPhone(referral.refereePhone)}` : 'Pending claim');
                const showExpiry = referral.daysUntilExpiry !== null && !referral.isExpired && ['claimed', 'booked'].includes(referral.status);

                return (
                  <div
                    key={referral.id}
                    className="rounded-xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-neutral-900">
                          {displayName}
                        </div>
                        {referral.refereePhone && referral.refereeName && (
                          <div className="mt-0.5 text-sm text-neutral-500">
                            +1
                            {' '}
                            {formatPhone(referral.refereePhone)}
                          </div>
                        )}
                        <div className="mt-0.5 text-sm text-neutral-500">
                          Sent
                          {' '}
                          {formatDate(referral.createdAt)}
                        </div>
                        {referral.claimedAt && (
                          <div className="mt-0.5 text-sm text-neutral-500">
                            Claimed
                            {' '}
                            {formatDate(referral.claimedAt)}
                          </div>
                        )}
                        {showExpiry && (
                          <div className="mt-1 text-xs text-amber-600">
                            ⏰
                            {' '}
                            {referral.daysUntilExpiry}
                            {' '}
                            day
                            {referral.daysUntilExpiry !== 1 ? 's' : ''}
                            {' '}
                            left to book
                          </div>
                        )}
                        {referral.hasReferrerReward && referral.status === 'reward_earned' && (
                          <div className="mt-1 text-xs text-green-600">
                            🎁 You earned a free manicure!
                          </div>
                        )}
                      </div>
                      <div
                        className="rounded-full px-3 py-1 text-sm font-medium"
                        style={{ color: badge.color, backgroundColor: badge.bgColor }}
                      >
                        {badge.label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Invite More Button - show after lookup or if phone stored */}
        {!loading && (hasFetched || hasStoredPhone) && (
          <button
            type="button"
            onClick={() => router.push(`/${locale}/invite`)}
            className="font-body w-full bg-[var(--n5-button-primary-bg)] py-3 text-sm font-semibold text-[var(--n5-button-primary-text)] shadow-[var(--n5-shadow-sm)] transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
            style={{ borderRadius: 'var(--n5-radius-pill)' }}
          >
            Invite More Friends
          </button>
        )}
      </div>
    </div>
  );
}

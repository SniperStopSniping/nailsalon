'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfettiPopup } from '@/components/ConfettiPopup';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type SectionId =
  | 'beauty-profile'
  | 'appointments'
  | 'gallery'
  | 'rewards'
  | 'invite'
  | 'membership'
  | 'rate-us'
  | 'payment';

// Helper functions for date/time formatting
function formatDateShort(isoString: string): string {
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function formatDateFull(isoString: string): string {
  const date = new Date(isoString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

// CollapsibleSection component
function CollapsibleSection({
  id,
  title,
  icon,
  children,
  isOpen,
  onToggle,
  badge,
}: {
  id: SectionId;
  title: string;
  icon: string;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: SectionId) => void;
  badge?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-white shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
      style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: themeVars.cardBorder }}
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-neutral-50/50"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{icon}</span>
          <span className="text-base font-bold text-neutral-900">{title}</span>
          {badge && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ backgroundColor: `color-mix(in srgb, ${themeVars.primary} 20%, transparent)`, color: themeVars.accent }}
            >
              {badge}
            </span>
          )}
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`text-neutral-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="border-t border-neutral-100 px-5 pb-5 pt-0">
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}

// Appointment type from API
type AppointmentData = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  totalPrice: number;
  totalDurationMinutes: number;
  clientPhone: string;
};

type ServiceData = {
  id: string;
  name: string;
  price: number;
  duration: number;
  imageUrl: string | null;
};

type TechnicianData = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type NextAppointmentResponse = {
  data: {
    appointment: AppointmentData | null;
    services: ServiceData[];
    technician: TechnicianData | null;
  };
};

// Reward data type
type RewardData = {
  id: string;
  type: 'referral_referee' | 'referral_referrer';
  eligibleServiceName: string | null;
  status: 'active' | 'used' | 'expired';
  expiresAt: string | null;
  usedAt: string | null;
  createdAt: string;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  points: number;
};

// Client preferences type
type PreferencesData = {
  favoriteTechId: string | null;
  favoriteServices: string[] | null;
  nailShape: string | null;
  nailLength: string | null;
  finishes: string[] | null;
  colorFamilies: string[] | null;
  preferredBrands: string[] | null;
  sensitivities: string[] | null;
  musicPreference: string | null;
  conversationLevel: string | null;
  beveragePreference: string[] | null;
  techNotes: string | null;
  appointmentNotes: string | null;
};

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [mounted, setMounted] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(['appointments']),
  );

  // User data - read from cookie
  const [userName, setUserName] = useState('Guest');
  const [clientPhone, setClientPhone] = useState('');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);

  // Next appointment data - fetched from real database
  const [nextAppointment, setNextAppointment] = useState<AppointmentData | null>(null);
  const [nextAppointmentServices, setNextAppointmentServices] = useState<ServiceData[]>([]);
  const [nextAppointmentTech, setNextAppointmentTech] = useState<TechnicianData | null>(null);
  const [appointmentLoading, setAppointmentLoading] = useState(true);

  // Rewards - real data from database
  const [rewards, setRewards] = useState<RewardData[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [activePoints, setActivePoints] = useState(0);

  // Gallery photos - real data from database
  const [galleryPhotos, setGalleryPhotos] = useState<Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
  }>>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);

  // Client preferences - real data from database
  const [preferences, setPreferences] = useState<PreferencesData | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);

  // Load client name and phone from cookie on mount
  useEffect(() => {
    const clientNameCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_name='));
    if (clientNameCookie) {
      const name = decodeURIComponent(clientNameCookie.split('=')[1] || '');
      if (name) setUserName(name);
    }

    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) setClientPhone(phone);
    }
  }, []);

  // Fetch next appointment from real database
  useEffect(() => {
    async function fetchNextAppointment() {
      if (!clientPhone) {
        setAppointmentLoading(false);
        return;
      }

      try {
        // Always fetch fresh data - no caching
        const response = await fetch(`/api/client/next-appointment?phone=${encodeURIComponent(clientPhone)}`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const data: NextAppointmentResponse = await response.json();
          setNextAppointment(data.data?.appointment || null);
          setNextAppointmentServices(data.data?.services || []);
          setNextAppointmentTech(data.data?.technician || null);
        }
      } catch (error) {
        console.error('Failed to fetch next appointment:', error);
      } finally {
        setAppointmentLoading(false);
      }
    }

    if (clientPhone) {
      fetchNextAppointment();
    } else {
      setAppointmentLoading(false);
    }
  }, [clientPhone]);

  // Fetch rewards from database
  useEffect(() => {
    async function fetchRewards() {
      if (!clientPhone || !salonSlug) {
        setRewardsLoading(false);
        return;
      }

      // Normalize phone to 10 digits
      const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
      if (normalizedPhone.length !== 10) {
        setRewardsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/rewards?phone=${encodeURIComponent(normalizedPhone)}&salonSlug=${encodeURIComponent(salonSlug)}`);
        if (response.ok) {
          const data = await response.json();
          setRewards(data.data?.rewards || []);
          setActivePoints(data.meta?.activePoints || 0);
        }
      } catch (error) {
        console.error('Failed to fetch rewards:', error);
      } finally {
        setRewardsLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchRewards();
    } else {
      setRewardsLoading(false);
    }
  }, [clientPhone, salonSlug]);

  // Fetch gallery photos from database
  useEffect(() => {
    async function fetchGalleryPhotos() {
      if (!clientPhone || !salonSlug) {
        setGalleryLoading(false);
        return;
      }

      try {
        const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
        if (normalizedPhone.length !== 10) {
          setGalleryLoading(false);
          return;
        }

        const response = await fetch(
          `/api/gallery?phone=${normalizedPhone}&salonSlug=${salonSlug}`,
        );

        if (response.ok) {
          const data = await response.json();
          setGalleryPhotos(data.data?.photos || []);
        }
      } catch (error) {
        console.error('Failed to fetch gallery photos:', error);
      } finally {
        setGalleryLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchGalleryPhotos();
    } else {
      setGalleryLoading(false);
    }
  }, [clientPhone, salonSlug]);

  // Fetch client preferences from database
  useEffect(() => {
    async function fetchPreferences() {
      if (!clientPhone || !salonSlug) {
        setPreferencesLoading(false);
        return;
      }

      try {
        const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
        if (normalizedPhone.length !== 10) {
          setPreferencesLoading(false);
          return;
        }

        const response = await fetch(
          `/api/client/preferences?phone=${normalizedPhone}&salonSlug=${salonSlug}`,
        );

        if (response.ok) {
          const data = await response.json();
          setPreferences(data.data?.preferences || null);
        }
      } catch (error) {
        console.error('Failed to fetch preferences:', error);
      } finally {
        setPreferencesLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchPreferences();
    } else {
      setPreferencesLoading(false);
    }
  }, [clientPhone, salonSlug]);

  // Invite state
  const [friendPhone, setFriendPhone] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const isSendingRef = useRef(false);

  // Stats
  const userStats = {
    totalVisits: 12,
    memberSince: 'March 2024',
    pointsBalance: 240,
    nextReward: 60,
    tier: 'Gold',
    savedAmount: 85,
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleSection = (sectionId: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleToggleSection = useCallback((sectionId: SectionId) => {
    toggleSection(sectionId);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const handleProfileImageClick = () => {
    profileImageInputRef.current?.click();
  };

  const handleProfileImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      return;
    }
    const imageUrl = URL.createObjectURL(file);
    setProfileImage(imageUrl);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setFriendPhone(digits);
    setInviteError(null);
  };

  // Normalize client phone for API call - strip non-digits and leading country code "1"
  const normalizedClientPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

  const handleSendReferral = useCallback(async () => {
    if (isSendingRef.current || inviteSending) return;
    if (friendPhone.length !== 10) return;

    isSendingRef.current = true;
    setInviteSending(true);
    setInviteError(null);

    try {
      const response = await fetch('/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          referrerPhone: normalizedClientPhone,
          referrerName: userName || 'Your friend',
          refereePhone: friendPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error?.code === 'DUPLICATE_REFERRAL') {
          setInviteError('You have already sent a referral to this number');
        } else if (data.error?.code === 'SELF_REFERRAL') {
          setInviteError('You cannot refer yourself');
        } else if (data.error?.code === 'EXISTING_CLIENT') {
          setInviteError('This number already has an account with us');
        } else {
          setInviteError(data.error?.message || 'Failed to send referral');
        }
        return;
      }

      // Success! Show confetti
      setShowConfetti(true);
      setFriendPhone('');
    } catch (err) {
      console.error('Error sending referral:', err);
      setInviteError('Something went wrong. Please try again.');
    } finally {
      setInviteSending(false);
      isSendingRef.current = false;
    }
  }, [friendPhone, clientPhone, userName, salonSlug, inviteSending]);

  return (
    <div
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
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
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg
              width="22"
              height="22"
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

          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        {/* Welcome Hero Section */}
        <div
          className="pb-2 pt-4 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          {/* Profile Avatar */}
          <div className="relative mb-4 inline-block">
            <div
              className="flex size-24 items-center justify-center overflow-hidden rounded-full border-4 border-white text-4xl shadow-lg"
              style={{ background: `linear-gradient(to bottom right, ${themeVars.accentSelected}, color-mix(in srgb, ${themeVars.accentSelected} 80%, ${themeVars.accent}))` }}
            >
              {profileImage
                ? (
                    <Image
                      src={profileImage}
                      alt="Profile"
                      width={96}
                      height={96}
                      className="size-full object-cover"
                      unoptimized
                    />
                  )
                : (
                    <span>👤</span>
                  )}
            </div>
            <input
              ref={profileImageInputRef}
              type="file"
              accept="image/*"
              onChange={handleProfileImageChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleProfileImageClick}
              className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full text-lg font-bold text-neutral-900 shadow-md transition-transform hover:scale-110"
              style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
            >
              +
            </button>
          </div>

          {/* Personalized Welcome */}
          <h1 className="mb-1 text-2xl font-bold text-neutral-900">
            Welcome back,
            {' '}
            {userName}
            ! ✨
          </h1>
          <p className="mb-2 text-base text-neutral-500">
            We're so happy to see you
          </p>

          {/* Member Badge */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-2"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: `color-mix(in srgb, ${themeVars.primary} 30%, transparent)`,
              background: `linear-gradient(to right, color-mix(in srgb, ${themeVars.primary} 20%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 20%, transparent))`,
            }}
          >
            <span className="text-lg">👑</span>
            <span className="text-sm font-bold" style={{ color: themeVars.accent }}>
              {userStats.tier}
              {' '}
              Member
            </span>
            <span className="text-xs text-neutral-500">
              since
              {userStats.memberSince}
            </span>
          </div>
        </div>

        {/* Stats Summary Card */}
        <div
          className="my-6 overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: `linear-gradient(to bottom right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`,
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: 'opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms',
          }}
        >
          <div className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm text-white/80">Your Journey With Us</div>
              <div className="text-sm font-semibold" style={{ color: themeVars.primary }}>
                💰 $
                {userStats.savedAmount}
                {' '}
                saved!
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-white">{userStats.totalVisits}</div>
                <div className="mt-0.5 text-xs text-white/70">Visits</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold" style={{ color: themeVars.primary }}>{userStats.pointsBalance}</div>
                <div className="mt-0.5 text-xs text-white/70">Points</div>
              </div>
              <div className="h-12 w-px bg-white/20" />
              <div className="flex-1 text-center">
                <div className="text-3xl font-bold text-white">{userStats.nextReward}</div>
                <div className="mt-0.5 text-xs text-white/70">To Free Fill</div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div
          className="mb-6 grid grid-cols-2 gap-3"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms',
          }}
        >
          <button
            type="button"
            onClick={() => router.push(`/${locale}/book/service`)}
            className="rounded-2xl p-4 shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
            style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
          >
            <span className="mb-2 block text-2xl">📅</span>
            <span className="text-base font-bold text-neutral-900">Book Now</span>
          </button>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/rewards`)}
            className="rounded-2xl bg-white p-4 shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
            style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: themeVars.cardBorder }}
          >
            <span className="mb-2 block text-2xl">🎁</span>
            <span className="text-base font-bold text-neutral-900">My Rewards</span>
          </button>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {/* Next Appointment */}
          <CollapsibleSection
            id="appointments"
            title="Next Appointment"
            icon="💅"
            isOpen={openSections.has('appointments')}
            onToggle={handleToggleSection}
            badge={nextAppointment ? formatDateShort(nextAppointment.startTime) : undefined}
          >
            <div className="space-y-4">
              {appointmentLoading && (
                <div className="py-4 text-center text-neutral-500">Loading...</div>
              )}

              {!appointmentLoading && nextAppointment && (
                <>
                  <div
                    className="flex items-center gap-4 rounded-xl p-4"
                    style={{ background: `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})` }}
                  >
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-white shadow-sm">
                      {nextAppointmentServices[0]?.imageUrl ? (
                        <Image
                          src={nextAppointmentServices[0].imageUrl}
                          alt={nextAppointmentServices.map(s => s.name).join(' + ')}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-2xl" style={{ backgroundColor: themeVars.surfaceAlt }}>
                          💅
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-lg font-bold text-neutral-900">
                        {nextAppointmentServices.map(s => s.name).join(' + ') || 'Appointment'}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-600">
                        <span style={{ color: themeVars.accent }}>✦</span>
                        <span>with {nextAppointmentTech?.name || 'Any Artist'}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-neutral-500">
                        {formatDateFull(nextAppointment.startTime)} · {formatTime(nextAppointment.startTime)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-neutral-600">Service</span>
                      <span className="font-semibold">${(nextAppointment.totalPrice / 100).toFixed(0)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-emerald-200 pt-2">
                      <span className="text-lg font-bold text-neutral-900">Total</span>
                      <span className="text-xl font-bold" style={{ color: themeVars.accent }}>${(nextAppointment.totalPrice / 100).toFixed(0)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const serviceIds = nextAppointmentServices.map(s => s.id).join(',');
                      const techId = nextAppointmentTech?.id || 'any';
                      const apptDate = new Date(nextAppointment.startTime);
                      const dateStr = apptDate.toISOString().split('T')[0];
                      const hours = apptDate.getHours();
                      const mins = apptDate.getMinutes().toString().padStart(2, '0');
                      const timeStr = `${hours}:${mins}`;
                      router.push(
                        `/${locale}/change-appointment?serviceIds=${serviceIds}&techId=${techId}&date=${dateStr}&time=${timeStr}&clientPhone=${encodeURIComponent(nextAppointment.clientPhone)}&originalAppointmentId=${encodeURIComponent(nextAppointment.id)}`,
                      );
                    }}
                    className="w-full rounded-full px-6 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                    style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                  >
                    View / Change Appointment
                  </button>
                </>
              )}

              {!appointmentLoading && !nextAppointment && (
                <div className="py-4 text-center">
                  <div className="mb-2 text-3xl">📅</div>
                  <p className="mb-3 text-neutral-600">No upcoming appointments</p>
                  <button
                    type="button"
                    onClick={() => router.push(`/${locale}/book/service`)}
                    className="rounded-full px-6 py-2.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                    style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
                  >
                    Book Now
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => router.push(`/${locale}/appointments/history`)}
                className="w-full text-base font-medium transition-colors hover:opacity-80"
                style={{ color: themeVars.accent }}
              >
                View All Past Visits →
              </button>
            </div>
          </CollapsibleSection>

          {/* Nail Gallery */}
          <CollapsibleSection
            id="gallery"
            title="Your Nail Journey"
            icon="📸"
            isOpen={openSections.has('gallery')}
            onToggle={handleToggleSection}
            badge={galleryLoading ? '...' : galleryPhotos.length > 0 ? `${galleryPhotos.length} looks` : 'Start your collection'}
          >
            <div className="space-y-4">
              {galleryLoading ? (
                <div className="flex items-center justify-center py-4">
                  <div
                    className="size-6 animate-spin rounded-full border-2 border-t-transparent"
                    style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
                  />
                </div>
              ) : galleryPhotos.length > 0 ? (
                <>
                  <p className="text-sm text-neutral-600">
                    Your beautiful nail collection from past visits
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {galleryPhotos.slice(0, 3).map(photo => (
                      <button
                        key={photo.id}
                        type="button"
                        aria-label="View gallery"
                        className="relative aspect-square cursor-pointer overflow-hidden rounded-xl shadow-sm transition-transform hover:scale-105"
                        style={{ background: `linear-gradient(to bottom right, ${themeVars.selectedBackground}, ${themeVars.borderMuted})` }}
                        onClick={() => router.push(`/${locale}/gallery`)}
                      >
                        <Image
                          src={photo.thumbnailUrl || photo.imageUrl}
                          alt="Nail gallery"
                          fill
                          className="object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-neutral-600">
                    Your nail photos will appear here after your appointments
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3].map(i => (
                      <div
                        key={i}
                        className="relative aspect-square overflow-hidden rounded-xl"
                        style={{ background: `linear-gradient(to bottom right, ${themeVars.background}, color-mix(in srgb, ${themeVars.primaryDark} 20%, white))` }}
                      >
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-2xl opacity-30">💅</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-center text-xs text-neutral-400">
                    Placeholders - your real photos will replace these
                  </p>
                </>
              )}
              <button
                type="button"
                onClick={() => router.push(`/${locale}/gallery`)}
                className="w-full text-base font-medium transition-colors hover:opacity-80"
                style={{ color: themeVars.accent }}
              >
                View Full Gallery →
              </button>
            </div>
          </CollapsibleSection>

          {/* Invite Friends */}
          <CollapsibleSection
            id="invite"
            title="Share the Love"
            icon="💝"
            isOpen={openSections.has('invite')}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4">
              <div
                className="rounded-xl p-4 text-center"
                style={{ background: `linear-gradient(to bottom right, ${themeVars.background}, ${themeVars.selectedBackground})` }}
              >
                <div className="mb-2 text-3xl">🎁</div>
                <div className="mb-1 text-lg font-bold text-neutral-900">
                  Give $10, Get $15
                </div>
                <p className="text-sm text-neutral-600">
                  Share the gift of beautiful nails with friends
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="friend-phone" className="text-sm font-bold text-neutral-900">
                  Friend&apos;s Phone Number
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-full bg-neutral-100 px-3 py-2.5 text-sm font-medium text-neutral-600">
                    +1
                  </div>
                  <input
                    id="friend-phone"
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={friendPhone}
                    onChange={handlePhoneChange}
                    placeholder="(555) 123-4567"
                    className="min-w-0 flex-1 rounded-full bg-neutral-100 px-4 py-2.5 text-base text-neutral-800 outline-none transition-all placeholder:text-neutral-400 focus:ring-2"
                    style={{ '--tw-ring-color': `color-mix(in srgb, ${themeVars.accent} 30%, transparent)` } as React.CSSProperties}
                    disabled={inviteSending}
                  />
                </div>
                {inviteError && (
                  <p className="text-center text-base font-medium text-red-600">
                    {inviteError}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleSendReferral}
                disabled={friendPhone.length !== 10 || inviteSending}
                className="w-full rounded-full px-6 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
              >
                {inviteSending ? 'Sending...' : 'Send Referral'}
              </button>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/invite`)}
                className="w-full text-base font-medium transition-colors hover:opacity-80"
                style={{ color: themeVars.accent }}
              >
                Share Referral Link
              </button>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/my-referrals`)}
                className="w-full text-base font-medium transition-colors hover:opacity-80"
                style={{ color: themeVars.accent }}
              >
                View My Referrals →
              </button>
            </div>
          </CollapsibleSection>

          {/* Rewards */}
          <CollapsibleSection
            id="rewards"
            title="My Rewards"
            icon="🎁"
            isOpen={openSections.has('rewards')}
            onToggle={handleToggleSection}
            badge={rewards.filter(r => r.status === 'active' && !r.isExpired).length > 0 ? `${rewards.filter(r => r.status === 'active' && !r.isExpired).length} Active` : undefined}
          >
            <div className="space-y-4">
              {/* Loading state */}
              {rewardsLoading && (
                <div className="py-4 text-center text-neutral-500">Loading rewards...</div>
              )}

              {/* No rewards */}
              {!rewardsLoading && rewards.length === 0 && (
                <div className="py-4 text-center">
                  <div className="mb-2 text-3xl">🎁</div>
                  <p className="text-sm text-neutral-600">No rewards yet</p>
                  <p className="mt-1 text-xs text-neutral-500">Invite friends to earn free manicures!</p>
                </div>
              )}

              {/* Rewards list */}
              {!rewardsLoading && rewards.length > 0 && (
                <div className="space-y-3">
                  {rewards.map((reward) => {
                    const isActive = reward.status === 'active' && !reward.isExpired;
                    const isUsed = reward.status === 'used';
                    const isExpired = reward.status === 'expired' || reward.isExpired;

                    let statusBadge = { label: 'Active', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.15)' };
                    if (isUsed) {
                      statusBadge = { label: 'Used', color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.15)' };
                    } else if (isExpired) {
                      statusBadge = { label: 'Expired', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' };
                    }

                    const rewardLabel = reward.type === 'referral_referee'
                      ? `${reward.points.toLocaleString()} pts - Referral Reward`
                      : `${reward.points.toLocaleString()} pts - Referrer Bonus`;

                    return (
                      <div
                        key={reward.id}
                        className="rounded-xl p-3"
                        style={{ backgroundColor: themeVars.surfaceAlt }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">🎁</span>
                            <div>
                              <div className="text-sm font-semibold text-neutral-900">
                                {rewardLabel}
                              </div>
                              {isActive && reward.daysUntilExpiry !== null && (
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  Expires in {reward.daysUntilExpiry} day{reward.daysUntilExpiry !== 1 ? 's' : ''}
                                </div>
                              )}
                              {isUsed && reward.usedAt && (
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  Used on {new Date(reward.usedAt).toLocaleDateString()}
                                </div>
                              )}
                              {isExpired && !isUsed && (
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  Reward expired
                                </div>
                              )}
                            </div>
                          </div>
                          <div
                            className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{ color: statusBadge.color, backgroundColor: statusBadge.bgColor }}
                          >
                            {statusBadge.label}
                          </div>
                        </div>
                        {isActive && (
                          <button
                            type="button"
                            onClick={() => router.push(`/${locale}/book/service`)}
                            className="mt-3 w-full rounded-full py-2 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                            style={{ backgroundColor: themeVars.primary }}
                          >
                            Book Now to Redeem
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Points section */}
              <div className="border-t border-neutral-100 pt-4">
                <div className="text-sm text-neutral-900">
                  You have
                  {' '}
                  <span className="font-semibold">{activePoints.toLocaleString()} points</span>
                </div>
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between text-sm text-neutral-600">
                    {activePoints >= 2500 ? (
                      <span>You have enough points for a FREE Manicure!</span>
                    ) : (
                      <span>{(2500 - activePoints).toLocaleString()} points until FREE Manicure</span>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full rounded-full"
                      style={{ 
                        width: `${Math.min(100, (activePoints / 2500) * 100)}%`, 
                        background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` 
                      }}
                    />
                  </div>
                  <div className="text-xs text-neutral-500">
                    2,500 pts = Free Gel Manicure
                  </div>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Membership */}
          <CollapsibleSection
            id="membership"
            title="Gold Membership"
            icon="👑"
            isOpen={openSections.has('membership')}
            onToggle={handleToggleSection}
            badge="Active"
          >
            <div className="space-y-4">
              <div
                className="rounded-xl p-4"
                style={{
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: `color-mix(in srgb, ${themeVars.primary} 30%, transparent)`,
                  background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 20%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 20%, transparent))`,
                }}
              >
                <div className="mb-3 text-lg font-bold text-neutral-900">
                  Your Gold Benefits
                </div>
                <ul className="space-y-2.5">
                  {[
                    { icon: '⚡', text: 'Priority booking - skip the wait' },
                    { icon: '🎂', text: 'Birthday surprise gift' },
                    { icon: '✨', text: '2x points on all services' },
                    { icon: '💎', text: 'Exclusive member-only offers' },
                  ].map(benefit => (
                    <li key={benefit.text} className="flex items-center gap-3 text-sm text-neutral-700">
                      <span className="text-lg">{benefit.icon}</span>
                      <span>{benefit.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-center text-sm text-neutral-500">
                Thank you for being a valued member! 💜
              </p>
            </div>
          </CollapsibleSection>

          {/* Rate Us */}
          <CollapsibleSection
            id="rate-us"
            title="Love Your Nails?"
            icon="⭐"
            isOpen={openSections.has('rate-us')}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4 text-center">
              <div className="text-4xl">⭐⭐⭐⭐⭐</div>
              <p className="text-base text-neutral-600">
                Your reviews help us grow and serve you better!
              </p>
              <button
                type="button"
                onClick={() => {
                  window.open('https://www.google.com/maps/place/Nail+Salon+No.5', '_blank');
                }}
                className="w-full rounded-full border-2 bg-white px-6 py-3.5 text-base font-bold shadow-sm transition-all duration-200 active:scale-[0.98]"
                style={{
                  borderColor: themeVars.accent,
                  color: themeVars.accent,
                }}
              >
                Leave a Google Review
              </button>
            </div>
          </CollapsibleSection>

          {/* Beauty Preferences */}
          <CollapsibleSection
            id="beauty-profile"
            title="Your Style Profile"
            icon="💅"
            isOpen={openSections.has('beauty-profile')}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">
                We remember your preferences so every visit feels personalized
              </p>

              {preferencesLoading ? (
                <div className="flex items-center justify-center py-4">
                  <div
                    className="size-6 animate-spin rounded-full border-2 border-t-transparent"
                    style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
                  />
                </div>
              ) : preferences ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        label: 'Favorite Tech',
                        value: preferences.favoriteTechId
                          ? preferences.favoriteTechId.charAt(0).toUpperCase() + preferences.favoriteTechId.slice(1)
                          : 'Not set',
                        icon: '👩‍🎨',
                      },
                      {
                        label: 'Go-To Service',
                        value: preferences.favoriteServices && preferences.favoriteServices.length > 0
                          ? preferences.favoriteServices[0]!.toUpperCase()
                          : 'Not set',
                        icon: '💅',
                      },
                      {
                        label: 'Nail Shape',
                        value: preferences.nailShape
                          ? preferences.nailShape.charAt(0).toUpperCase() + preferences.nailShape.slice(1)
                          : 'Not set',
                        icon: '✨',
                      },
                      {
                        label: 'Favorite Finish',
                        value: preferences.finishes && preferences.finishes.length > 0
                          ? preferences.finishes[0]!.charAt(0).toUpperCase() + preferences.finishes[0]!.slice(1)
                          : 'Not set',
                        icon: '✦',
                      },
                    ].map(pref => (
                      <div key={pref.label} className="rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
                        <div className="mb-1 text-lg">{pref.icon}</div>
                        <div className="text-xs text-neutral-500">{pref.label}</div>
                        <div className="text-sm font-bold text-neutral-900">{pref.value}</div>
                      </div>
                    ))}
                  </div>

                  {preferences.colorFamilies && preferences.colorFamilies.length > 0 && (
                    <div className="rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
                      <div className="mb-1 text-xs text-neutral-500">Favorite Colors</div>
                      <div className="flex flex-wrap gap-2">
                        {preferences.colorFamilies.map(color => (
                          <span
                            key={color}
                            className="rounded-full px-3 py-1 text-xs font-medium"
                            style={{ backgroundColor: themeVars.accentSelected, color: themeVars.accent }}
                          >
                            {color.charAt(0).toUpperCase() + color.slice(1)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-4 text-center">
                  <div className="mb-2 text-3xl">✨</div>
                  <p className="text-sm text-neutral-600">No preferences saved yet</p>
                  <p className="mt-1 text-xs text-neutral-500">Set your style profile for a personalized experience</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => router.push(`/${locale}/preferences`)}
                className="w-full text-base font-medium transition-colors hover:opacity-80"
                style={{ color: themeVars.accent }}
              >
                {preferences ? 'Edit Preferences →' : 'Set Up My Style Profile →'}
              </button>
            </div>
          </CollapsibleSection>

          {/* Payment Methods */}
          <CollapsibleSection
            id="payment"
            title="Payment"
            icon="💳"
            isOpen={openSections.has('payment')}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl p-4" style={{ backgroundColor: themeVars.surfaceAlt }}>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#1a1f71] to-[#2d3494] text-xs font-bold text-white">
                    VISA
                  </div>
                  <div>
                    <div className="text-sm font-bold text-neutral-900">•••• 4242</div>
                    <div className="text-xs text-neutral-500">Expires 12/25</div>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
                  Default
                </span>
              </div>
              <button
                type="button"
                className="w-full text-base font-medium transition-colors hover:opacity-80"
                style={{ color: themeVars.accent }}
              >
                Manage Payment Methods →
              </button>
            </div>
          </CollapsibleSection>

          {/* Sign Out Button */}
          <button
            type="button"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              router.push('/book/service');
            }}
            className="w-full rounded-xl border-2 border-red-200 bg-red-50 py-3 text-base font-semibold text-red-600 transition-all duration-150 hover:bg-red-100 active:scale-[0.98]"
          >
            Sign Out
          </button>
        </div>

        {/* Footer Message */}
        <div
          className="mt-8 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 500ms',
          }}
        >
          <p className="text-sm text-neutral-400">
            Thank you for choosing {salonName} 💜
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            We appreciate you being part of our family
          </p>
        </div>

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>

      {/* Confetti Popup */}
      <ConfettiPopup
        isOpen={showConfetti}
        onClose={() => setShowConfetti(false)}
        title="You just gifted your friend a FREE manicure!"
        message="They'll receive a text with your referral. When they book, you both win!"
        emoji="🎊"
        autoDismissMs={4000}
      />
    </div>
  );
}

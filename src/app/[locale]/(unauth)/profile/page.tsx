'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

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

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [mounted, setMounted] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(['appointments']),
  );

  // User data
  const [userName, _setUserName] = useState('Sarah');
  const [_isEditMode, _setIsEditMode] = useState(false);
  const [_editedName, _setEditedName] = useState('Sarah');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);

  // Invite state
  const [friendPhone, setFriendPhone] = useState('');
  const [inviteSent, setInviteSent] = useState(false);
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

    if (digits.length === 10 && !inviteSent && !isSendingRef.current) {
      isSendingRef.current = true;
      setInviteSent(true);
      setTimeout(() => {
        setInviteSent(false);
        setFriendPhone('');
        isSendingRef.current = false;
      }, 3000);
    }
  };

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
            badge="Dec 18"
          >
            <div className="space-y-4">
              <div
                className="flex items-center gap-4 rounded-xl p-4"
                style={{ background: `linear-gradient(to bottom right, ${themeVars.surfaceAlt}, ${themeVars.highlightBackground})` }}
              >
                <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-white shadow-sm">
                  <Image
                    src="/assets/images/biab-medium.webp"
                    alt="BIAB Refill"
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-lg font-bold text-neutral-900">BIAB Refill</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm text-neutral-600">
                    <span style={{ color: themeVars.accent }}>✦</span>
                    <span>with Tiffany</span>
                  </div>
                  <div className="mt-0.5 text-sm text-neutral-500">
                    Thu, Dec 18 · 2:00 PM
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-neutral-600">Service</span>
                  <span className="font-semibold">$65</span>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-neutral-600">Your Reward</span>
                  <span className="font-bold text-emerald-600">-$5</span>
                </div>
                <div className="flex items-center justify-between border-t border-emerald-200 pt-2">
                  <span className="text-lg font-bold text-neutral-900">Total</span>
                  <span className="text-xl font-bold" style={{ color: themeVars.accent }}>$60</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  router.push(
                    `/${locale}/change-appointment?serviceIds=biab-medium&techId=tiffany&date=2025-12-18&time=14:00`,
                  );
                }}
                className="w-full rounded-full px-6 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
              >
                View / Change Appointment
              </button>

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
            badge="9 looks"
          >
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">
                Your beautiful nail collection from past visits
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  '/assets/images/biab-short.webp',
                  '/assets/images/gel-x-extensions.jpg',
                  '/assets/images/biab-medium.webp',
                ].map(img => (
                  <button
                    key={img}
                    type="button"
                    aria-label="View gallery"
                    className="relative aspect-square cursor-pointer overflow-hidden rounded-xl shadow-sm transition-transform hover:scale-105"
                    style={{ background: `linear-gradient(to bottom right, ${themeVars.selectedBackground}, ${themeVars.borderMuted})` }}
                    onClick={() => router.push(`/${locale}/gallery`)}
                  >
                    <Image
                      src={img}
                      alt="Nail gallery"
                      fill
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
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
                  Friend's Phone Number
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
                  />
                </div>
                {inviteSent && (
                  <p className="text-center text-base font-medium text-emerald-600">
                    ✓ Invite sent! 🎉
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/invite`)}
                className="w-full rounded-full px-6 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
                style={{ background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` }}
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

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Favorite Tech', value: 'Daniela', icon: '👩‍🎨' },
                  { label: 'Go-To Service', value: 'BIAB', icon: '💅' },
                  { label: 'Nail Shape', value: 'Almond', icon: '✨' },
                  { label: 'Favorite Finish', value: 'Glossy', icon: '✦' },
                ].map(pref => (
                  <div key={pref.label} className="rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
                    <div className="mb-1 text-lg">{pref.icon}</div>
                    <div className="text-xs text-neutral-500">{pref.label}</div>
                    <div className="text-sm font-bold text-neutral-900">{pref.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
                <div className="mb-1 text-xs text-neutral-500">Favorite Colors</div>
                <div className="flex flex-wrap gap-2">
                  {['Nudes', 'Pinks', 'French'].map(color => (
                    <span
                      key={color}
                      className="rounded-full px-3 py-1 text-xs font-medium"
                      style={{ backgroundColor: themeVars.accentSelected, color: themeVars.accent }}
                    >
                      {color}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/preferences`)}
                className="w-full text-base font-medium transition-colors hover:opacity-80"
                style={{ color: themeVars.accent }}
              >
                Edit Preferences →
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
    </div>
  );
}

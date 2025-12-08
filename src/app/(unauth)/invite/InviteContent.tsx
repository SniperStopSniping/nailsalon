'use client';

import type { Easing } from 'framer-motion';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronRight,
  Copy,
  Gift,
  Link as LinkIcon,
  Send,
  Sparkles,
  Star,
  Users,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfettiPopup } from '@/components/ConfettiPopup';
import { useSalon } from '@/providers/SalonProvider';
import { n5 } from '@/theme';
import { cn } from '@/utils/Helpers';

// Simple web haptic helper
const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

// --- Animation Variants ---
const meshVariant = {
  animate: {
    scale: [1, 1.1, 0.9, 1],
    x: [0, 20, -20, 0],
    y: [0, -20, 20, 0],
    rotate: [0, 10, -10, 0],
    transition: {
      duration: 15,
      repeat: Infinity,
      ease: 'easeInOut' as Easing,
    },
  },
};

// --- Subcomponents ---

/**
 * Hero Card with animated mesh background
 */
const HeroCard = () => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="relative w-full overflow-hidden bg-[var(--n5-bg-card)]"
    style={{
      borderRadius: n5.radiusCard,
      boxShadow: n5.shadowLg,
      padding: n5.spaceLg,
    }}
  >
    {/* Animated Mesh Background */}
    <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: n5.radiusCard }}>
      <motion.div
        variants={meshVariant}
        animate="animate"
        className="absolute -top-1/2 left-[-20%] h-full w-4/5 rounded-full opacity-60 blur-[80px] bg-[var(--n5-accent-soft)]"
      />
      <motion.div
        variants={meshVariant}
        animate="animate"
        transition={{ delay: 2, duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-[-20%] right-[-10%] h-4/5 w-3/5 rounded-full opacity-40 blur-[60px] bg-[var(--n5-bg-highlight)]"
      />
    </div>

    {/* Glass Surface */}
    <div
      className="absolute inset-0 bg-[var(--n5-bg-card)]/30 backdrop-blur-[20px]"
      style={{ borderRadius: n5.radiusCard }}
    />

    {/* Content */}
    <div className="relative z-10 flex flex-col items-center text-center">
      <div
        className="mb-4 flex size-16 items-center justify-center shadow-sm bg-[var(--n5-accent)]"
        style={{ borderRadius: n5.radiusPill }}
      >
        <Gift className="size-8 text-white" strokeWidth={1.5} />
      </div>

      <h2 className="mb-2 font-heading text-2xl font-semibold text-[var(--n5-ink-main)]">
        Share the Love
      </h2>

      <p className="mb-6 max-w-xs text-sm leading-relaxed text-[var(--n5-ink-muted)] font-body">
        Invite friends to experience our salon. When they book, you both get rewarded!
      </p>

      {/* Reward Pills */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-2 border px-4 py-2 bg-[var(--n5-bg-surface)]"
          style={{
            borderRadius: n5.radiusPill,
            borderColor: 'var(--n5-border)',
          }}
        >
          <Sparkles className="size-4 text-[var(--n5-accent)]" />
          <span className="text-xs font-bold text-[var(--n5-ink-main)] font-body">
            You get $35 OFF
          </span>
        </div>
        <div
          className="flex items-center gap-2 border px-4 py-2 bg-[var(--n5-bg-surface)]"
          style={{
            borderRadius: n5.radiusPill,
            borderColor: 'var(--n5-border)',
          }}
        >
          <Gift className="size-4 text-[var(--n5-success)]" />
          <span className="text-xs font-bold text-[var(--n5-ink-main)] font-body">
            They get FREE mani
          </span>
        </div>
      </div>
    </div>
  </motion.div>
);

/**
 * Action Card - for send referral or copy link
 */
const ActionCard = ({
  title,
  description,
  icon: Icon,
  children,
  delay = 0,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  children: React.ReactNode;
  delay?: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    className="overflow-hidden bg-[var(--n5-bg-card)]"
    style={{
      borderRadius: n5.radiusCard,
      boxShadow: n5.shadowSm,
    }}
  >
    <div style={{ padding: n5.spaceLg }}>
      <div className="mb-4 flex items-center gap-3">
        <div
          className="flex size-10 items-center justify-center bg-[var(--n5-accent-soft)] text-[var(--n5-accent)]"
          style={{ borderRadius: n5.radiusMd }}
        >
          <Icon className="size-5" strokeWidth={2} />
        </div>
        <div>
          <h3 className="font-heading text-base font-semibold text-[var(--n5-ink-main)]">
            {title}
          </h3>
          <p className="text-xs text-[var(--n5-ink-muted)] font-body">{description}</p>
        </div>
      </div>
      {children}
    </div>
  </motion.div>
);

/**
 * Settings-style list item
 */
const SettingsItem = ({
  label,
  icon: Icon,
  badge,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  badge?: string;
  onClick?: () => void;
}) => (
  <button
    type="button"
    onClick={() => {
      triggerHaptic();
      onClick?.();
    }}
    aria-label={`Go to ${label}`}
    className="group flex min-h-[56px] w-full cursor-pointer items-center justify-between p-4 transition-colors last:border-0 hover:bg-[var(--n5-bg-surface)] active:bg-[var(--n5-bg-selected)]"
    style={{ borderBottomWidth: 0 }}
  >
    <div className="flex items-center space-x-3">
      <div
        className="p-2 transition-colors group-hover:text-[var(--n5-accent-hover)] bg-[var(--n5-bg-surface)] text-[var(--n5-accent)]"
        style={{ borderRadius: n5.radiusSm }}
      >
        <Icon size={18} strokeWidth={2} />
      </div>
      <span className="text-[15px] font-medium text-[var(--n5-ink-main)] font-body">{label}</span>
    </div>
    <div className="flex items-center space-x-2">
      {badge && (
        <span
          className="px-2 py-1 text-[10px] font-bold bg-[var(--n5-success)]/10 text-[var(--n5-success)] font-body"
          style={{ borderRadius: n5.radiusPill }}
        >
          {badge}
        </span>
      )}
      <ChevronRight
        size={16}
        className="transition-colors group-hover:text-[var(--n5-accent)] text-[var(--n5-ink-muted)]"
      />
    </div>
  </button>
);

// --- MAIN COMPONENT ---

export default function InviteContent() {
  const router = useRouter();
  const params = useParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [friendPhone, setFriendPhone] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // Get user info from cookies
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');

  // Referral link state
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  // Prevent double submission
  const sendingRef = useRef(false);

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
      if (phone) setUserPhone(phone);
    }
  }, []);

  // Normalize user phone for API calls
  const normalizedUserPhone = userPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

  const handleSendReferral = useCallback(async () => {
    if (sendingRef.current || isSending) return;
    if (!friendPhone.trim() || friendPhone.length !== 10) return;

    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    triggerHaptic();

    try {
      const response = await fetch('/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          referrerPhone: normalizedUserPhone,
          referrerName: userName || 'Your friend',
          refereePhone: friendPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error?.code === 'DUPLICATE_REFERRAL') {
          setError('You have already sent a referral to this number');
        } else if (data.error?.code === 'SELF_REFERRAL') {
          setError('You cannot refer yourself');
        } else if (data.error?.code === 'EXISTING_CLIENT') {
          setError('This number already has an account with us');
        } else {
          setError(data.error?.message || 'Failed to send referral');
        }
        return;
      }

      setShowConfetti(true);
      setFriendPhone('');
    } catch (err) {
      console.error('Error sending referral:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSending(false);
      sendingRef.current = false;
    }
  }, [friendPhone, normalizedUserPhone, userName, salonSlug, isSending]);

  const handleCopyLink = useCallback(async () => {
    setIsGeneratingLink(true);
    setError(null);
    triggerHaptic();

    try {
      const response = await fetch('/api/referrals/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          referrerPhone: normalizedUserPhone,
          referrerName: userName || 'Your friend',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error?.message || 'Failed to generate referral link');
        setIsGeneratingLink(false);
        return;
      }

      const generatedLink = data.data.referralUrl;
      setReferralLink(generatedLink);

      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (err) {
      console.error('Error generating referral link:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsGeneratingLink(false);
    }
  }, [normalizedUserPhone, userName, salonSlug]);

  const handleBack = useCallback(() => {
    triggerHaptic();
    router.back();
  }, [router]);

  const isValidPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10;
  };

  return (
    <div className="min-h-screen bg-[var(--n5-bg-page)]" style={{ fontFamily: n5.fontBody }}>
      {/* Navbar - Fixed & Blurred */}
      <nav
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b px-5 pb-2 pt-12 backdrop-blur-md"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--n5-bg-page) 80%, transparent)',
          borderColor: 'var(--n5-border-muted)',
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className="flex size-10 items-center justify-center bg-[var(--n5-bg-card)] shadow-sm transition-transform active:scale-90 text-[var(--n5-ink-main)]"
          style={{ borderRadius: n5.radiusPill }}
        >
          <ChevronRight className="size-5 rotate-180" />
        </button>
        <span className="font-heading text-lg font-semibold tracking-tight text-[var(--n5-ink-main)]">
          Refer a Friend
        </span>
        <div className="w-10" /> {/* Spacer for centering */}
      </nav>

      {/* Main Content */}
      <main className="mx-auto max-w-lg space-y-6 px-5 pb-28 pt-28">
        {/* Hero Card */}
        <HeroCard />

        {/* Send Referral Card */}
        <ActionCard
          title="Text a Friend"
          description="We'll send them an invite with your name"
          icon={Send}
          delay={0.1}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div
                className="flex items-center px-3 py-2.5 text-xs font-medium bg-[var(--n5-bg-surface)] text-[var(--n5-ink-muted)] font-body"
                style={{ borderRadius: n5.radiusPill }}
              >
                +1
              </div>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                value={friendPhone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  setFriendPhone(digits.slice(0, 10));
                  setError(null);
                }}
                placeholder="Friend's phone number"
                className="flex-1 px-4 py-2.5 text-sm font-body bg-[var(--n5-bg-surface)] text-[var(--n5-ink-main)] outline-none placeholder:text-[var(--n5-ink-muted)]"
                style={{ borderRadius: n5.radiusPill }}
                disabled={isSending}
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-center text-xs font-body text-[var(--n5-error)]"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="button"
              onClick={handleSendReferral}
              disabled={!isValidPhone(friendPhone) || isSending}
              className="flex w-full items-center justify-center gap-2 py-3 text-sm font-semibold text-[var(--n5-ink-inverse)] transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 bg-[var(--n5-accent)] font-body"
              style={{
                borderRadius: n5.radiusMd,
                boxShadow: n5.shadowSm,
              }}
            >
              {isSending ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="size-4 rounded-full border-2 border-white/30 border-t-white"
                />
              ) : (
                <>
                  <Send className="size-4" />
                  <span>Send Invite</span>
                </>
              )}
            </button>
          </div>
        </ActionCard>

        {/* Copy Link Card */}
        <ActionCard
          title="Share Your Link"
          description="Copy and share anywhere you like"
          icon={LinkIcon}
          delay={0.2}
        >
          <div className="space-y-3">
            {referralLink && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="overflow-hidden"
              >
                <p
                  className="break-all p-3 text-xs font-body bg-[var(--n5-bg-surface)] text-[var(--n5-ink-main)]"
                  style={{ borderRadius: n5.radiusMd }}
                >
                  {referralLink}
                </p>
              </motion.div>
            )}

            <button
              type="button"
              onClick={handleCopyLink}
              disabled={isGeneratingLink}
              className={cn(
                'flex w-full items-center justify-center gap-2 border py-3 text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 font-body',
                copied
                  ? 'border-[var(--n5-success)] bg-[var(--n5-success)]/10 text-[var(--n5-success)]'
                  : 'border-[var(--n5-border)] bg-transparent text-[var(--n5-ink-main)]',
              )}
              style={{ borderRadius: n5.radiusMd }}
            >
              {isGeneratingLink ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="size-4 rounded-full border-2 border-current/30 border-t-current"
                />
              ) : copied ? (
                <>
                  <Check className="size-4" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="size-4" />
                  <span>Copy Referral Link</span>
                </>
              )}
            </button>
          </div>
        </ActionCard>

        {/* More Ways Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <h3 className="mb-2 px-4 text-xs font-bold uppercase tracking-widest opacity-80 text-[var(--n5-ink-muted)] font-heading">
            More Ways to Earn
          </h3>
          <div
            className="overflow-hidden bg-[var(--n5-bg-card)]"
            style={{
              borderRadius: n5.radiusCard,
              boxShadow: n5.shadowSm,
            }}
          >
            <SettingsItem
              label="Leave a Google Review"
              icon={Star}
              badge="$25 OFF"
              onClick={() => window.open('https://www.google.com/maps/place/Nail+Salon+No.5', '_blank')}
            />
            <div style={{ height: 1, backgroundColor: 'var(--n5-border-muted)' }} />
            <SettingsItem
              label="View My Referrals"
              icon={Users}
              onClick={() => router.push(`/${locale}/my-referrals`)}
            />
          </div>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="pt-6 text-center opacity-40"
        >
          <p className="font-heading text-[10px] italic text-[var(--n5-ink-main)]">
            {salonName || 'Nail Salon No.5'}
            {' '}
            · Referral Program
          </p>
        </motion.div>
      </main>

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

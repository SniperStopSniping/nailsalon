'use client';

/**
 * SettingsModal Component
 *
 * iOS Settings-style grouped list view.
 * Features:
 * - Profile card
 * - Grouped sections with rounded corners
 * - Toggle switches with spring animation
 * - Navigation rows with chevrons
 * - Footer text for sections
 */

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  Check,
  ChevronRight,
  Eye,
  Flag,
  Gift,
  MessageSquare,
  Moon,
  Search,
  Shield,
  User,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import type { BookingStep } from '@/libs/bookingFlow';
import type { ResolvedLoyaltyPoints } from '@/libs/loyalty';
import { useSalon } from '@/providers/SalonProvider';
import type { ModuleKey, ResolvedModules, SalonVisibilityPolicy } from '@/types/salonPolicy';

import { BackButton, ModalHeader } from './AppModal';
import { BookingFlowEditor } from './BookingFlowEditor';
import { PageThemesSettings } from './PageThemesSettings';

/**
 * Section Container
 */
type SectionProps = {
  title?: string;
  footer?: string;
  children: ReactNode;
};

function Section({ title, footer, children }: SectionProps) {
  return (
    <div className="mb-6">
      {title && (
        <div className="mb-2 px-4 text-[13px] uppercase tracking-wide text-gray-500">
          {title}
        </div>
      )}
      <div className="mx-4 overflow-visible rounded-[10px] border border-gray-200/50 bg-white shadow-sm">
        {children}
      </div>
      {footer && (
        <div className="mt-2 px-8 text-[12px] leading-snug text-gray-500">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Settings Row
 */
type RowProps = {
  icon?: LucideIcon;
  iconColor?: string;
  label: string;
  value?: string;
  type?: 'link' | 'toggle';
  isLast?: boolean;
  defaultOn?: boolean;
  onToggle?: (value: boolean) => void;
  onClick?: () => void;
};

function Row({
  icon: Icon,
  iconColor = 'bg-gray-500',
  label,
  value,
  type = 'link',
  isLast = false,
  defaultOn = true,
  onToggle,
  onClick,
}: RowProps) {
  const [isOn, setIsOn] = useState(defaultOn);

  const handleToggle = () => {
    const newValue = !isOn;
    setIsOn(newValue);
    onToggle?.(newValue);
  };

  return (
    <div
      className="flex min-h-[48px] cursor-pointer items-center pl-4 transition-colors active:bg-gray-50"
      onClick={type === 'link' ? onClick : undefined}
    >
      {/* Icon */}
      {Icon && (
        <div
          className={`mr-3 flex size-7 items-center justify-center rounded-[6px] text-white shadow-sm ${iconColor}`}
        >
          <Icon className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <span className="text-[16px] tracking-tight text-black">{label}</span>

        <div className="flex items-center gap-2">
          {value && <span className="text-[16px] text-[#8E8E93]">{value}</span>}

          {type === 'link' && <ChevronRight className="size-4 text-[#C7C7CC]" />}

          {type === 'toggle' && (
            <button
              type="button"
              onClick={handleToggle}
              aria-label={`Toggle ${label}`}
              className={`
                relative h-[31px] w-[51px] rounded-full p-0.5 transition-colors duration-300
                ${isOn ? 'bg-[#34C759]' : 'bg-[#E9E9EA]'}
              `}
            >
              <motion.div
                animate={{ x: isOn ? 20 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="size-[27px] rounded-full bg-white shadow-md"
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Module Row (Step 16.3)
 * Entitlement-aware toggle row for modules
 */
type ModuleRowProps = {
  icon?: LucideIcon;
  iconColor?: string;
  label: string;
  moduleKey: ModuleKey;
  enabled: boolean;
  entitled: boolean;
  isLast?: boolean;
  onToggle: (moduleKey: ModuleKey, value: boolean) => void;
};

function ModuleRow({
  icon: Icon,
  iconColor = 'bg-gray-500',
  label,
  moduleKey,
  enabled,
  entitled,
  isLast = false,
  onToggle,
}: ModuleRowProps) {
  const handleToggle = () => {
    if (!entitled) {
      return;
    }
    onToggle(moduleKey, !enabled);
  };

  return (
    <div
      className={`flex min-h-[48px] items-center pl-4 ${entitled ? '' : 'opacity-60'}`}
    >
      {/* Icon */}
      {Icon && (
        <div
          className={`mr-3 flex size-7 items-center justify-center rounded-[6px] text-white shadow-sm ${iconColor}`}
        >
          <Icon className="size-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <div className="flex flex-col">
          <span className="text-[16px] tracking-tight text-black">{label}</span>
          {!entitled && (
            <span className="text-[11px] text-amber-600">Upgrade required</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggle}
            disabled={!entitled}
            aria-label={`Toggle ${label}`}
            className={`
              relative h-[31px] w-[51px] rounded-full p-0.5 transition-colors duration-300
              ${!entitled ? 'cursor-not-allowed' : 'cursor-pointer'}
              ${enabled && entitled ? 'bg-[#34C759]' : 'bg-[#E9E9EA]'}
            `}
          >
            <motion.div
              animate={{ x: enabled && entitled ? 20 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="size-[27px] rounded-full bg-white shadow-md"
            />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Profile Card
 */
type ProfileCardProps = {
  name: string;
  subtitle?: string;
  initials?: string;
  onClick?: () => void;
};

function ProfileCard({
  name,
  subtitle = 'Apple Account, iCloud, and more',
  initials,
  onClick,
}: ProfileCardProps) {
  const displayInitials = initials || name.split(' ').map(n => n[0]).join('').toUpperCase();

  return (
    <div
      className="mb-8 flex cursor-pointer items-center gap-3 px-4 transition-opacity active:opacity-70"
      onClick={onClick}
    >
      <div className="size-[60px] overflow-hidden rounded-full border border-white/50 shadow-sm">
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-gray-200 to-gray-400 text-xl font-bold text-white">
          {displayInitials}
        </div>
      </div>
      <div className="flex-1">
        <div className="text-[20px] font-normal text-[#1C1C1E]">{name}</div>
        <div className="text-[13px] text-gray-500">{subtitle}</div>
      </div>
      <ChevronRight className="size-5 text-[#C7C7CC]" />
    </div>
  );
}

/**
 * Search Bar
 */
function SearchBar() {
  return (
    <div className="px-4 pb-4">
      <div className="bg-[#767680]/12 flex h-9 items-center rounded-[10px] px-2 text-[#8E8E93]">
        <Search className="mr-2 size-4" />
        <span className="text-[16px]">Search</span>
      </div>
    </div>
  );
}

/**
 * Compare Plans Modal
 * Shows Starter/Pro/Elite plan comparison
 */
type ComparePlansModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const PLAN_FEATURES = {
  starter: {
    name: 'Starter',
    price: 'Free',
    description: 'Essential tools for small salons',
    popular: false,
    features: [
      { name: 'Online Booking', included: true },
      { name: 'Staff Dashboard', included: true },
      { name: 'Photo Uploads', included: true },
      { name: 'Client Profiles', included: true },
      { name: 'SMS Reminders', included: false },
      { name: 'Referrals Program', included: false },
      { name: 'Rewards Program', included: false },
      { name: 'Schedule Overrides', included: false },
      { name: 'Staff Earnings', included: false },
      { name: 'Client Flags', included: false },
      { name: 'Analytics Dashboard', included: false },
      { name: 'Multi-Location', included: false },
    ],
    limits: { staff: 1, locations: 1 },
  },
  pro: {
    name: 'Pro',
    price: '$49/mo',
    description: 'Marketing & client management',
    popular: true,
    features: [
      { name: 'Online Booking', included: true },
      { name: 'Staff Dashboard', included: true },
      { name: 'Photo Uploads', included: true },
      { name: 'Client Profiles', included: true },
      { name: 'SMS Reminders', included: true },
      { name: 'Referrals Program', included: true },
      { name: 'Rewards Program', included: true },
      { name: 'Schedule Overrides', included: true },
      { name: 'Staff Earnings', included: true },
      { name: 'Client Flags', included: true },
      { name: 'Analytics Dashboard', included: true },
      { name: 'Multi-Location', included: false },
    ],
    limits: { staff: 10, locations: 1 },
  },
  elite: {
    name: 'Elite',
    price: '$99/mo',
    description: 'Advanced analytics & multi-location',
    popular: false,
    features: [
      { name: 'Online Booking', included: true },
      { name: 'Staff Dashboard', included: true },
      { name: 'Photo Uploads', included: true },
      { name: 'Client Profiles', included: true },
      { name: 'SMS Reminders', included: true },
      { name: 'Referrals Program', included: true },
      { name: 'Rewards Program', included: true },
      { name: 'Schedule Overrides', included: true },
      { name: 'Staff Earnings', included: true },
      { name: 'Client Flags', included: true },
      { name: 'Analytics Dashboard', included: true },
      { name: 'Multi-Location', included: true },
    ],
    limits: { staff: 50, locations: 10 },
  },
};

function ComparePlansModal({ isOpen, onClose }: ComparePlansModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-t-[20px] bg-white shadow-xl sm:rounded-[20px]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Compare Plans</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close compare plans modal"
            className="flex size-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
          >
            <X className="size-4 text-gray-600" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-120px)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Object.entries(PLAN_FEATURES).map(([key, plan]) => (
              <div
                key={key}
                className={`relative rounded-xl border-2 p-4 ${
                  plan.popular
                    ? 'border-purple-500 bg-purple-50/50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-purple-500 px-3 py-0.5 text-xs font-medium text-white">
                    Most Popular
                  </div>
                )}
                <div className="mb-3 text-center">
                  <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                  <div className="mt-1 text-2xl font-bold text-gray-900">{plan.price}</div>
                  <p className="mt-1 text-xs text-gray-500">{plan.description}</p>
                </div>

                <div className="mb-3 rounded-lg bg-gray-50 p-2 text-center text-xs text-gray-600">
                  <span className="font-medium">{plan.limits.staff}</span>
                  {' '}
                  staff
                  {' · '}
                  <span className="font-medium">{plan.limits.locations}</span>
                  {' '}
                  location
                  {plan.limits.locations > 1 ? 's' : ''}
                </div>

                <ul className="space-y-2">
                  {plan.features.map(feature => (
                    <li key={feature.name} className="flex items-center gap-2 text-sm">
                      {feature.included
                        ? (
                            <Check className="size-4 shrink-0 text-green-500" />
                          )
                        : (
                            <X className="size-4 shrink-0 text-gray-300" />
                          )}
                      <span className={feature.included ? 'text-gray-700' : 'text-gray-400'}>
                        {feature.name}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  className={`mt-4 w-full rounded-lg py-2.5 text-sm font-medium transition-colors ${
                    plan.popular
                      ? 'bg-purple-500 text-white hover:bg-purple-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {key === 'starter' ? 'Current Plan' : 'Contact Sales'}
                </button>
              </div>
            ))}
          </div>

          <p className="mt-6 text-center text-xs text-gray-500">
            Need a custom plan? Contact us at support@example.com
          </p>
        </div>
      </motion.div>
    </div>
  );
}

type SettingsModalProps = {
  onClose: () => void;
  userName?: string;
  userInitials?: string;
};

export function SettingsModal({
  onClose,
  userName = 'Justin Hodgeman',
  userInitials,
}: SettingsModalProps) {
  const { salonSlug } = useSalon();
  const router = useRouter();

  // Booking flow state
  const [bookingFlowEnabled, setBookingFlowEnabled] = useState(false);
  const [bookingFlow, setBookingFlow] = useState<BookingStep[] | null>(null);
  const [bookingFlowLoading, setBookingFlowLoading] = useState(true);

  // Modules state (Step 16.3)
  const [modulesLoading, setModulesLoading] = useState(true);
  const [modulesSaving, setModulesSaving] = useState(false);
  const [modules, setModules] = useState<ResolvedModules>({
    smsReminders: true,
    referrals: true,
    rewards: true,
    scheduleOverrides: true,
    staffEarnings: true,
    clientFlags: true,
    clientBlocking: true,
    analyticsDashboard: true,
    utilization: true,
  });
  const [entitledModules, setEntitledModules] = useState<Record<ModuleKey, boolean>>({
    smsReminders: false,
    referrals: false,
    rewards: false,
    scheduleOverrides: false,
    staffEarnings: false,
    clientFlags: false,
    clientBlocking: false,
    analyticsDashboard: false,
    utilization: false,
  });

  // Visibility settings state (Step 16.1)
  const [visibilityLoading, setVisibilityLoading] = useState(true);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityEntitled, setVisibilityEntitled] = useState(false);

  // Compare Plans modal state (Step 19)
  const [showComparePlans, setShowComparePlans] = useState(false);

  // Programs state (Step 21E)
  const [programsLoading, setProgramsLoading] = useState(true);
  const [programsSaving, setProgramsSaving] = useState(false);
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [rewardsEnabledProgram, setRewardsEnabledProgram] = useState(true);
  const [effectivePoints, setEffectivePoints] = useState<ResolvedLoyaltyPoints | null>(null);
  const [_defaultPoints, setDefaultPoints] = useState<ResolvedLoyaltyPoints | null>(null);
  const [billingMode, setBillingMode] = useState<'NONE' | 'STRIPE'>('NONE');
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);

  const [visibility, setVisibility] = useState<SalonVisibilityPolicy>({
    staff: {
      showClientPhone: true,
      showClientEmail: false,
      showClientFullName: true,
      showAppointmentPrice: true,
      showClientHistory: false,
      showClientNotes: true,
      showOtherTechAppointments: false,
    },
  });

  // Fetch modules settings (Step 16.3)
  const fetchModules = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setModulesLoading(true);
      const response = await fetch(`/api/admin/settings/modules?salonSlug=${salonSlug}`);
      if (response.ok) {
        const data = await response.json();
        if (data.data.modules) {
          setModules(data.data.modules);
        }
        if (data.data.entitledModules) {
          setEntitledModules(data.data.entitledModules);
        }
      }
    } catch (error) {
      console.error('Failed to fetch module settings:', error);
    } finally {
      setModulesLoading(false);
    }
  }, [salonSlug]);

  // Save module toggle (Step 16.3)
  const saveModuleToggle = useCallback(async (moduleKey: ModuleKey, value: boolean) => {
    if (!salonSlug) {
      return;
    }

    try {
      setModulesSaving(true);
      const response = await fetch('/api/admin/settings/modules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          modules: { [moduleKey]: value },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data.modules) {
          setModules(data.data.modules);
        }
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to save module setting:', error);
    } finally {
      setModulesSaving(false);
    }
  }, [salonSlug, router]);

  // Handle module toggle
  const handleModuleToggle = (moduleKey: ModuleKey, value: boolean) => {
    // Optimistically update UI
    setModules(prev => ({ ...prev, [moduleKey]: value }));
    // Save to server
    saveModuleToggle(moduleKey, value);
  };

  // Fetch programs settings (Step 21E)
  const fetchPrograms = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setProgramsLoading(true);
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${salonSlug}`);
      if (response.ok) {
        const data = await response.json();
        setReviewsEnabled(data.reviewsEnabled ?? true);
        setRewardsEnabledProgram(data.rewardsEnabled ?? true);
        setEffectivePoints(data.effectivePoints ?? null);
        setDefaultPoints(data.defaults ?? null);
        setBillingMode(data.billingMode ?? 'NONE');
        setSubscriptionStatus(data.subscriptionStatus ?? null);
      }
    } catch (error) {
      console.error('Failed to fetch programs settings:', error);
    } finally {
      setProgramsLoading(false);
    }
  }, [salonSlug]);

  // Save programs toggle (Step 21E)
  const saveProgramToggle = useCallback(async (field: 'reviewsEnabled' | 'rewardsEnabled', value: boolean) => {
    if (!salonSlug) {
      return;
    }

    try {
      setProgramsSaving(true);
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${salonSlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });

      if (response.ok) {
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to save program setting:', error);
    } finally {
      setProgramsSaving(false);
    }
  }, [salonSlug, router]);

  // Fetch visibility settings
  const fetchVisibility = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setVisibilityLoading(true);
      const response = await fetch(`/api/admin/settings/visibility?salonSlug=${salonSlug}`);
      if (response.ok) {
        const data = await response.json();
        if (data.data.visibility) {
          setVisibility(data.data.visibility);
        }
        // Check entitlement
        setVisibilityEntitled(data.data.entitled ?? false);
      }
    } catch (error) {
      console.error('Failed to fetch visibility settings:', error);
    } finally {
      setVisibilityLoading(false);
    }
  }, [salonSlug]);

  // Save visibility settings
  const saveVisibility = useCallback(async (newVisibility: SalonVisibilityPolicy) => {
    if (!salonSlug) {
      return;
    }

    try {
      setVisibilitySaving(true);
      const response = await fetch('/api/admin/settings/visibility', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          visibility: newVisibility,
        }),
      });

      if (response.ok) {
        router.refresh();
      }
    } catch (error) {
      console.error('Failed to save visibility settings:', error);
    } finally {
      setVisibilitySaving(false);
    }
  }, [salonSlug, router]);

  // Handle visibility toggle
  const handleVisibilityToggle = (key: keyof NonNullable<SalonVisibilityPolicy['staff']>, value: boolean) => {
    const newVisibility: SalonVisibilityPolicy = {
      ...visibility,
      staff: {
        ...visibility.staff,
        [key]: value,
      },
    };
    setVisibility(newVisibility);
    saveVisibility(newVisibility);
  };

  // Fetch booking flow settings
  const fetchBookingFlow = useCallback(async () => {
    if (!salonSlug) {
      return;
    }

    try {
      setBookingFlowLoading(true);
      const response = await fetch(`/api/admin/settings/booking-flow?salonSlug=${salonSlug}`);
      if (response.ok) {
        const data = await response.json();
        setBookingFlowEnabled(data.data.bookingFlowCustomizationEnabled);
        setBookingFlow(data.data.bookingFlow);
      }
    } catch (error) {
      console.error('Failed to fetch booking flow settings:', error);
    } finally {
      setBookingFlowLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    fetchBookingFlow();
    fetchVisibility();
    fetchModules();
    fetchPrograms();
  }, [fetchBookingFlow, fetchVisibility, fetchModules, fetchPrograms]);

  // Handle booking flow save (called by BookingFlowEditor's auto-save)
  const handleBookingFlowSave = async (flow: BookingStep[]) => {
    if (!salonSlug) {
      return;
    }

    const response = await fetch('/api/admin/settings/booking-flow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        bookingFlow: flow,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save booking flow');
    }

    const data = await response.json();
    setBookingFlow(data.data.bookingFlow);
  };

  return (
    <div className="flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Settings"
          leftAction={<BackButton onClick={onClose} label="Dashboard" />}
          transparent
        />

        {/* Large Title */}
        <div className="px-4 pb-2">
          <h1 className="text-[34px] font-bold text-[#1C1C1E]">Settings</h1>
        </div>

        <SearchBar />
      </div>

      {/* Scrollable Content */}
      <div className="overflow-y-auto pb-10">
        {/* Profile Card */}
        <ProfileCard name={userName} initials={userInitials} />

        {/* Section 1: Connectivity */}
        <Section>
          <Row icon={Wifi} iconColor="bg-[#007AFF]" label="Wi-Fi" value="Salon_Guest" />
          <Row icon={Shield} iconColor="bg-green-500" label="Security" isLast />
        </Section>

        {/* Section 2: Notifications */}
        <Section footer="Customize how you receive alerts for new bookings and reviews.">
          <Row icon={Bell} iconColor="bg-[#FF3B30]" label="Notifications" />
          <Row
            icon={Moon}
            iconColor="bg-[#5856D6]"
            label="Do Not Disturb"
            type="toggle"
            defaultOn={false}
            isLast
          />
        </Section>

        {/* Section 3: General */}
        <Section>
          <Row icon={User} iconColor="bg-[#8E8E93]" label="Staff Permissions" />
          <Row label="Keyboard Shortcuts" type="toggle" />
          <Row label="Display Zoom" value="Standard" isLast />
        </Section>

        {/* Section 3.5: Modules (Step 16.3) */}
        <Section
          title="Modules"
          footer="Enable or disable features for your salon. Disabled modules won't be available to staff."
        >
          {modulesLoading
            ? (
                <div className="flex items-center justify-center py-8">
                  <div className="size-6 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
                </div>
              )
            : (
                <>
                  {/* Marketing Group */}
                  <div className="border-b border-gray-100 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Marketing</span>
                  </div>
                  <ModuleRow
                    icon={MessageSquare}
                    iconColor="bg-green-500"
                    label="SMS Reminders"
                    moduleKey="smsReminders"
                    enabled={modules.smsReminders}
                    entitled={entitledModules.smsReminders}
                    onToggle={handleModuleToggle}
                  />
                  <ModuleRow
                    icon={Users}
                    iconColor="bg-blue-500"
                    label="Referrals"
                    moduleKey="referrals"
                    enabled={modules.referrals}
                    entitled={entitledModules.referrals}
                    onToggle={handleModuleToggle}
                  />
                  <ModuleRow
                    icon={Gift}
                    iconColor="bg-purple-500"
                    label="Rewards"
                    moduleKey="rewards"
                    enabled={modules.rewards}
                    entitled={entitledModules.rewards}
                    onToggle={handleModuleToggle}
                  />

                  {/* Staff Group */}
                  <div className="border-b border-gray-100 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Staff</span>
                  </div>
                  <ModuleRow
                    icon={User}
                    iconColor="bg-orange-500"
                    label="Schedule Overrides"
                    moduleKey="scheduleOverrides"
                    enabled={modules.scheduleOverrides}
                    entitled={entitledModules.scheduleOverrides}
                    onToggle={handleModuleToggle}
                  />
                  <ModuleRow
                    icon={BarChart3}
                    iconColor="bg-teal-500"
                    label="Staff Earnings"
                    moduleKey="staffEarnings"
                    enabled={modules.staffEarnings}
                    entitled={entitledModules.staffEarnings}
                    onToggle={handleModuleToggle}
                  />

                  {/* Controls Group */}
                  <div className="border-b border-gray-100 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Controls</span>
                  </div>
                  <ModuleRow
                    icon={Flag}
                    iconColor="bg-amber-500"
                    label="Client Flags"
                    moduleKey="clientFlags"
                    enabled={modules.clientFlags}
                    entitled={entitledModules.clientFlags}
                    onToggle={handleModuleToggle}
                  />
                  <ModuleRow
                    icon={Shield}
                    iconColor="bg-red-500"
                    label="Client Blocking"
                    moduleKey="clientBlocking"
                    enabled={modules.clientBlocking}
                    entitled={entitledModules.clientBlocking}
                    onToggle={handleModuleToggle}
                  />

                  {/* Analytics Group */}
                  <div className="border-b border-gray-100 px-4 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Analytics</span>
                  </div>
                  <ModuleRow
                    icon={BarChart3}
                    iconColor="bg-indigo-500"
                    label="Analytics Dashboard"
                    moduleKey="analyticsDashboard"
                    enabled={modules.analyticsDashboard}
                    entitled={entitledModules.analyticsDashboard}
                    onToggle={handleModuleToggle}
                  />
                  <ModuleRow
                    icon={BarChart3}
                    iconColor="bg-cyan-500"
                    label="Utilization Reports"
                    moduleKey="utilization"
                    enabled={modules.utilization}
                    entitled={entitledModules.utilization}
                    onToggle={handleModuleToggle}
                    isLast
                  />

                  {modulesSaving && (
                    <div className="flex items-center justify-center py-2 text-xs text-gray-500">
                      Saving...
                    </div>
                  )}
                </>
              )}
        </Section>

        {/* Section 3.55: Programs (Step 21E) */}
        <Section
          title="Programs"
          footer="Control reviews and rewards programs. Points values and billing mode are set by the platform administrator."
        >
          {programsLoading
            ? (
                <div className="flex items-center justify-center py-8">
                  <div className="size-6 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
                </div>
              )
            : (
                <>
                  {/* Program Toggles */}
                  <Row
                    icon={MessageSquare}
                    iconColor="bg-purple-500"
                    label="Reviews"
                    type="toggle"
                    defaultOn={reviewsEnabled}
                    onToggle={(value) => {
                      setReviewsEnabled(value);
                      saveProgramToggle('reviewsEnabled', value);
                    }}
                  />
                  <Row
                    icon={Gift}
                    iconColor="bg-green-500"
                    label="Rewards Program"
                    type="toggle"
                    defaultOn={rewardsEnabledProgram}
                    onToggle={(value) => {
                      setRewardsEnabledProgram(value);
                      saveProgramToggle('rewardsEnabled', value);
                    }}
                    isLast={!effectivePoints}
                  />

                  {/* Effective Points Display (Read-only) */}
                  {effectivePoints && (
                    <>
                      <div className="border-t border-gray-100 px-4 py-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                          Loyalty Points (Read-only)
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Welcome Bonus</span>
                            <span className="font-medium text-gray-900">
                              {effectivePoints.welcomeBonus.toLocaleString()}
                              {' '}
                              pts
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Profile Completion</span>
                            <span className="font-medium text-gray-900">
                              {effectivePoints.profileCompletion.toLocaleString()}
                              {' '}
                              pts
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Referral (Referee)</span>
                            <span className="font-medium text-gray-900">
                              {effectivePoints.referralReferee.toLocaleString()}
                              {' '}
                              pts
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Referral (Referrer)</span>
                            <span className="font-medium text-gray-900">
                              {effectivePoints.referralReferrer.toLocaleString()}
                              {' '}
                              pts
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Billing Status Display (Read-only) */}
                  <div className="border-t border-gray-100 px-4 py-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Billing Status
                    </div>
                    {billingMode === 'STRIPE'
                      ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <div className={`size-2 rounded-full ${subscriptionStatus === 'active' ? 'bg-green-500' : 'bg-amber-500'}`} />
                              <span className="text-sm text-gray-900">
                                Stripe Billing
                                {subscriptionStatus ? ` (${subscriptionStatus})` : ''}
                              </span>
                            </div>
                          </div>
                        )
                      : (
                          <div className="flex items-center gap-2">
                            <div className="size-2 rounded-full bg-gray-400" />
                            <span className="text-sm text-gray-600">Cash / Offline billing enabled</span>
                          </div>
                        )}
                  </div>

                  {programsSaving && (
                    <div className="flex items-center justify-center py-2 text-xs text-gray-500">
                      Saving...
                    </div>
                  )}
                </>
              )}
        </Section>

        {/* Compare Plans Button (Step 19) */}
        <div className="mb-6 px-4">
          <button
            type="button"
            onClick={() => setShowComparePlans(true)}
            className="w-full rounded-[10px] bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-3 text-center text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            Compare Plans
          </button>
        </div>

        {/* Section 3.6: Staff Visibility (Step 16.1) */}
        <Section
          title="Staff Visibility"
          footer={visibilityEntitled
            ? 'Control what information staff can see in their dashboard. Changes take effect immediately.'
            : undefined}
        >
          {visibilityLoading
            ? (
                <div className="flex items-center justify-center py-8">
                  <div className="size-6 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
                </div>
              )
            : !visibilityEntitled
                ? (
                    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-amber-100">
                        <Shield className="size-6 text-amber-600" />
                      </div>
                      <div className="mb-1 text-sm font-medium text-gray-900">
                        Upgrade Required
                      </div>
                      <div className="max-w-[240px] text-xs text-gray-500">
                        Staff visibility controls are a premium feature. Contact support to upgrade your plan.
                      </div>
                    </div>
                  )
                : (
                    <>
                      <Row
                        icon={Eye}
                        iconColor="bg-[#007AFF]"
                        label="Client Phone"
                        type="toggle"
                        defaultOn={visibility.staff?.showClientPhone ?? true}
                        onToggle={value => handleVisibilityToggle('showClientPhone', value)}
                      />
                      <Row
                        label="Client Full Name"
                        type="toggle"
                        defaultOn={visibility.staff?.showClientFullName ?? true}
                        onToggle={value => handleVisibilityToggle('showClientFullName', value)}
                      />
                      <Row
                        label="Client Email"
                        type="toggle"
                        defaultOn={visibility.staff?.showClientEmail ?? false}
                        onToggle={value => handleVisibilityToggle('showClientEmail', value)}
                      />
                      <Row
                        label="Appointment Price"
                        type="toggle"
                        defaultOn={visibility.staff?.showAppointmentPrice ?? true}
                        onToggle={value => handleVisibilityToggle('showAppointmentPrice', value)}
                      />
                      <Row
                        label="Client History"
                        type="toggle"
                        defaultOn={visibility.staff?.showClientHistory ?? false}
                        onToggle={value => handleVisibilityToggle('showClientHistory', value)}
                      />
                      <Row
                        label="Client Notes"
                        type="toggle"
                        defaultOn={visibility.staff?.showClientNotes ?? true}
                        onToggle={value => handleVisibilityToggle('showClientNotes', value)}
                      />
                      <Row
                        label="Other Tech Appointments"
                        type="toggle"
                        defaultOn={visibility.staff?.showOtherTechAppointments ?? false}
                        onToggle={value => handleVisibilityToggle('showOtherTechAppointments', value)}
                        isLast
                      />
                      {visibilitySaving && (
                        <div className="flex items-center justify-center py-2 text-xs text-gray-500">
                          Saving...
                        </div>
                      )}
                    </>
                  )}
        </Section>

        {/* Section 4: Page Themes */}
        <Section title="Appearance">
          <PageThemesSettings className="overflow-visible rounded-[10px] bg-white" />
        </Section>

        {/* Section 5: Booking Flow */}
        <Section title="Booking Flow" footer="Customize the order of steps in your online booking flow.">
          {bookingFlowLoading
            ? (
                <div className="flex items-center justify-center py-8">
                  <div className="size-6 animate-spin rounded-full border-2 border-[#007AFF] border-t-transparent" />
                </div>
              )
            : (
                <BookingFlowEditor
                  bookingFlowCustomizationEnabled={bookingFlowEnabled}
                  bookingFlow={bookingFlow}
                  onSave={handleBookingFlowSave}
                />
              )}
        </Section>

        {/* Section 6: About */}
        <Section title="About">
          <Row label="Version" value="1.0.0" type="link" />
          <Row label="Terms of Service" />
          <Row label="Privacy Policy" isLast />
        </Section>
      </div>

      {/* Compare Plans Modal (Step 19) */}
      <ComparePlansModal
        isOpen={showComparePlans}
        onClose={() => setShowComparePlans(false)}
      />
    </div>
  );
}

// Export sub-components for reuse
export { ProfileCard, Row, SearchBar, Section };

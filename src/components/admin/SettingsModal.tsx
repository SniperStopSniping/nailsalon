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
  Bell,
  ChevronRight,
  Moon,
  Search,
  Shield,
  User,
  Wifi,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import type { BookingStep } from '@/libs/bookingFlow';
import { useSalon } from '@/providers/SalonProvider';

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

  // Booking flow state
  const [bookingFlowEnabled, setBookingFlowEnabled] = useState(false);
  const [bookingFlow, setBookingFlow] = useState<BookingStep[] | null>(null);
  const [bookingFlowLoading, setBookingFlowLoading] = useState(true);

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
  }, [fetchBookingFlow]);

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
    </div>
  );
}

// Export sub-components for reuse
export { ProfileCard, Row, SearchBar, Section };

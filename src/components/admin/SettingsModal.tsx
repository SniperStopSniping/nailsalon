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
import { useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Wifi,
  Moon,
  Bell,
  Shield,
  User,
  Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { ModalHeader, BackButton } from './AppModal';
import { PageThemesSettings } from './PageThemesSettings';

/**
 * Section Container
 */
interface SectionProps {
  title?: string;
  footer?: string;
  children: ReactNode;
}

function Section({ title, footer, children }: SectionProps) {
  return (
    <div className="mb-6">
      {title && (
        <div className="px-4 mb-2 text-[13px] text-gray-500 uppercase tracking-wide">
          {title}
        </div>
      )}
      <div className="bg-white rounded-[10px] border border-gray-200/50 shadow-sm mx-4 overflow-visible">
        {children}
      </div>
      {footer && (
        <div className="px-8 mt-2 text-[12px] text-gray-500 leading-snug">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * Settings Row
 */
interface RowProps {
  icon?: LucideIcon;
  iconColor?: string;
  label: string;
  value?: string;
  type?: 'link' | 'toggle';
  isLast?: boolean;
  defaultOn?: boolean;
  onToggle?: (value: boolean) => void;
  onClick?: () => void;
}

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
      className="flex items-center pl-4 min-h-[48px] active:bg-gray-50 transition-colors cursor-pointer"
      onClick={type === 'link' ? onClick : undefined}
    >
      {/* Icon */}
      {Icon && (
        <div
          className={`w-7 h-7 rounded-[6px] flex items-center justify-center mr-3 text-white shadow-sm ${iconColor}`}
        >
          <Icon className="w-4 h-4" />
        </div>
      )}

      {/* Content */}
      <div
        className={`flex-1 flex items-center justify-between pr-4 py-3 ${
          !isLast ? 'border-b border-gray-100' : ''
        }`}
      >
        <span className="text-[16px] text-black tracking-tight">{label}</span>

        <div className="flex items-center gap-2">
          {value && <span className="text-[16px] text-[#8E8E93]">{value}</span>}

          {type === 'link' && <ChevronRight className="w-4 h-4 text-[#C7C7CC]" />}

          {type === 'toggle' && (
            <button
              type="button"
              onClick={handleToggle}
              aria-label={`Toggle ${label}`}
              className={`
                w-[51px] h-[31px] rounded-full p-0.5 transition-colors duration-300 relative
                ${isOn ? 'bg-[#34C759]' : 'bg-[#E9E9EA]'}
              `}
            >
              <motion.div
                animate={{ x: isOn ? 20 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="w-[27px] h-[27px] bg-white rounded-full shadow-md"
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
interface ProfileCardProps {
  name: string;
  subtitle?: string;
  initials?: string;
  onClick?: () => void;
}

function ProfileCard({
  name,
  subtitle = 'Apple Account, iCloud, and more',
  initials,
  onClick,
}: ProfileCardProps) {
  const displayInitials = initials || name.split(' ').map((n) => n[0]).join('').toUpperCase();

  return (
    <div
      className="flex items-center gap-3 px-4 mb-8 cursor-pointer active:opacity-70 transition-opacity"
      onClick={onClick}
    >
      <div className="w-[60px] h-[60px] rounded-full overflow-hidden border border-white/50 shadow-sm">
        <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-400 flex items-center justify-center text-xl font-bold text-white">
          {displayInitials}
        </div>
      </div>
      <div className="flex-1">
        <div className="text-[20px] font-normal text-[#1C1C1E]">{name}</div>
        <div className="text-[13px] text-gray-500">{subtitle}</div>
      </div>
      <ChevronRight className="text-[#C7C7CC] w-5 h-5" />
    </div>
  );
}

/**
 * Search Bar
 */
function SearchBar() {
  return (
    <div className="px-4 pb-4">
      <div className="h-9 bg-[#767680]/12 rounded-[10px] flex items-center px-2 text-[#8E8E93]">
        <Search className="w-4 h-4 mr-2" />
        <span className="text-[16px]">Search</span>
      </div>
    </div>
  );
}

interface SettingsModalProps {
  onClose: () => void;
  userName?: string;
  userInitials?: string;
}

export function SettingsModal({
  onClose,
  userName = 'Justin Hodgeman',
  userInitials,
}: SettingsModalProps) {
  return (
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col">
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
      <div className="pb-10 overflow-y-auto">
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
          <PageThemesSettings className="bg-white rounded-[10px] overflow-visible" />
        </Section>

        {/* Section 5: About */}
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
export { Section, Row, ProfileCard, SearchBar };


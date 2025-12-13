'use client';

/**
 * ClientProfileModal Component
 *
 * iOS-style client profile view with rich details.
 * Features:
 * - Large profile header with gradient avatar
 * - Stats cards (visits, spent, loyalty points)
 * - Tabbed sections (History, Preferences, Photos)
 * - Appointment history timeline
 * - Nail preferences with visual tags
 * - Photo gallery grid
 * - Quick action buttons (Book, Message, Call)
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  Calendar,
  Camera,
  ChevronRight,
  Clock,
  Coffee,
  Gift,
  Heart,
  MessageCircle,
  MessageSquare,
  Music,
  Palette,
  Phone,
  Sparkles,
  Star,
} from 'lucide-react';
import { useState } from 'react';

import { BackButton, ModalHeader } from './AppModal';

// =============================================================================
// Types
// =============================================================================

type ClientProfileData = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  memberSince: string;
  avatarGradient: [string, string];
  stats: {
    totalVisits: number;
    totalSpent: number;
    loyaltyPoints: number;
    avgSpend: number;
  };
  preferences: {
    nailShape: string;
    nailLength: string;
    favoriteColors: string[];
    finishes: string[];
    sensitivities: string[];
    beverage: string;
    musicPreference: string;
    conversationLevel: string;
    techNotes: string;
  };
  appointments: Array<{
    id: string;
    date: string;
    services: string[];
    technician: string;
    price: number;
    rating?: number;
  }>;
  photos: Array<{
    id: string;
    url: string;
    date: string;
  }>;
  favoriteTech: {
    name: string;
    avatar: string;
  };
};

type ClientProfileModalProps = {
  onClose: () => void;
  client?: ClientProfileData;
};

// =============================================================================
// Mock Data
// =============================================================================

const MOCK_CLIENT: ClientProfileData = {
  id: '1',
  name: 'Emma Thompson',
  phone: '+1 (555) 234-5678',
  email: 'emma.thompson@email.com',
  memberSince: '2023-03-15',
  avatarGradient: ['#667eea', '#764ba2'],
  stats: {
    totalVisits: 24,
    totalSpent: 287500, // cents
    loyaltyPoints: 2450,
    avgSpend: 11980, // cents
  },
  preferences: {
    nailShape: 'Almond',
    nailLength: 'Medium',
    favoriteColors: ['Dusty Rose', 'French White', 'Burgundy'],
    finishes: ['Glossy', 'Chrome'],
    sensitivities: ['Acetone-free only'],
    beverage: 'Oat Milk Latte',
    musicPreference: 'Lo-fi Beats',
    conversationLevel: 'Chatty',
    techNotes: 'Prefers cuticle oil massage. Always runs 5 min early.',
  },
  appointments: [
    {
      id: '1',
      date: '2024-12-02',
      services: ['BIAB Gel Manicure', 'Nail Art'],
      technician: 'Sarah J.',
      price: 12500,
      rating: 5,
    },
    {
      id: '2',
      date: '2024-11-18',
      services: ['Gel Pedicure'],
      technician: 'Sarah J.',
      price: 8500,
      rating: 5,
    },
    {
      id: '3',
      date: '2024-11-04',
      services: ['BIAB Gel Manicure'],
      technician: 'Emma R.',
      price: 9500,
      rating: 4,
    },
    {
      id: '4',
      date: '2024-10-21',
      services: ['Full Set Acrylic', 'French Tips'],
      technician: 'Sarah J.',
      price: 15000,
      rating: 5,
    },
  ],
  photos: [
    { id: '1', url: '/assets/images/nail-1.png', date: '2024-12-02' },
    { id: '2', url: '/assets/images/nail-2.png', date: '2024-11-18' },
    { id: '3', url: '/assets/images/nail-3.png', date: '2024-11-04' },
    { id: '4', url: '/assets/images/nail-4.png', date: '2024-10-21' },
    { id: '5', url: '/assets/images/nail-5.png', date: '2024-10-07' },
    { id: '6', url: '/assets/images/nail-6.png', date: '2024-09-23' },
  ],
  favoriteTech: {
    name: 'Sarah J.',
    avatar: 'SJ',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  if (diffDays < 30) {
    return `${Math.floor(diffDays / 7)} weeks ago`;
  }
  return formatDate(dateStr);
}

// =============================================================================
// Sub-Components
// =============================================================================

/**
 * Profile Header with large avatar and name
 */
function ProfileHeader({ client }: { client: ClientProfileData }) {
  const initials = client.name.split(' ').map(n => n[0]).join('').toUpperCase();

  return (
    <div className="relative px-6 pb-8 pt-6">
      {/* Background gradient blur */}
      <div
        className="absolute inset-0 opacity-20 blur-3xl"
        style={{
          background: `linear-gradient(135deg, ${client.avatarGradient[0]}, ${client.avatarGradient[1]})`,
        }}
      />

      <div className="relative flex flex-col items-center">
        {/* Avatar */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          className="mb-4 flex size-24 items-center justify-center rounded-full text-3xl font-bold text-white shadow-xl"
          style={{
            background: `linear-gradient(135deg, ${client.avatarGradient[0]}, ${client.avatarGradient[1]})`,
          }}
        >
          {initials}
        </motion.div>

        {/* Name & Contact */}
        <h1 className="mb-1 text-[24px] font-bold text-[#1C1C1E]">{client.name}</h1>
        <p className="mb-1 text-[15px] text-[#8E8E93]">{client.phone}</p>
        {client.email && (
          <p className="text-[13px] text-[#8E8E93]">{client.email}</p>
        )}

        {/* Member Since Badge */}
        <div className="mt-3 rounded-full bg-[#F2F2F7] px-3 py-1.5">
          <span className="text-[12px] font-medium text-[#8E8E93]">
            Member since
            {' '}
            {formatDate(client.memberSince)}
          </span>
        </div>

        {/* Favorite Tech */}
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/80 px-4 py-2 shadow-sm backdrop-blur-sm">
          <Heart className="size-4 text-[#FF2D55]" fill="#FF2D55" />
          <span className="text-[13px] text-[#1C1C1E]">
            Favorite Tech:
            {' '}
            <span className="font-semibold">{client.favoriteTech.name}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Quick Action Buttons
 */
function QuickActions() {
  const actions = [
    { icon: Calendar, label: 'Book', color: '#007AFF' },
    { icon: MessageSquare, label: 'Message', color: '#34C759' },
    { icon: Phone, label: 'Call', color: '#FF9500' },
  ];

  return (
    <div className="flex justify-center gap-6 px-6 pb-6">
      {actions.map(action => (
        <motion.button
          key={action.label}
          whileTap={{ scale: 0.95 }}
          className="flex flex-col items-center gap-1.5"
        >
          <div
            className="flex size-14 items-center justify-center rounded-2xl shadow-sm"
            style={{ backgroundColor: `${action.color}15` }}
          >
            <action.icon className="size-6" style={{ color: action.color }} />
          </div>
          <span className="text-[12px] font-medium text-[#1C1C1E]">{action.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

/**
 * Stats Cards Grid
 */
function StatsGrid({ stats }: { stats: ClientProfileData['stats'] }) {
  const cards = [
    {
      icon: Calendar,
      label: 'Visits',
      value: stats.totalVisits.toString(),
      color: '#007AFF',
      gradient: ['#4facfe', '#00f2fe'],
    },
    {
      icon: Sparkles,
      label: 'Total Spent',
      value: formatCurrency(stats.totalSpent),
      color: '#34C759',
      gradient: ['#43e97b', '#38f9d7'],
    },
    {
      icon: Gift,
      label: 'Points',
      value: stats.loyaltyPoints.toLocaleString(),
      color: '#FF9500',
      gradient: ['#fa709a', '#fee140'],
    },
    {
      icon: Star,
      label: 'Avg. Spend',
      value: formatCurrency(stats.avgSpend),
      color: '#AF52DE',
      gradient: ['#667eea', '#764ba2'],
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 px-4">
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05, type: 'spring', stiffness: 200, damping: 20 }}
          className="rounded-[20px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
        >
          <div
            className="mb-3 flex size-10 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${card.gradient[0]}, ${card.gradient[1]})`,
            }}
          >
            <card.icon className="size-5 text-white" />
          </div>
          <div className="text-[22px] font-bold text-[#1C1C1E]">{card.value}</div>
          <div className="text-[12px] font-medium uppercase tracking-wide text-[#8E8E93]">
            {card.label}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Tab Bar
 */
function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: 'history' | 'preferences' | 'photos';
  onTabChange: (tab: 'history' | 'preferences' | 'photos') => void;
}) {
  const tabs = [
    { id: 'history' as const, label: 'History', icon: Clock },
    { id: 'preferences' as const, label: 'Preferences', icon: Heart },
    { id: 'photos' as const, label: 'Photos', icon: Camera },
  ];

  return (
    <div className="mx-4 mb-4 flex rounded-xl bg-[#F2F2F7] p-1">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-[13px] font-semibold
            transition-all duration-200
            ${activeTab === tab.id
          ? 'bg-white text-[#1C1C1E] shadow-sm'
          : 'text-[#8E8E93]'
        }
          `}
        >
          <tab.icon className="size-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Appointment History List
 */
function HistoryTab({ appointments }: { appointments: ClientProfileData['appointments'] }) {
  return (
    <div className="px-4 pb-8">
      <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        {appointments.map((appt, index) => (
          <motion.div
            key={appt.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`
              flex cursor-pointer items-center p-4 transition-colors active:bg-gray-50
              ${index < appointments.length - 1 ? 'border-b border-gray-100' : ''}
            `}
          >
            {/* Date Column */}
            <div className="mr-4 flex w-16 flex-col items-center">
              <div className="text-[11px] font-medium uppercase text-[#8E8E93]">
                {new Date(appt.date).toLocaleDateString('en-US', { month: 'short' })}
              </div>
              <div className="text-[22px] font-bold text-[#1C1C1E]">
                {new Date(appt.date).getDate()}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1">
              <div className="text-[15px] font-semibold text-[#1C1C1E]">
                {appt.services.join(' + ')}
              </div>
              <div className="mt-0.5 text-[13px] text-[#8E8E93]">
                with
                {' '}
                {appt.technician}
              </div>
              {appt.rating && (
                <div className="mt-1 flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className="size-3"
                      fill={i < appt.rating! ? '#FFD60A' : 'none'}
                      stroke={i < appt.rating! ? '#FFD60A' : '#C7C7CC'}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Price */}
            <div className="text-right">
              <div className="text-[15px] font-semibold text-[#34C759]">
                {formatCurrency(appt.price)}
              </div>
              <ChevronRight className="ml-auto mt-1 size-4 text-[#C7C7CC]" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/**
 * Preference Tag
 */
function PreferenceTag({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex rounded-full px-3 py-1.5 text-[13px] font-medium"
      style={{
        backgroundColor: color ? `${color}15` : '#F2F2F7',
        color: color || '#1C1C1E',
      }}
    >
      {label}
    </span>
  );
}

/**
 * Preferences Tab
 */
function PreferencesTab({ preferences }: { preferences: ClientProfileData['preferences'] }) {
  const sections = [
    {
      icon: Palette,
      title: 'Nail Style',
      iconColor: '#FF2D55',
      items: [
        { label: 'Shape', value: preferences.nailShape },
        { label: 'Length', value: preferences.nailLength },
        { label: 'Finishes', value: preferences.finishes.join(', ') },
      ],
    },
    {
      icon: Heart,
      title: 'Favorite Colors',
      iconColor: '#AF52DE',
      tags: preferences.favoriteColors,
      tagColor: '#AF52DE',
    },
    {
      icon: Coffee,
      title: 'Comfort',
      iconColor: '#FF9500',
      items: [
        { label: 'Beverage', value: preferences.beverage },
      ],
    },
    {
      icon: Music,
      title: 'Ambiance',
      iconColor: '#007AFF',
      items: [
        { label: 'Music', value: preferences.musicPreference },
      ],
    },
    {
      icon: MessageCircle,
      title: 'Communication',
      iconColor: '#34C759',
      items: [
        { label: 'Style', value: preferences.conversationLevel },
      ],
    },
  ];

  return (
    <div className="space-y-4 px-4 pb-8">
      {sections.map((section, index) => (
        <motion.div
          key={section.title}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
        >
          <div className="mb-3 flex items-center gap-2">
            <div
              className="flex size-8 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${section.iconColor}15` }}
            >
              <section.icon className="size-4" style={{ color: section.iconColor }} />
            </div>
            <span className="text-[15px] font-semibold text-[#1C1C1E]">{section.title}</span>
          </div>

          {section.items && (
            <div className="space-y-2">
              {section.items.map(item => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-[14px] text-[#8E8E93]">{item.label}</span>
                  <span className="text-[14px] font-medium text-[#1C1C1E]">{item.value}</span>
                </div>
              ))}
            </div>
          )}

          {section.tags && (
            <div className="flex flex-wrap gap-2">
              {section.tags.map(tag => (
                <PreferenceTag key={tag} label={tag} color={section.tagColor} />
              ))}
            </div>
          )}
        </motion.div>
      ))}

      {/* Sensitivities Alert */}
      {preferences.sensitivities.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-[16px] bg-[#FF3B30]/10 p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#FF3B30]">⚠️ Sensitivities</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {preferences.sensitivities.map(s => (
              <PreferenceTag key={s} label={s} color="#FF3B30" />
            ))}
          </div>
        </motion.div>
      )}

      {/* Tech Notes */}
      {preferences.techNotes && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-[16px] bg-[#FFD60A]/15 p-4"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#1C1C1E]">📝 Tech Notes</span>
          </div>
          <p className="text-[14px] leading-relaxed text-[#1C1C1E]">
            {preferences.techNotes}
          </p>
        </motion.div>
      )}
    </div>
  );
}

/**
 * Photos Tab - Gallery Grid
 */
function PhotosTab({ photos }: { photos: ClientProfileData['photos'] }) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  return (
    <>
      <div className="px-4 pb-8">
        <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-[16px]">
          {photos.map((photo, index) => (
            <motion.div
              key={photo.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="relative aspect-square cursor-pointer overflow-hidden bg-gray-100"
              onClick={() => setSelectedPhoto(photo.url)}
            >
              {/* Placeholder gradient - in real app would be Image component */}
              <div
                className="size-full"
                style={{
                  background: `linear-gradient(135deg, 
                    hsl(${(index * 40) % 360}, 70%, 85%), 
                    hsl(${(index * 40 + 60) % 360}, 70%, 75%)
                  )`,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl">💅</span>
              </div>
              {/* Date overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-2">
                <span className="text-[10px] font-medium text-white">
                  {formatRelativeDate(photo.date)}
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        {photos.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-[16px] bg-white py-16">
            <Camera className="mb-3 size-12 text-[#C7C7CC]" />
            <span className="text-[15px] text-[#8E8E93]">No photos yet</span>
          </div>
        )}
      </div>

      {/* Photo Lightbox */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
            onClick={() => setSelectedPhoto(null)}
          >
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
              className="m-8 flex aspect-square w-full max-w-sm items-center justify-center rounded-2xl bg-gray-800"
            >
              <span className="text-6xl">💅</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ClientProfileModal({
  onClose,
  client = MOCK_CLIENT,
}: ClientProfileModalProps) {
  const [activeTab, setActiveTab] = useState<'history' | 'preferences' | 'photos'>('history');

  return (
    <div className="flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Client Profile"
          leftAction={<BackButton onClick={onClose} label="Clients" />}
          rightAction={(
            <button
              type="button"
              className="text-[17px] font-medium text-[#007AFF] transition-opacity active:opacity-50"
            >
              Edit
            </button>
          )}
        />
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto pb-10">
        {/* Profile Header */}
        <ProfileHeader client={client} />

        {/* Quick Actions */}
        <QuickActions />

        {/* Stats Grid */}
        <StatsGrid stats={client.stats} />

        {/* Tab Bar */}
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
            >
              <HistoryTab appointments={client.appointments} />
            </motion.div>
          )}

          {activeTab === 'preferences' && (
            <motion.div
              key="preferences"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
            >
              <PreferencesTab preferences={client.preferences} />
            </motion.div>
          )}

          {activeTab === 'photos' && (
            <motion.div
              key="photos"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
            >
              <PhotosTab photos={client.photos} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

'use client';

/**
 * ServicesModal Component
 *
 * iOS-style service catalog modal.
 * Features:
 * - Service list grouped by category
 * - Price and duration display
 * - Category tabs (Hands, Feet, Combo)
 * - Service details on tap
 * - Fetches real data from /api/salon/services
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronRight,
  Clock,
  DollarSign,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';

import { BackButton, ModalHeader } from './AppModal';

// Types
type ServiceData = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  category: string;
  imageUrl: string | null;
  isActive: boolean;
};

type ServicesModalProps = {
  onClose: () => void;
};

// Category definitions
const CATEGORIES = [
  { id: 'all', label: 'All', icon: Sparkles },
  { id: 'hands', label: 'Hands', icon: Scissors },
  { id: 'feet', label: 'Feet', icon: Scissors },
  { id: 'combo', label: 'Combo', icon: Sparkles },
];

// Format currency
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100);
}

// Format duration
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// Get category gradient
function getCategoryGradient(category: string): string {
  switch (category) {
    case 'hands': return 'from-[#f093fb] to-[#f5576c]';
    case 'feet': return 'from-[#4facfe] to-[#00f2fe]';
    case 'combo': return 'from-[#43e97b] to-[#38f9d7]';
    default: return 'from-[#a18cd1] to-[#fbc2eb]';
  }
}

/**
 * Category Tabs Component
 */
function CategoryTabs({
  active,
  onChange,
  counts,
}: {
  active: string;
  onChange: (category: string) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="px-4 pb-3">
      <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-1">
        {CATEGORIES.map((cat) => {
          const isActive = active === cat.id;
          const count = cat.id === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[cat.id] || 0);

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onChange(cat.id)}
              className={`
                flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[14px]
                font-medium transition-all
                ${isActive
              ? 'bg-[#007AFF] text-white shadow-sm'
              : 'border border-gray-200 bg-white text-[#1C1C1E]'
            }
              `}
            >
              <cat.icon className="size-4" />
              {cat.label}
              <span className={`text-[12px] ${isActive ? 'text-white/70' : 'text-[#8E8E93]'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Service Row Component
 */
function ServiceRow({
  service,
  isLast,
  onClick,
}: {
  service: ServiceData;
  isLast: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex min-h-[72px] cursor-pointer items-center pl-4 transition-colors active:bg-gray-50"
      onClick={onClick}
    >
      {/* Icon */}
      <div className={`size-12 rounded-[12px] bg-gradient-to-br ${getCategoryGradient(service.category)} mr-3 flex items-center justify-center shadow-sm`}>
        <Scissors className="size-6 text-white" />
      </div>

      {/* Content */}
      <div className={`flex flex-1 items-center justify-between py-3 pr-4 ${!isLast ? 'border-b border-gray-100' : ''}`}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold text-[#1C1C1E]">{service.name}</div>
          <div className="mt-0.5 flex items-center gap-3 text-[13px] text-[#8E8E93]">
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {formatDuration(service.durationMinutes)}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[12px] capitalize">
              {service.category}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-[17px] font-semibold text-[#34C759]">
            {formatCurrency(service.price)}
          </div>
          <ChevronRight className="size-4 text-[#C7C7CC]" />
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Empty State Component
 */
function EmptyState({ category }: { category: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#F2F2F7]">
        <Scissors className="size-8 text-[#8E8E93]" />
      </div>
      <h3 className="mb-1 text-[17px] font-semibold text-[#1C1C1E]">
        No Services
      </h3>
      <p className="text-center text-[15px] text-[#8E8E93]">
        {category === 'all'
          ? 'Add services to your catalog'
          : `No ${category} services available`}
      </p>
    </div>
  );
}

/**
 * Service Detail View Component
 */
function ServiceDetail({
  service,
  onBack,
}: {
  service: ServiceData;
  onBack: () => void;
}) {
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 overflow-y-auto bg-[#F2F2F7]"
    >
      <ModalHeader
        title={service.name}
        leftAction={<BackButton onClick={onBack} label="Services" />}
      />

      <div className="p-4">
        {/* Hero Card */}
        <div className="mb-4 rounded-[22px] bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="flex flex-col items-center">
            <div className={`size-20 rounded-[20px] bg-gradient-to-br ${getCategoryGradient(service.category)} mb-4 flex items-center justify-center shadow-lg`}>
              <Scissors className="size-10 text-white" />
            </div>
            <h2 className="text-center text-[22px] font-semibold text-[#1C1C1E]">{service.name}</h2>
            <div className="mt-3 flex items-center gap-4">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[13px] capitalize text-[#8E8E93]">
                {service.category}
              </span>
              {service.isActive
                ? (
                    <span className="rounded-full bg-green-100 px-3 py-1 text-[13px] text-green-600">
                      Active
                    </span>
                  )
                : (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-[13px] text-gray-500">
                      Inactive
                    </span>
                  )}
            </div>
          </div>
        </div>

        {/* Price & Duration */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[#8E8E93]">
              <DollarSign className="size-4" />
              Price
            </div>
            <div className="mt-1 text-[32px] font-bold text-[#34C759]">
              {formatCurrency(service.price)}
            </div>
          </div>
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[#8E8E93]">
              <Clock className="size-4" />
              Duration
            </div>
            <div className="mt-1 text-[32px] font-bold text-[#1C1C1E]">
              {formatDuration(service.durationMinutes)}
            </div>
          </div>
        </div>

        {/* Description */}
        {service.description && (
          <div className="rounded-[16px] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="mb-2 text-[13px] font-medium uppercase text-[#8E8E93]">Description</div>
            <p className="text-[15px] leading-relaxed text-[#1C1C1E]">{service.description}</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Loading Skeleton
 */
function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center p-4">
          <div className="mr-3 size-12 rounded-[12px] bg-gray-200" />
          <div className="flex-1">
            <div className="mb-2 h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
          </div>
          <div className="h-5 w-16 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

export function ServicesModal({ onClose }: ServicesModalProps) {
  const { salonSlug } = useSalon();
  const [services, setServices] = useState<ServiceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedService, setSelectedService] = useState<ServiceData | null>(null);

  // Fetch services data from real API
  const fetchServices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/salon/services?salonSlug=${salonSlug}`);

      if (!response.ok) {
        throw new Error('Failed to load services');
      }

      const result = await response.json();
      const fetchedServices = result.data?.services || [];

      // Transform API data to component format
      const transformedServices: ServiceData[] = fetchedServices.map((service: {
        id: string;
        name: string;
        description: string | null;
        price: number;
        durationMinutes: number;
        category: string;
        imageUrl: string | null;
        isActive: boolean;
      }) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        price: service.price,
        durationMinutes: service.durationMinutes,
        category: service.category,
        imageUrl: service.imageUrl,
        isActive: service.isActive,
      }));

      setServices(transformedServices);
    } catch (err) {
      console.error('Failed to fetch services:', err);
      setError('Failed to load services');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  // Filter services by category
  const filteredServices = activeCategory === 'all'
    ? services
    : services.filter(s => s.category === activeCategory);

  // Count per category
  const categoryCounts: Record<string, number> = {};
  for (const service of services) {
    categoryCounts[service.category] = (categoryCounts[service.category] || 0) + 1;
  }

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#F2F2F7] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#F2F2F7]/80 backdrop-blur-md">
        <ModalHeader
          title="Services"
          subtitle={`${services.length} services`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
        />
        <CategoryTabs
          active={activeCategory}
          onChange={setActiveCategory}
          counts={categoryCounts}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10">
        {loading
          ? (
              <LoadingSkeleton />
            )
          : error
            ? (
                <div className="flex flex-col items-center justify-center px-8 py-20">
                  <p className="mb-2 text-sm text-red-600">{error}</p>
                  <button
                    type="button"
                    onClick={fetchServices}
                    className="text-sm font-medium text-[#007AFF]"
                  >
                    Try again
                  </button>
                </div>
              )
            : filteredServices.length === 0
              ? (
                  <EmptyState category={activeCategory} />
                )
              : (
                  <div className="mx-4 overflow-hidden rounded-[10px] bg-white shadow-sm">
                    {filteredServices.map((service, index) => (
                      <ServiceRow
                        key={service.id}
                        service={service}
                        isLast={index === filteredServices.length - 1}
                        onClick={() => setSelectedService(service)}
                      />
                    ))}
                  </div>
                )}
      </div>

      {/* Service Detail Overlay */}
      <AnimatePresence>
        {selectedService && (
          <ServiceDetail
            service={selectedService}
            onBack={() => setSelectedService(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

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

import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, 
  DollarSign, 
  ChevronRight,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { useSalon } from '@/providers/SalonProvider';

import { ModalHeader, BackButton } from './AppModal';

// Types
interface ServiceData {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  category: string;
  imageUrl: string | null;
  isActive: boolean;
}

interface ServicesModalProps {
  onClose: () => void;
}

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
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {CATEGORIES.map((cat) => {
          const isActive = active === cat.id;
          const count = cat.id === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[cat.id] || 0);
          
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onChange(cat.id)}
              className={`
                flex items-center gap-2 px-4 py-2 rounded-full text-[14px] font-medium
                transition-all whitespace-nowrap
                ${isActive 
                  ? 'bg-[#007AFF] text-white shadow-sm' 
                  : 'bg-white text-[#1C1C1E] border border-gray-200'
                }
              `}
            >
              <cat.icon className="w-4 h-4" />
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
  onClick 
}: { 
  service: ServiceData; 
  isLast: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center pl-4 min-h-[72px] active:bg-gray-50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      {/* Icon */}
      <div className={`w-12 h-12 rounded-[12px] bg-gradient-to-br ${getCategoryGradient(service.category)} flex items-center justify-center mr-3 shadow-sm`}>
        <Scissors className="w-6 h-6 text-white" />
      </div>
      
      {/* Content */}
      <div className={`flex-1 flex items-center justify-between pr-4 py-3 ${!isLast ? 'border-b border-gray-100' : ''}`}>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-semibold text-[#1C1C1E] truncate">{service.name}</div>
          <div className="text-[13px] text-[#8E8E93] mt-0.5 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(service.durationMinutes)}
            </span>
            <span className="capitalize text-[12px] px-2 py-0.5 bg-gray-100 rounded-full">
              {service.category}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="text-[17px] font-semibold text-[#34C759]">
            {formatCurrency(service.price)}
          </div>
          <ChevronRight className="w-4 h-4 text-[#C7C7CC]" />
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
    <div className="flex flex-col items-center justify-center py-20 px-8">
      <div className="w-16 h-16 rounded-full bg-[#F2F2F7] flex items-center justify-center mb-4">
        <Scissors className="w-8 h-8 text-[#8E8E93]" />
      </div>
      <h3 className="text-[17px] font-semibold text-[#1C1C1E] mb-1">
        No Services
      </h3>
      <p className="text-[15px] text-[#8E8E93] text-center">
        {category === 'all' 
          ? 'Add services to your catalog'
          : `No ${category} services available`
        }
      </p>
    </div>
  );
}

/**
 * Service Detail View Component
 */
function ServiceDetail({ 
  service, 
  onBack 
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
      className="absolute inset-0 bg-[#F2F2F7] overflow-y-auto"
    >
      <ModalHeader
        title={service.name}
        leftAction={<BackButton onClick={onBack} label="Services" />}
      />
      
      <div className="p-4">
        {/* Hero Card */}
        <div className="bg-white rounded-[22px] p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4">
          <div className="flex flex-col items-center">
            <div className={`w-20 h-20 rounded-[20px] bg-gradient-to-br ${getCategoryGradient(service.category)} flex items-center justify-center mb-4 shadow-lg`}>
              <Scissors className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-[22px] font-semibold text-[#1C1C1E] text-center">{service.name}</h2>
            <div className="flex items-center gap-4 mt-3">
              <span className="capitalize text-[13px] px-3 py-1 bg-gray-100 rounded-full text-[#8E8E93]">
                {service.category}
              </span>
              {service.isActive ? (
                <span className="text-[13px] px-3 py-1 bg-green-100 rounded-full text-green-600">
                  Active
                </span>
              ) : (
                <span className="text-[13px] px-3 py-1 bg-gray-100 rounded-full text-gray-500">
                  Inactive
                </span>
              )}
            </div>
          </div>
        </div>
        
        {/* Price & Duration */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium">
              <DollarSign className="w-4 h-4" />
              Price
            </div>
            <div className="text-[32px] font-bold text-[#34C759] mt-1">
              {formatCurrency(service.price)}
            </div>
          </div>
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="flex items-center gap-2 text-[13px] text-[#8E8E93] uppercase font-medium">
              <Clock className="w-4 h-4" />
              Duration
            </div>
            <div className="text-[32px] font-bold text-[#1C1C1E] mt-1">
              {formatDuration(service.durationMinutes)}
            </div>
          </div>
        </div>
        
        {/* Description */}
        {service.description && (
          <div className="bg-white rounded-[16px] p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
            <div className="text-[13px] text-[#8E8E93] uppercase font-medium mb-2">Description</div>
            <p className="text-[15px] text-[#1C1C1E] leading-relaxed">{service.description}</p>
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
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center px-4 py-4">
          <div className="w-12 h-12 rounded-[12px] bg-gray-200 mr-3" />
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-40 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-24" />
          </div>
          <div className="h-5 bg-gray-200 rounded w-16" />
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
    <div className="min-h-full w-full bg-[#F2F2F7] text-black font-sans flex flex-col relative">
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
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 px-8">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <button
              type="button"
              onClick={fetchServices}
              className="text-sm text-[#007AFF] font-medium"
            >
              Try again
            </button>
          </div>
        ) : filteredServices.length === 0 ? (
          <EmptyState category={activeCategory} />
        ) : (
          <div className="bg-white mx-4 rounded-[10px] overflow-hidden shadow-sm">
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


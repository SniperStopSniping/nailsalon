'use client';

/**
 * ServicesModal Component
 *
 * iOS-style service catalog modal.
 * Features:
 * - Service list grouped by category
 * - Price and duration display
 * - Category tabs (canonical public categories first, legacy categories retained)
 * - Service details on tap
 * - Fetches real data from /api/salon/services
 */

import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronRight,
  Clock,
  DollarSign,
  Loader2,
  Scissors,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { AdminDetailCard } from '@/components/admin/AdminDetailCard';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import { ListSurface } from '@/components/ui/list-surface';

import { BackButton, ModalHeader } from './AppModal';

// Types
type ServiceData = {
  id: string;
  name: string;
  description: string | null;
  descriptionItems?: string[] | null;
  price: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  category: string;
  imageUrl: string | null;
  isActive: boolean;
  isIntroPrice?: boolean | null;
  introPriceLabel?: string | null;
};

type ServicesModalProps = {
  onClose: () => void;
  salonSlug: string | null;
};

type ServiceCategory = 'manicure' | 'builder_gel' | 'extensions' | 'pedicure' | 'hands' | 'feet' | 'combo';

// Category definitions
const CATEGORIES = [
  { id: 'all', label: 'All', icon: Sparkles },
  { id: 'manicure', label: 'Manicure', icon: Scissors },
  { id: 'builder_gel', label: 'Builder Gel', icon: Sparkles },
  { id: 'extensions', label: 'Extensions', icon: Sparkles },
  { id: 'pedicure', label: 'Pedicure', icon: Scissors },
  { id: 'combo', label: 'Combo', icon: Sparkles },
  { id: 'hands', label: 'Hands', icon: Scissors },
  { id: 'feet', label: 'Feet', icon: Scissors },
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
    case 'manicure': return 'from-[#f093fb] to-[#f5576c]';
    case 'builder_gel': return 'from-[#8EC5FC] to-[#E0C3FC]';
    case 'extensions': return 'from-[#f6d365] to-[#fda085]';
    case 'pedicure': return 'from-[#4facfe] to-[#00f2fe]';
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
            {service.priceDisplayText || formatCurrency(service.price)}
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
function EmptyState({
  category,
  onAddService,
}: {
  category: string;
  onAddService: () => void;
}) {
  return (
    <AsyncStatePanel
      icon={<Scissors className="mx-auto size-8 text-[#8E8E93]" />}
      title="No Services"
      description={category === 'all'
        ? 'Add services to your catalog.'
        : `No ${category} services available.`}
      className="mx-4 my-8"
      action={(
        <Button type="button" variant="brandSoft" size="pillSm" onClick={onAddService}>
          Add Service
        </Button>
      )}
    />
  );
}

function AddServiceDialog({
  isOpen,
  salonSlug,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  salonSlug: string | null;
  onClose: () => void;
  onCreated: (service: ServiceData) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceDisplayText, setPriceDisplayText] = useState('');
  const [price, setPrice] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [category, setCategory] = useState<ServiceCategory>('manicure');
  const [isIntroPrice, setIsIntroPrice] = useState(false);
  const [introPriceLabel, setIntroPriceLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setName('');
      setDescription('');
      setPriceDisplayText('');
      setPrice('');
      setDurationMinutes('');
      setCategory('manicure');
      setIsIntroPrice(false);
      setIntroPriceLabel('');
      setSaving(false);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!salonSlug) {
      setError('Select a salon before adding services.');
      return;
    }

    const trimmedName = name.trim();
    const parsedPrice = Number.parseFloat(price);
    const parsedDuration = Number.parseInt(durationMinutes, 10);

    if (!trimmedName) {
      setError('Service name is required.');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError('Enter a valid price.');
      return;
    }
    if (!Number.isInteger(parsedDuration) || parsedDuration < 5) {
      setError('Enter a valid duration in minutes.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/salon/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          name: trimmedName,
          description: description.trim() || null,
          descriptionItems: description
            .split('\n')
            .map(item => item.trim())
            .filter(Boolean),
          price: Math.round(parsedPrice * 100),
          priceDisplayText: priceDisplayText.trim() || null,
          durationMinutes: parsedDuration,
          category,
          isIntroPrice,
          introPriceLabel: isIntroPrice ? introPriceLabel.trim() || null : null,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Failed to create service');
      }

      const createdService = result?.data?.service as ServiceData | undefined;
      if (!createdService) {
        throw new Error('Created service was missing from the response');
      }

      onCreated(createdService);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create service');
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      maxWidthClassName="max-w-md"
      contentClassName="rounded-3xl bg-white p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[#1C1C1E]">Add Service</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Create a new bookable service for this salon.
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Name</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="BIAB Short"
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-[#007AFF]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={event => setPrice(event.target.value)}
              placeholder="65"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-[#007AFF]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Duration</span>
            <input
              type="number"
              min="5"
              step="5"
              inputMode="numeric"
              value={durationMinutes}
              onChange={event => setDurationMinutes(event.target.value)}
              placeholder="75"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-[#007AFF]"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Category</span>
          <select
            value={category}
            onChange={event => setCategory(event.target.value as ServiceCategory)}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-[#007AFF]"
          >
            <option value="manicure">Manicure</option>
            <option value="builder_gel">Builder Gel</option>
            <option value="extensions">Extensions</option>
            <option value="pedicure">Pedicure</option>
            <option value="combo">Combo</option>
            <option value="hands">Hands</option>
            <option value="feet">Feet</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Description items</span>
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            rows={3}
            placeholder={'One benefit per line\nDry manicure\nDetailed cuticle work'}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-[#007AFF]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Price display text</span>
          <input
            type="text"
            value={priceDisplayText}
            onChange={event => setPriceDisplayText(event.target.value)}
            placeholder="$70+"
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-[#007AFF]"
          />
        </label>

        <label className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-3">
          <span className="text-sm font-medium text-[#1C1C1E]">Intro pricing badge</span>
          <input
            type="checkbox"
            checked={isIntroPrice}
            onChange={event => setIsIntroPrice(event.target.checked)}
            className="size-4"
          />
        </label>

        {isIntroPrice && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Intro label</span>
            <input
              type="text"
              value={introPriceLabel}
              onChange={event => setIntroPriceLabel(event.target.value)}
              placeholder="Founding Client Price"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-[#007AFF]"
            />
          </label>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="brandSoft" size="pillSm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="brand" size="pillSm" onClick={handleSubmit} disabled={saving}>
            {saving
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving...
                  </>
                )
              : 'Save Service'}
          </Button>
        </div>
      </div>
    </DialogShell>
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
        <AdminDetailCard className="mb-4 rounded-[22px]" contentClassName="p-6">
          <div className="flex flex-col items-center">
            <div className={`size-20 rounded-[20px] bg-gradient-to-br ${getCategoryGradient(service.category)} mb-4 flex items-center justify-center shadow-lg`}>
              <Scissors className="size-10 text-white" />
            </div>
            <h2 className="text-center text-[22px] font-semibold text-[#1C1C1E]">{service.name}</h2>
            <div className="mt-3 flex items-center gap-4">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[13px] capitalize text-[#8E8E93]">
                {service.category}
              </span>
              {service.isIntroPrice && service.introPriceLabel && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-[13px] text-amber-700">
                  {service.introPriceLabel}
                </span>
              )}
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
        </AdminDetailCard>

        {/* Price & Duration */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <AdminDetailCard>
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[#8E8E93]">
              <DollarSign className="size-4" />
              Price
            </div>
            <div className="mt-1 text-[32px] font-bold text-[#34C759]">
              {service.priceDisplayText || formatCurrency(service.price)}
            </div>
          </AdminDetailCard>
          <AdminDetailCard>
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[#8E8E93]">
              <Clock className="size-4" />
              Duration
            </div>
            <div className="mt-1 text-[32px] font-bold text-[#1C1C1E]">
              {formatDuration(service.durationMinutes)}
            </div>
          </AdminDetailCard>
        </div>

        {/* Description */}
        {(service.descriptionItems?.length || service.description) && (
          <AdminDetailCard>
            <div className="mb-2 text-[13px] font-medium uppercase text-[#8E8E93]">Description</div>
            {service.descriptionItems && service.descriptionItems.length > 0
              ? (
                  <ul className="space-y-2 text-[15px] leading-relaxed text-[#1C1C1E]">
                    {service.descriptionItems.map(item => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 text-[#8E8E93]">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )
              : <p className="text-[15px] leading-relaxed text-[#1C1C1E]">{service.description}</p>}
          </AdminDetailCard>
        )}
      </div>
    </motion.div>
  );
}

export function ServicesModal({ onClose, salonSlug }: ServicesModalProps) {
  const [services, setServices] = useState<ServiceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [selectedService, setSelectedService] = useState<ServiceData | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  // Fetch services data from real API
  const fetchServices = useCallback(async () => {
    if (!salonSlug) {
      setServices([]);
      setLoading(false);
      setError('Select a salon to view services');
      return;
    }

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
        descriptionItems?: string[] | null;
        price: number;
        priceDisplayText?: string | null;
        durationMinutes: number;
        category: string;
        imageUrl: string | null;
        isActive: boolean;
        isIntroPrice?: boolean | null;
        introPriceLabel?: string | null;
      }) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        descriptionItems: service.descriptionItems ?? null,
        price: service.price,
        priceDisplayText: service.priceDisplayText ?? null,
        durationMinutes: service.durationMinutes,
        category: service.category,
        imageUrl: service.imageUrl,
        isActive: service.isActive,
        isIntroPrice: service.isIntroPrice ?? false,
        introPriceLabel: service.introPriceLabel ?? null,
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
          rightAction={(
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              disabled={!salonSlug}
              className="text-[17px] font-medium text-[#007AFF] transition-opacity active:opacity-50 disabled:text-[#8E8E93] disabled:opacity-60"
            >
              Add
            </button>
          )}
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
              <div className="px-4 py-4">
                <AsyncStatePanel
                  loading
                  title="Loading services"
                  description="Fetching your live service catalog."
                />
              </div>
            )
          : error
            ? (
                <AsyncStatePanel
                  tone="error"
                  title="Unable to load services"
                  description={error}
                  className="mx-4 my-8"
                  action={(
                    <Button type="button" variant="brandSoft" size="pillSm" onClick={fetchServices}>
                      Try again
                    </Button>
                  )}
                />
              )
            : filteredServices.length === 0
              ? (
                  <EmptyState category={activeCategory} onAddService={() => setShowAddDialog(true)} />
                )
              : (
                  <ListSurface className="mx-4 rounded-[10px]">
                    {filteredServices.map((service, index) => (
                      <ServiceRow
                        key={service.id}
                        service={service}
                        isLast={index === filteredServices.length - 1}
                        onClick={() => setSelectedService(service)}
                      />
                    ))}
                  </ListSurface>
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

      <AddServiceDialog
        isOpen={showAddDialog}
        salonSlug={salonSlug}
        onClose={() => setShowAddDialog(false)}
        onCreated={(createdService) => {
          setShowAddDialog(false);
          setActiveCategory(createdService.category);
          void fetchServices();
        }}
      />
    </div>
  );
}

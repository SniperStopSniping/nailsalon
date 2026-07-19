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
import { deriveBookingCategory } from '@/libs/bookingCategory';
import { LUSTER_MANICURE_TEMPLATE_KEY } from '@/libs/bookingMerchandising';
import { formatMoney } from '@/libs/formatMoney';
import type { ServiceTemplate } from '@/libs/serviceTemplateCatalog';
import { formatDuration } from '@/utils/Helpers';

import { BackButton, ModalHeader } from './AppModal';
import { ServiceLibraryTab } from './serviceLibrary/ServiceLibraryTab';

// Types
type BookingCategory = 'manicure' | 'pedicure' | 'combo';

type ServiceData = {
  id: string;
  name: string;
  description: string | null;
  descriptionItems?: string[] | null;
  price: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  preparationBufferMinutes: number;
  cleanupBufferMinutes: number;
  category: string;
  bookingCategory: BookingCategory;
  templateKey?: string | null;
  featuredOrder?: number | null;
  imageUrl: string | null;
  isActive: boolean;
  isIntroPrice?: boolean | null;
  introPriceLabel?: string | null;
};

type ServicePrefill = {
  name: string;
  description: string;
  price: number; // cents
  priceDisplayText?: string | null;
  durationMinutes: number;
  category: ServiceCategory;
  bookingCategory?: BookingCategory;
  templateKey: string;
};

type ServicesModalProps = {
  onClose: () => void;
  salonSlug: string | null;
};

type ServiceCategory =
  | 'manicure'
  | 'builder_gel'
  | 'extensions'
  | 'pedicure'
  | 'hands'
  | 'feet'
  | 'combo';

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
  // Platform currency is CAD (bookingConfig default) — was a USD hardcode.
  return formatMoney(cents);
}

// Format duration
// Get category gradient
function getCategoryGradient(category: string): string {
  switch (category) {
    case 'manicure':
      return 'from-[#f093fb] to-[#f5576c]';
    case 'builder_gel':
      return 'from-[#8EC5FC] to-[#E0C3FC]';
    case 'extensions':
      return 'from-[#f6d365] to-[#fda085]';
    case 'pedicure':
      return 'from-[#4facfe] to-[#00f2fe]';
    case 'hands':
      return 'from-[#f093fb] to-[#f5576c]';
    case 'feet':
      return 'from-[#4facfe] to-[#00f2fe]';
    case 'combo':
      return 'from-[#43e97b] to-[#38f9d7]';
    default:
      return 'from-[#a18cd1] to-[#fbc2eb]';
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
          const count
            = cat.id === 'all'
              ? Object.values(counts).reduce((a, b) => a + b, 0)
              : counts[cat.id] || 0;

          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onChange(cat.id)}
              className={`
                flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[14px]
                font-medium transition-all
                ${
            isActive
              ? 'bg-rose-800 text-white shadow-sm'
              : 'border border-gray-200 bg-white text-[#1C1C1E]'
            }
              `}
            >
              <cat.icon className="size-4" />
              {cat.label}
              <span
                className={`text-[12px] ${isActive ? 'text-white/70' : 'text-[#8E8E93]'}`}
              >
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
      <div
        className={`size-12 rounded-[12px] bg-gradient-to-br ${getCategoryGradient(service.category)} mr-3 flex items-center justify-center shadow-sm`}
      >
        <Scissors className="size-6 text-white" />
      </div>

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between py-3 pr-4 ${!isLast ? 'border-b border-gray-100' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold text-[#1C1C1E]">
            {service.name}
          </div>
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
          <div className="text-[17px] font-semibold text-emerald-700">
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
      description={
        category === 'all'
          ? 'Add services to your catalog.'
          : `No ${category} services available.`
      }
      className="mx-4 my-8"
      action={(
        <Button
          type="button"
          variant="brandSoft"
          size="pillSm"
          onClick={onAddService}
        >
          Add Service
        </Button>
      )}
    />
  );
}

function AddServiceDialog({
  isOpen,
  salonSlug,
  service,
  prefill,
  nextFeaturedOrder,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  salonSlug: string | null;
  service?: ServiceData | null;
  /** Pre-populates the create form (e.g. the Luster setup flow). */
  prefill?: ServicePrefill | null;
  /** Position assigned when the owner turns featuring on. */
  nextFeaturedOrder: number;
  onClose: () => void;
  onSaved: (service: ServiceData) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceDisplayText, setPriceDisplayText] = useState('');
  const [price, setPrice] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [preparationBufferMinutes, setPreparationBufferMinutes] = useState('0');
  const [cleanupBufferMinutes, setCleanupBufferMinutes] = useState('0');
  const [category, setCategory] = useState<ServiceCategory>('manicure');
  const [bookingCategory, setBookingCategory] = useState<BookingCategory>('manicure');
  const [bookingCategoryTouched, setBookingCategoryTouched] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isIntroPrice, setIsIntroPrice] = useState(false);
  const [introPriceLabel, setIntroPriceLabel] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && service) {
      setName(service.name);
      setDescription(
        (service.descriptionItems?.length
          ? service.descriptionItems.join('\n')
          : service.description) || '',
      );
      setPriceDisplayText(service.priceDisplayText || '');
      setPrice(String(service.price / 100));
      setDurationMinutes(String(service.durationMinutes));
      setPreparationBufferMinutes(
        String(service.preparationBufferMinutes || 0),
      );
      setCleanupBufferMinutes(String(service.cleanupBufferMinutes || 0));
      setCategory(service.category as ServiceCategory);
      setBookingCategory(
        service.bookingCategory
        ?? deriveBookingCategory(service.category as ServiceCategory),
      );
      setBookingCategoryTouched(true);
      setIsFeatured(service.featuredOrder != null);
      setIsIntroPrice(Boolean(service.isIntroPrice));
      setIntroPriceLabel(service.introPriceLabel || '');
      setIsActive(service.isActive);
      setError(null);
    } else if (isOpen && prefill) {
      setName(prefill.name);
      setDescription(prefill.description);
      setPrice(String(prefill.price / 100));
      setPriceDisplayText(prefill.priceDisplayText ?? '');
      setDurationMinutes(String(prefill.durationMinutes));
      setCategory(prefill.category);
      setBookingCategory(prefill.bookingCategory ?? deriveBookingCategory(prefill.category));
      setBookingCategoryTouched(Boolean(prefill.bookingCategory));
      setError(null);
    } else if (!isOpen) {
      setName('');
      setDescription('');
      setPriceDisplayText('');
      setPrice('');
      setDurationMinutes('');
      setPreparationBufferMinutes('0');
      setCleanupBufferMinutes('0');
      setCategory('manicure');
      setBookingCategory('manicure');
      setBookingCategoryTouched(false);
      setIsFeatured(false);
      setIsIntroPrice(false);
      setIntroPriceLabel('');
      setIsActive(true);
      setSaving(false);
      setError(null);
    }
  }, [isOpen, service, prefill]);

  const handleSubmit = async () => {
    if (!salonSlug) {
      setError('Select a salon before adding services.');
      return;
    }

    const trimmedName = name.trim();
    const parsedPrice = Number.parseFloat(price);
    const parsedDuration = Number.parseInt(durationMinutes, 10);
    const parsedPreparationBuffer = Number.parseInt(
      preparationBufferMinutes,
      10,
    );
    const parsedCleanupBuffer = Number.parseInt(cleanupBufferMinutes, 10);

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
    if (
      !Number.isInteger(parsedPreparationBuffer)
      || parsedPreparationBuffer < 0
      || parsedPreparationBuffer > 120
      || !Number.isInteger(parsedCleanupBuffer)
      || parsedCleanupBuffer < 0
      || parsedCleanupBuffer > 120
    ) {
      setError(
        'Preparation and cleanup buffers must be between 0 and 120 minutes.',
      );
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        service
          ? `/api/salon/services/${encodeURIComponent(service.id)}`
          : '/api/salon/services',
        {
          method: service ? 'PATCH' : 'POST',
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
            preparationBufferMinutes: parsedPreparationBuffer,
            cleanupBufferMinutes: parsedCleanupBuffer,
            category,
            bookingCategory,
            featuredOrder: isFeatured
              ? service?.featuredOrder ?? nextFeaturedOrder
              : null,
            ...(service ? {} : { templateKey: prefill?.templateKey ?? null }),
            isIntroPrice,
            introPriceLabel: isIntroPrice
              ? introPriceLabel.trim() || null
              : null,
            isActive,
          }),
        },
      );

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Failed to save service');
      }

      const createdService = result?.data?.service as ServiceData | undefined;
      if (!createdService) {
        throw new Error('Saved service was missing from the response');
      }

      onSaved(createdService);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to save service',
      );
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
      contentClassName="max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[#1C1C1E]">
            {service ? 'Edit Service' : 'Add Service'}
          </h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            {service
              ? 'Update what clients see and how much calendar time this service reserves.'
              : 'Create a new bookable service for this salon.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
              Preparation buffer
            </span>
            <input
              type="number"
              min="0"
              max="120"
              step="5"
              inputMode="numeric"
              value={preparationBufferMinutes}
              onChange={event =>
                setPreparationBufferMinutes(event.target.value)}
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
              Cleanup buffer
            </span>
            <input
              type="number"
              min="0"
              max="120"
              step="5"
              inputMode="numeric"
              value={cleanupBufferMinutes}
              onChange={event => setCleanupBufferMinutes(event.target.value)}
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>
          <p className="col-span-2 text-xs leading-5 text-[#6B7280]">
            Luster reserves the larger of the salon-wide buffer or these service
            buffers after the client duration, preventing back-to-back overlap.
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="BIAB Short"
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
              Price
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={event => setPrice(event.target.value)}
              placeholder="65"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
              Duration
            </span>
            <input
              type="number"
              min="5"
              step="5"
              inputMode="numeric"
              value={durationMinutes}
              onChange={event => setDurationMinutes(event.target.value)}
              placeholder="75"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
            Category
          </span>
          <select
            value={category}
            onChange={(event) => {
              const nextCategory = event.target.value as ServiceCategory;
              setCategory(nextCategory);
              if (!bookingCategoryTouched) {
                setBookingCategory(deriveBookingCategory(nextCategory));
              }
            }}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
          >
            <option value="manicure">Manicure</option>
            <option value="builder_gel">Builder Gel</option>
            <option value="extensions">Extensions</option>
            <option value="pedicure">Pedicure</option>
            <option value="combo">Combo</option>
            <option value="hands">Hands</option>
            <option value="feet">Feet</option>
          </select>
          {['hands', 'feet'].includes(category) && (
            <span className="mt-1.5 block text-xs font-medium text-amber-700">
              Heads up: services in this category don’t show on your public booking page.
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
            Booking page section
          </span>
          <select
            data-testid="service-booking-category"
            value={bookingCategory}
            onChange={(event) => {
              setBookingCategory(event.target.value as BookingCategory);
              setBookingCategoryTouched(true);
            }}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
          >
            <option value="manicure">Manicure</option>
            <option value="pedicure">Pedicure</option>
            <option value="combo">Combos</option>
          </select>
          <span className="mt-1.5 block text-xs text-[#6B7280]">
            Which tab clients find this service under on your booking page.
          </span>
        </label>

        <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span>
            <span className="block text-sm font-medium text-[#1C1C1E]">
              ⭐ Feature this service
            </span>
            <span className="block text-xs text-[#6B7280]">
              {isFeatured && service?.featuredOrder != null
                ? `Featured — position ${service.featuredOrder}`
                : 'Show it in Featured Services on your booking page.'}
            </span>
          </span>
          <input
            type="checkbox"
            data-testid="service-featured-toggle"
            checked={isFeatured}
            onChange={event => setIsFeatured(event.target.checked)}
            className="size-4"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
            Description items
          </span>
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            rows={3}
            placeholder={
              'One benefit per line\nDry manicure\nDetailed cuticle work'
            }
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-rose-700"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
            Price display text
          </span>
          <input
            type="text"
            value={priceDisplayText}
            onChange={event => setPriceDisplayText(event.target.value)}
            placeholder="$70+"
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
          />
        </label>

        <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span className="text-sm font-medium text-[#1C1C1E]">
            Intro pricing badge
          </span>
          <input
            type="checkbox"
            checked={isIntroPrice}
            onChange={event => setIsIntroPrice(event.target.checked)}
            className="size-4"
          />
        </label>

        {service && (
          <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
            <span>
              <span className="block text-sm font-medium text-[#1C1C1E]">
                Bookable
              </span>
              <span className="block text-xs text-[#6B7280]">
                Turn off to hide this service without deleting history.
              </span>
            </span>
            <input
              type="checkbox"
              checked={isActive}
              onChange={event => setIsActive(event.target.checked)}
              className="size-4"
            />
          </label>
        )}

        {isIntroPrice && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
              Intro label
            </span>
            <input
              type="text"
              value={introPriceLabel}
              onChange={event => setIntroPriceLabel(event.target.value)}
              placeholder="Founding Client Price"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="brandSoft"
            size="pillSm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            size="pillSm"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving
              ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving...
                  </>
                )
              : service
                ? (
                    'Update Service'
                  )
                : (
                    'Save Service'
                  )}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

const LUSTER_PREFILL: ServicePrefill = {
  name: 'Luster Manicure',
  description: 'A premium structured manicure using Luster professional products.',
  price: 4500,
  durationMinutes: 60,
  category: 'manicure',
  templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
};

/**
 * Owner-only setup card shown when the salon has no active Luster Manicure.
 * Never rendered on any client-facing surface. If a deactivated Luster service
 * exists, the POST /api/salon/services template path revives it in place.
 */
function LusterPromoCard({
  onSetUp,
  onDismiss,
}: {
  onSetUp: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      data-testid="luster-promo-card"
      className="mx-4 mb-3 rounded-[18px] border border-rose-100 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-[#1C1C1E]">
            Offer the Luster Manicure
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[#6B7280]">
            Add a premium manicure service using your complimentary Luster
            product sample.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid="luster-promo-dismiss"
          onClick={onDismiss}
          className="shrink-0 text-[13px] font-medium text-[#8E8E93]"
        >
          Not now
        </button>
      </div>
      <div className="mt-3">
        <Button
          type="button"
          variant="brand"
          size="pillSm"
          data-testid="luster-promo-cta"
          onClick={onSetUp}
        >
          Set Up Service
        </Button>
      </div>
    </div>
  );
}

/**
 * Service Detail View Component
 */
function ServiceDetail({
  service,
  onBack,
  onEdit,
}: {
  service: ServiceData;
  onBack: () => void;
  onEdit: () => void;
}) {
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute inset-0 overflow-y-auto bg-[#FFF8F5]"
    >
      <ModalHeader
        title={service.name}
        leftAction={<BackButton onClick={onBack} label="Services" />}
        rightAction={(
          <button
            type="button"
            onClick={onEdit}
            className="text-[17px] font-medium text-rose-800"
          >
            Edit
          </button>
        )}
      />

      <div className="p-4">
        {/* Hero Card */}
        <AdminDetailCard className="mb-4 rounded-[22px]" contentClassName="p-6">
          <div className="flex flex-col items-center">
            <div
              className={`size-20 rounded-[20px] bg-gradient-to-br ${getCategoryGradient(service.category)} mb-4 flex items-center justify-center shadow-lg`}
            >
              <Scissors className="size-10 text-white" />
            </div>
            <h2 className="text-center text-[22px] font-semibold text-[#1C1C1E]">
              {service.name}
            </h2>
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
            <div className="mt-1 text-[32px] font-bold text-emerald-700">
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

        {(service.preparationBufferMinutes > 0
          || service.cleanupBufferMinutes > 0) && (
          <AdminDetailCard className="mb-4">
            <div className="text-[13px] font-medium uppercase text-[#8E8E93]">
              Reserved setup time
            </div>
            <p className="mt-1 text-[15px] text-[#1C1C1E]">
              {service.preparationBufferMinutes}
              {' min preparation · '}
              {service.cleanupBufferMinutes}
              {' min cleanup'}
            </p>
          </AdminDetailCard>
        )}

        {/* Description */}
        {(service.descriptionItems?.length || service.description) && (
          <AdminDetailCard>
            <div className="mb-2 text-[13px] font-medium uppercase text-[#8E8E93]">
              Description
            </div>
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
              : (
                  <p className="text-[15px] leading-relaxed text-[#1C1C1E]">
                    {service.description}
                  </p>
                )}
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
  const [selectedService, setSelectedService] = useState<ServiceData | null>(
    null,
  );
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingService, setEditingService] = useState<ServiceData | null>(
    null,
  );
  const [addDialogPrefill, setAddDialogPrefill] = useState<ServicePrefill | null>(null);
  const [lusterPromoDismissed, setLusterPromoDismissed] = useState<boolean | null>(null);
  const [libraryIntroDismissed, setLibraryIntroDismissed] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<'menu' | 'library'>('menu');
  const [ownedTemplateKeys, setOwnedTemplateKeys] = useState<Set<string>>(new Set());
  const [bulkAddBusy, setBulkAddBusy] = useState(false);

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

      const response = await fetch(
        `/api/salon/services?salonSlug=${salonSlug}`,
      );

      if (!response.ok) {
        throw new Error('Failed to load services');
      }

      const result = await response.json();
      const fetchedServices = result.data?.services || [];

      // Transform API data to component format
      const transformedServices: ServiceData[] = fetchedServices.map(
        (service: {
          id: string;
          name: string;
          description: string | null;
          descriptionItems?: string[] | null;
          price: number;
          priceDisplayText?: string | null;
          durationMinutes: number;
          preparationBufferMinutes?: number;
          cleanupBufferMinutes?: number;
          category: string;
          bookingCategory?: BookingCategory | null;
          templateKey?: string | null;
          featuredOrder?: number | null;
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
          preparationBufferMinutes: service.preparationBufferMinutes ?? 0,
          cleanupBufferMinutes: service.cleanupBufferMinutes ?? 0,
          category: service.category,
          bookingCategory: service.bookingCategory
            ?? deriveBookingCategory(service.category as ServiceCategory),
          templateKey: service.templateKey ?? null,
          featuredOrder: service.featuredOrder ?? null,
          imageUrl: service.imageUrl,
          isActive: service.isActive,
          isIntroPrice: service.isIntroPrice ?? false,
          introPriceLabel: service.introPriceLabel ?? null,
        }),
      );

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

  // Load the promo-card dismissal state; stay hidden until it's known.
  useEffect(() => {
    if (!salonSlug) {
      return;
    }
    let cancelled = false;
    const loadMerchandising = async () => {
      try {
        const response = await fetch(
          `/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        );
        if (!response.ok) {
          return;
        }
        const result = await response.json();
        if (!cancelled) {
          setLusterPromoDismissed(
            Boolean(result?.merchandising?.lusterPromoDismissed),
          );
          setLibraryIntroDismissed(
            Boolean(result?.merchandising?.serviceLibraryIntroDismissed),
          );
        }
      } catch {
        // Promo card simply stays hidden if settings can't be loaded.
      }
    };
    void loadMerchandising();
    return () => {
      cancelled = true;
    };
  }, [salonSlug]);

  const fetchOwnedTemplateKeys = useCallback(async () => {
    if (!salonSlug) {
      return;
    }
    try {
      const response = await fetch(
        `/api/salon/services/from-templates?salonSlug=${encodeURIComponent(salonSlug)}`,
      );
      if (!response.ok) {
        return;
      }
      const result = await response.json();
      setOwnedTemplateKeys(new Set(result?.data?.ownedTemplateKeys ?? []));
    } catch {
      // "Added" states degrade gracefully; the server still blocks duplicates.
    }
  }, [salonSlug]);

  useEffect(() => {
    void fetchOwnedTemplateKeys();
  }, [fetchOwnedTemplateKeys]);

  const patchMerchandising = useCallback(async (update: Record<string, boolean>) => {
    if (!salonSlug) {
      return;
    }
    try {
      await fetch(
        `/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchandising: update }),
        },
      );
    } catch {
      // Dismissals are best-effort; the card is already hidden locally.
    }
  }, [salonSlug]);

  const handleAddTemplate = useCallback(async (template: ServiceTemplate) => {
    if (template.serviceType === 'addon') {
      // Add-ons are created server-side with their defaults and wired to any
      // compatible services already on the menu.
      if (!salonSlug) {
        return;
      }
      const response = await fetch('/api/salon/services/from-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug, templateKeys: [template.systemKey] }),
      });
      if (response.ok) {
        setOwnedTemplateKeys(current => new Set([...current, template.systemKey]));
        void fetchServices();
      }
      return;
    }

    setAddDialogPrefill({
      name: template.name,
      description: template.description ?? '',
      price: template.defaultPriceCents,
      priceDisplayText: template.priceDisplayText,
      durationMinutes: template.defaultDurationMinutes,
      category: template.serviceCategory as ServiceCategory,
      bookingCategory: template.bookingCategory,
      templateKey: template.systemKey,
    });
    setShowAddDialog(true);
  }, [salonSlug, fetchServices]);

  const handleBulkAdd = useCallback(async (templateKeys: string[]) => {
    if (!salonSlug || templateKeys.length === 0) {
      return;
    }
    setBulkAddBusy(true);
    try {
      const response = await fetch('/api/salon/services/from-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug, templateKeys }),
      });
      if (response.ok) {
        setOwnedTemplateKeys(current => new Set([...current, ...templateKeys]));
        void fetchServices();
      }
    } finally {
      setBulkAddBusy(false);
    }
  }, [salonSlug, fetchServices]);

  const dismissLusterPromo = useCallback(async () => {
    setLusterPromoDismissed(true);
    if (!salonSlug) {
      return;
    }
    try {
      await fetch(
        `/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchandising: { lusterPromoDismissed: true } }),
        },
      );
    } catch {
      // Dismissal is best-effort; the card is already hidden locally.
    }
  }, [salonSlug]);

  const lusterService = services.find(
    service => service.templateKey === LUSTER_MANICURE_TEMPLATE_KEY,
  ) ?? null;
  const showLusterPromo = !loading
    && !error
    && lusterPromoDismissed === false
    && (!lusterService || !lusterService.isActive);
  const nextFeaturedOrder = services.reduce(
    (max, service) => Math.max(max, service.featuredOrder ?? 0),
    0,
  ) + 1;

  // Filter services by category
  const filteredServices
    = activeCategory === 'all'
      ? services
      : services.filter(s => s.category === activeCategory);

  // Count per category
  const categoryCounts: Record<string, number> = {};
  for (const service of services) {
    categoryCounts[service.category]
      = (categoryCounts[service.category] || 0) + 1;
  }

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#FFF8F5] font-sans text-black">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#FFF8F5]/90 backdrop-blur-md">
        <ModalHeader
          title="Services"
          subtitle={`${services.length} services`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
          rightAction={(
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              disabled={!salonSlug}
              className="text-[17px] font-medium text-rose-800 transition-opacity active:opacity-50 disabled:text-[#8E8E93] disabled:opacity-60"
            >
              Add
            </button>
          )}
        />
        <div className="px-4 pb-2">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-gray-100 p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'menu'}
              data-testid="services-tab-menu"
              onClick={() => setActiveTab('menu')}
              className={`rounded-full px-4 py-2 text-[14px] font-semibold transition-all ${
                activeTab === 'menu' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
              }`}
            >
              My Menu
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'library'}
              data-testid="services-tab-library"
              onClick={() => setActiveTab('library')}
              className={`rounded-full px-4 py-2 text-[14px] font-semibold transition-all ${
                activeTab === 'library' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
              }`}
            >
              Service Library
            </button>
          </div>
        </div>
        {activeTab === 'menu' && (
          <CategoryTabs
            active={activeCategory}
            onChange={setActiveCategory}
            counts={categoryCounts}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-10">
        {activeTab === 'library' && (
          <ServiceLibraryTab
            ownedTemplateKeys={ownedTemplateKeys}
            bulkAddBusy={bulkAddBusy}
            onAddTemplate={template => void handleAddTemplate(template)}
            onBulkAdd={handleBulkAdd}
            onCreateCustom={() => {
              setAddDialogPrefill(null);
              setShowAddDialog(true);
            }}
          />
        )}
        {activeTab === 'menu' && !loading && !error && libraryIntroDismissed === false && (
          <div
            data-testid="library-intro-card"
            className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-[18px] border border-rose-100 bg-white p-4 shadow-sm"
          >
            <div>
              <div className="text-[15px] font-semibold text-[#1C1C1E]">
                Explore the new Service Library
              </div>
              <p className="mt-0.5 text-[13px] text-[#6B7280]">
                Add popular services to your menu in a couple of taps.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                data-testid="library-intro-dismiss"
                onClick={() => {
                  setLibraryIntroDismissed(true);
                  void patchMerchandising({ serviceLibraryIntroDismissed: true });
                }}
                className="text-[13px] font-medium text-[#8E8E93]"
              >
                Not now
              </button>
              <Button
                type="button"
                variant="brand"
                size="pillSm"
                data-testid="library-intro-open"
                onClick={() => setActiveTab('library')}
              >
                Open
              </Button>
            </div>
          </div>
        )}
        {activeTab === 'menu' && showLusterPromo && (
          <LusterPromoCard
            onSetUp={() => {
              setAddDialogPrefill(LUSTER_PREFILL);
              setShowAddDialog(true);
            }}
            onDismiss={() => void dismissLusterPromo()}
          />
        )}
        {activeTab === 'menu' && (loading
          ? (
              <div className="p-4">
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
                    <Button
                      type="button"
                      variant="brandSoft"
                      size="pillSm"
                      onClick={fetchServices}
                    >
                      Try again
                    </Button>
                  )}
                />
              )
            : filteredServices.length === 0
              ? (
                  <EmptyState
                    category={activeCategory}
                    onAddService={() => setShowAddDialog(true)}
                  />
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
                ))}
      </div>

      {/* Service Detail Overlay */}
      <AnimatePresence>
        {selectedService && (
          <ServiceDetail
            service={selectedService}
            onBack={() => setSelectedService(null)}
            onEdit={() => setEditingService(selectedService)}
          />
        )}
      </AnimatePresence>

      <AddServiceDialog
        isOpen={showAddDialog || Boolean(editingService)}
        salonSlug={salonSlug}
        service={editingService}
        prefill={addDialogPrefill}
        nextFeaturedOrder={nextFeaturedOrder}
        onClose={() => {
          setShowAddDialog(false);
          setEditingService(null);
          setAddDialogPrefill(null);
        }}
        onSaved={(savedService) => {
          setShowAddDialog(false);
          setEditingService(null);
          setAddDialogPrefill(null);
          setSelectedService(savedService);
          setActiveTab('menu');
          setActiveCategory(savedService.category);
          void fetchServices();
          void fetchOwnedTemplateKeys();
        }}
      />
    </div>
  );
}

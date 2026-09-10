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

import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  DollarSign,
  ImagePlus,
  Loader2,
  Save,
  Scissors,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { AdminDetailCard } from '@/components/admin/AdminDetailCard';
import { CatalogConfigTab } from '@/components/admin/catalogConfig/CatalogConfigTab';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import { InlineFeedback } from '@/components/ui/inline-feedback';
import { ListSurface } from '@/components/ui/list-surface';
import { BOOKING_CATEGORY_META, deriveBookingCategory, resolveVisibleBookingCategory } from '@/libs/bookingCategory';
import { LUSTER_MANICURE_TEMPLATE_KEY } from '@/libs/bookingMerchandising';
import { formatMoney } from '@/libs/formatMoney';
import {
  isPublicServiceCustomImageUrl,
  isUnusablePublicServiceImageUrl,
  resolveServiceCardImage,
} from '@/libs/serviceImage';
import {
  normalizeServiceImageError,
  prepareServiceImage,
  ServiceImageError,
  serviceImagePartialSuccessMessage,
  serviceImageResponseError,
  validateServiceImageFile,
} from '@/libs/serviceImageClient';
import { getTemplateByKey, type ServiceTemplate } from '@/libs/serviceTemplateCatalog';
import { formatDuration } from '@/utils/Helpers';

import { BackButton, ModalHeader } from './AppModal';
import { ADD_ON_CATEGORY_LABELS } from './serviceLibrary/addOnCategories';
import { AddOnCreateDialog } from './serviceLibrary/AddOnCreateDialog';
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
  /** Menu position. Both the owner list and the public menu ORDER BY it. */
  sortOrder?: number | null;
  isActive: boolean;
  isIntroPrice?: boolean | null;
  introPriceLabel?: string | null;
  /**
   * Enabled links to ACTIVE technicians; 0 ⇒ hidden from public booking.
   * `undefined` means "not reported by this response" and must never be read
   * as either state — see `isHiddenFromBooking` (AG-w2-services-01).
   */
  assignedTechnicianCount?: number;
};

/**
 * The single truth test behind the "Not visible in booking" row pill and the
 * detail notice. It answers only when the server actually told us the count:
 * the old `?? 1` made a missing number read as "assigned, all good", which is
 * exactly how a freshly-created unbookable service looked Active with no
 * caveat (AG-w2-services-01).
 */
function isHiddenFromBooking(service: ServiceData): boolean {
  return service.isActive && service.assignedTechnicianCount === 0;
}

/**
 * My Menu text filter (AG-services-01). Owners were the only people looking at
 * this menu without a search box — their clients have one on the public copy,
 * and the Library tab has one too. Matches the fields an owner would type:
 * the name, the category labels they can see, and the description they wrote.
 */
function matchesServiceQuery(service: ServiceData, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const haystack = [
    service.name,
    service.description ?? '',
    ...(service.descriptionItems ?? []),
    service.category,
    service.bookingCategory,
    BOOKING_CATEGORY_META[resolveVisibleBookingCategory(service)].label,
    service.priceDisplayText ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return needle
    .split(/\s+/)
    .every(token => haystack.includes(token));
}

/**
 * Moves one service one step up or down **relative to the rows the owner can
 * currently see**, and returns the salon's complete id order to persist
 * (AG-services-03). Working on the full order rather than the filtered slice
 * is what keeps a reorder done under a category chip or a search from
 * scrambling the services that were filtered out. Returns null when the move
 * is a no-op (already first/last visible row).
 */
function moveServiceOrder(
  allIds: string[],
  visibleIds: string[],
  serviceId: string,
  direction: 'up' | 'down',
): string[] | null {
  const visibleIndex = visibleIds.indexOf(serviceId);
  if (visibleIndex < 0) {
    return null;
  }
  const targetId = direction === 'up'
    ? visibleIds[visibleIndex - 1]
    : visibleIds[visibleIndex + 1];
  if (!targetId) {
    return null;
  }
  const fromIndex = allIds.indexOf(serviceId);
  if (fromIndex < 0 || !allIds.includes(targetId)) {
    return null;
  }
  const next = allIds.slice();
  next.splice(fromIndex, 1);
  const targetIndex = next.indexOf(targetId);

  next.splice(direction === 'up' ? targetIndex : targetIndex + 1, 0, serviceId);

  return next;
}

type ServicePrefill = {
  name: string;
  description: string;
  price: number; // cents
  priceDisplayText?: string | null;
  durationMinutes: number;
  category: ServiceCategory;
  bookingCategory?: BookingCategory;
  templateKey: string;
  isIntroPrice?: boolean;
  introPriceLabel?: string | null;
};

type ServiceImageIntent = 'keep' | 'replace' | 'remove';

type ServiceSavePhase
  = | 'idle'
  | 'saving-details'
  | 'preparing-image'
  | 'uploading-image'
  | 'finalizing-image'
  | 'removing-image';

type ServiceImagePresignData = {
  strategy: 'cloudinary' | 'local';
  uploadUrl?: string;
  apiKey?: string;
  timestamp?: number;
  signature?: string;
  uploadPreset?: string;
  publicId?: string;
  overwrite?: boolean;
  type?: 'upload';
  tags?: string;
  context?: string;
  finalizeToken?: string;
  cloudName?: string;
};

type AddOnData = {
  id: string;
  name: string;
  descriptionItems?: string[] | null;
  priceCents: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  category: string;
  pricingType: 'fixed' | 'per_unit';
  unitLabel?: string | null;
  maxQuantity?: number | null;
  isActive: boolean;
  /** Base services this add-on is offered under. */
  compatibleServiceIds?: string[];
};

/*
 * Add-on category labels now live beside the Service Library
 * (./serviceLibrary/addOnCategories) so the Add-ons tab, the add-on editors
 * and the library shelf all name a category the same way.
 */

type ServicesModalProps = {
  onClose: () => void;
  salonSlug: string | null;
  onOpenStaff?: () => void;
};

type ServiceCategory =
  | 'manicure'
  | 'builder_gel'
  | 'extensions'
  | 'pedicure'
  | 'hands'
  | 'feet'
  | 'combo';

// The only visible main categories (shared canonical grouping): the raw
// 7-value category stays internal metadata and never drives navigation.
const CATEGORIES = [
  { id: 'all', label: 'All', icon: Sparkles },
  { id: 'manicure', label: 'Manicure', icon: Scissors },
  { id: 'pedicure', label: 'Pedicure', icon: Scissors },
  { id: 'combo', label: 'Combos', icon: Sparkles },
];

// Format currency
function formatCurrency(cents: number): string {
  // Platform currency is CAD (bookingConfig default) — was a USD hardcode.
  return formatMoney(cents);
}

// Format duration
/**
 * The image-less placeholder tile.
 *
 * This used to be eight different saturated gradients keyed off the category
 * (hot pink, sky blue, lime, apricot…), so a menu of ten services rendered as
 * ten unrelated colours next to owner chrome that is entirely plum and warm
 * neutral. One blush tile with the plum glyph reads as the same product as
 * onboarding, and the category is already named in words on the row itself.
 */
/** Owner input that must cancel an in-flight tab-scroll restore. */
const INTERRUPT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

const CATEGORY_PLACEHOLDER_CLASS
  = 'bg-[var(--owner-blush)] text-[var(--owner-accent)] ring-1 ring-inset ring-[var(--owner-line-strong)]';

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
              ? 'bg-[var(--owner-accent)] text-white shadow-sm'
              : 'border border-[var(--owner-line)] bg-[var(--owner-surface)] text-[var(--owner-ink)]'
            }
              `}
            >
              <cat.icon className="size-4" />
              {cat.label}
              <span
                className={`text-[12px] ${isActive ? 'text-white/70' : 'text-[var(--owner-muted)]'}`}
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
  showNotBookable,
  canMoveUp,
  canMoveDown,
  reorderBusy,
  onMoveUp,
  onMoveDown,
  onClick,
}: {
  service: ServiceData;
  isLast: boolean;
  /** Active service with no eligible technician — hidden from booking. */
  showNotBookable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reorderBusy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onClick: () => void;
}) {
  // The row's own photo, never a stock stand-in: a service WITHOUT a picture
  // has to look different from one with a picture, or the owner cannot audit
  // their photography from the menu (AG-services-02). `resolveServiceCardImage`
  // is deliberately not used here for that reason.
  const hasOwnImage = !isUnusablePublicServiceImageUrl(service.imageUrl);
  const displayPrice = formatCurrency(service.price);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      data-testid={`service-row-${service.id}`}
      className="flex min-h-[72px] cursor-pointer items-center pl-4 transition-colors active:bg-[var(--owner-ground)]"
      onClick={onClick}
    >
      {/* Thumbnail */}
      {hasOwnImage
        ? (
            <div className="mr-3 size-12 shrink-0 overflow-hidden rounded-[12px] bg-[var(--owner-ground)] shadow-sm">
              {/* Service artwork can be a local /uploads path in development, which
                  next/image is not configured to optimize inside this modal. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={service.imageUrl ?? ''}
                alt=""
                loading="lazy"
                data-testid={`service-row-image-${service.id}`}
                className="size-full object-cover"
              />
            </div>
          )
        : (
            <div
              data-testid={`service-row-image-fallback-${service.id}`}
              className={`size-12 shrink-0 rounded-[12px] ${CATEGORY_PLACEHOLDER_CLASS} mr-3 flex items-center justify-center shadow-sm`}
            >
              <Scissors className="size-6 text-white" />
            </div>
          )}

      {/* Content */}
      <div
        className={`flex flex-1 items-center justify-between gap-2 py-3 pr-2 ${!isLast ? 'border-b border-[var(--owner-line)]' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold text-[var(--owner-ink)]">
            {service.name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--owner-muted)]">
            <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
              <Clock className="size-3" />
              {formatDuration(service.durationMinutes)}
            </span>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--owner-ground)] px-2 py-0.5 text-[12px]">
              {BOOKING_CATEGORY_META[resolveVisibleBookingCategory(service)].label}
            </span>
            {!service.isActive && (
              <span
                data-testid={`service-row-inactive-${service.id}`}
                className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[12px] text-[var(--owner-muted)]"
              >
                Inactive
              </span>
            )}
            {showNotBookable && (
              <span
                data-testid={`service-row-not-bookable-${service.id}`}
                className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[12px] text-amber-700"
              >
                Not bookable
              </span>
            )}
          </div>
        </div>

        {/* Price column. Capped and shrinkable so a long "price display text"
            can never win the flex negotiation against the service name
            (AG-w2-services-02), and the real amount stays the headline even
            when a display string exists (AG-w2-services-03). */}
        <div className="flex min-w-0 max-w-[104px] shrink flex-col items-end">
          <div
            data-testid={`service-row-price-${service.id}`}
            className="max-w-full truncate text-[17px] font-semibold text-emerald-700"
          >
            {displayPrice}
          </div>
          {service.priceDisplayText && (
            <div
              data-testid={`service-row-price-display-${service.id}`}
              title={service.priceDisplayText}
              className="max-w-full truncate text-[11px] leading-4 text-[var(--owner-muted)]"
            >
              {service.priceDisplayText}
            </div>
          )}
        </div>

        {/* Reorder (AG-services-03). Buttons rather than a drag handle: they
            work with a screen reader, with a keyboard and with one thumb on a
            390 px phone, which HTML5 drag-and-drop does not. */}
        <div className="flex shrink-0 flex-col items-center">
          <button
            type="button"
            data-testid={`service-row-move-up-${service.id}`}
            aria-label={`Move ${service.name} up`}
            disabled={!canMoveUp || reorderBusy}
            onClick={(event) => {
              event.stopPropagation();
              onMoveUp();
            }}
            className="flex size-7 items-center justify-center rounded-md text-[var(--owner-muted)] transition-colors hover:bg-[var(--owner-ground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-30"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            data-testid={`service-row-move-down-${service.id}`}
            aria-label={`Move ${service.name} down`}
            disabled={!canMoveDown || reorderBusy}
            onClick={(event) => {
              event.stopPropagation();
              onMoveDown();
            }}
            className="flex size-7 items-center justify-center rounded-md text-[var(--owner-muted)] transition-colors hover:bg-[var(--owner-ground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] disabled:opacity-30"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

        <ChevronRight className="size-4 shrink-0 text-[var(--owner-line-strong)]" />
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
      icon={<Scissors className="mx-auto size-8 text-[var(--owner-muted)]" />}
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
  onSaved: (
    service: ServiceData,
    options?: { imageOperationError?: ServiceImageError },
  ) => void;
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
  const [savePhase, setSavePhase] = useState<ServiceSavePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [imageIntent, setImageIntent] = useState<ServiceImageIntent>('keep');
  const [stagedImageFile, setStagedImageFile] = useState<File | null>(null);
  const [stagedPreviewUrl, setStagedPreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stagedPreviewUrlRef = useRef<string | null>(null);
  const submitInFlightRef = useRef(false);
  const imageEditSessionServiceIdRef = useRef<string | null | undefined>(
    undefined,
  );
  const imageOperationExpectedUrlRef = useRef<string | null>(null);
  const saving = savePhase !== 'idle';

  const clearStagedImage = useCallback(() => {
    if (stagedPreviewUrlRef.current) {
      URL.revokeObjectURL(stagedPreviewUrlRef.current);
      stagedPreviewUrlRef.current = null;
    }
    setStagedImageFile(null);
    setStagedPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    clearStagedImage();
    setImageIntent('keep');
    setImageError(null);

    if (!isOpen) {
      imageEditSessionServiceIdRef.current = undefined;
      imageOperationExpectedUrlRef.current = null;
    } else {
      const sessionServiceId = service?.id ?? null;

      // Keep staged image work bound to the image observed when this editor
      // session opened. A details PATCH may return a newer image written by
      // another tab; that newer URL must not become this request's deletion
      // or replacement target.
      if (
        imageEditSessionServiceIdRef.current === undefined
        || imageEditSessionServiceIdRef.current !== sessionServiceId
      ) {
        imageEditSessionServiceIdRef.current = sessionServiceId;
        imageOperationExpectedUrlRef.current = service?.imageUrl ?? null;
      }
    }

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
      setIsIntroPrice(Boolean(prefill.isIntroPrice));
      setIntroPriceLabel(prefill.introPriceLabel ?? '');
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
      setSavePhase('idle');
      setError(null);
      submitInFlightRef.current = false;
    }
  }, [clearStagedImage, isOpen, service, prefill]);

  useEffect(() => {
    return () => {
      if (stagedPreviewUrlRef.current) {
        URL.revokeObjectURL(stagedPreviewUrlRef.current);
        stagedPreviewUrlRef.current = null;
      }
    };
  }, []);

  const handleImageSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    // Clear the native value so choosing the same file again still fires a
    // change event after validation or removal.
    event.target.value = '';

    if (!file) {
      return;
    }
    let validatedFile: File;
    try {
      validatedFile = validateServiceImageFile(file);
    } catch (validationError) {
      clearStagedImage();
      setImageIntent('keep');
      setImageError(normalizeServiceImageError(validationError).message);
      return;
    }

    clearStagedImage();
    let previewUrl: string;
    try {
      previewUrl = URL.createObjectURL(validatedFile);
    } catch {
      setImageIntent('keep');
      setImageError(new ServiceImageError('IMAGE_PROCESSING_FAILED').message);
      return;
    }

    stagedPreviewUrlRef.current = previewUrl;
    setStagedImageFile(validatedFile);
    setStagedPreviewUrl(previewUrl);
    setImageIntent('replace');
    setImageError(null);
  };

  const handleRemoveImage = () => {
    setImageError(null);
    if (stagedImageFile) {
      clearStagedImage();
      setImageIntent('keep');
      return;
    }
    if (isPublicServiceCustomImageUrl(service?.imageUrl)) {
      setImageIntent('remove');
    }
  };

  const handleUndoImageRemoval = () => {
    setImageIntent('keep');
    setImageError(null);
  };

  const saveReplacementImage = async (
    savedService: ServiceData,
    expectedImageUrl: string | null,
    file: File,
  ): Promise<ServiceData> => {
    if (!salonSlug) {
      throw new ServiceImageError('IMAGE_PERMISSION_DENIED');
    }
    setSavePhase('preparing-image');
    const preparedFile = await prepareServiceImage(file);
    let presignResponse: Response;
    try {
      presignResponse = await fetch(
        `/api/salon/services/${encodeURIComponent(savedService.id)}/image/presign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            contentType: preparedFile.type,
            fileSize: preparedFile.size,
            expectedImageUrl,
          }),
        },
      );
    } catch {
      throw new ServiceImageError('PRESIGN_FAILED');
    }
    const presignResult = await presignResponse.json().catch(() => null);

    if (!presignResponse.ok) {
      throw serviceImageResponseError(
        'presign',
        presignResponse.status,
        presignResult,
      );
    }

    const presign = presignResult?.data as ServiceImagePresignData | undefined;

    if (!presign || (presign.strategy !== 'cloudinary' && presign.strategy !== 'local')) {
      throw new ServiceImageError('PRESIGN_FAILED');
    }

    const imageUrl = `/api/salon/services/${encodeURIComponent(savedService.id)}/image`;

    if (presign.strategy === 'local') {
      setSavePhase('uploading-image');
      const localForm = new FormData();

      localForm.append('file', preparedFile);
      localForm.append('salonSlug', salonSlug);
      localForm.append('expectedImageUrl', expectedImageUrl ?? '');

      let imageResponse: Response;
      try {
        imageResponse = await fetch(imageUrl, {
          method: 'POST',
          body: localForm,
        });
      } catch {
        throw new ServiceImageError('UPLOAD_NETWORK_FAILED');
      }
      const imageResult = await imageResponse.json().catch(() => null);

      if (!imageResponse.ok) {
        throw serviceImageResponseError(
          'finalize',
          imageResponse.status,
          imageResult,
        );
      }
      const updatedService = imageResult?.data?.service as ServiceData | undefined;

      if (!updatedService) {
        throw new ServiceImageError('IMAGE_SERVICE_FAILED');
      }
      return updatedService;
    }

    const {
      uploadUrl,
      apiKey,
      timestamp,
      signature,
      uploadPreset,
      publicId,
      overwrite,
      type: deliveryType,
      tags,
      context,
      finalizeToken,
    } = presign;

    if (
      !uploadUrl
      || !apiKey
      || timestamp == null
      || !signature
      || !uploadPreset
      || !publicId
      || overwrite == null
      || deliveryType !== 'upload'
      || !tags
      || !context
      || !finalizeToken
    ) {
      throw new ServiceImageError('PRESIGN_FAILED');
    }

    setSavePhase('uploading-image');
    const cloudinaryForm = new FormData();

    cloudinaryForm.append('file', preparedFile);
    cloudinaryForm.append('api_key', apiKey);
    cloudinaryForm.append('timestamp', String(timestamp));
    cloudinaryForm.append('signature', signature);
    cloudinaryForm.append('upload_preset', uploadPreset);
    cloudinaryForm.append('public_id', publicId);
    cloudinaryForm.append('overwrite', String(overwrite));
    cloudinaryForm.append('type', deliveryType);
    cloudinaryForm.append('tags', tags);
    cloudinaryForm.append('context', context);

    let uploadResponse: Response;
    try {
      uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: cloudinaryForm,
      });
    } catch {
      throw new ServiceImageError('UPLOAD_NETWORK_FAILED');
    }
    const uploadResult = await uploadResponse.json().catch(() => null);

    if (!uploadResponse.ok) {
      throw new ServiceImageError('PROVIDER_REJECTED_UPLOAD');
    }
    const assetId = uploadResult?.asset_id;
    if (
      typeof assetId !== 'string'
      || !/^[\w-]{8,128}$/.test(assetId)
    ) {
      throw new ServiceImageError('PROVIDER_REJECTED_UPLOAD');
    }

    setSavePhase('finalizing-image');
    let imageResponse: Response;
    try {
      imageResponse = await fetch(imageUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          assetId,
          publicId,
          expectedImageUrl,
          timestamp,
          finalizeToken,
        }),
      });
    } catch {
      throw new ServiceImageError('IMAGE_SERVICE_FAILED');
    }
    const imageResult = await imageResponse.json().catch(() => null);

    if (!imageResponse.ok) {
      throw serviceImageResponseError(
        'finalize',
        imageResponse.status,
        imageResult,
      );
    }
    const updatedService = imageResult?.data?.service as ServiceData | undefined;

    if (!updatedService) {
      throw new ServiceImageError('IMAGE_SERVICE_FAILED');
    }
    return updatedService;
  };

  const removeSavedImage = async (
    savedService: ServiceData,
    expectedImageUrl: string | null,
  ): Promise<ServiceData> => {
    if (!salonSlug) {
      throw new ServiceImageError('IMAGE_PERMISSION_DENIED');
    }
    setSavePhase('removing-image');
    const params = new URLSearchParams({
      salonSlug,
      expectedImageUrl: expectedImageUrl ?? '',
    });
    let response: Response;
    try {
      response = await fetch(
        `/api/salon/services/${encodeURIComponent(savedService.id)}/image?${params.toString()}`,
        { method: 'DELETE' },
      );
    } catch {
      throw new ServiceImageError('IMAGE_SERVICE_FAILED');
    }
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      throw serviceImageResponseError('remove', response.status, result);
    }
    const updatedService = result?.data?.service as ServiceData | undefined;

    if (!updatedService) {
      throw new ServiceImageError('IMAGE_SERVICE_FAILED');
    }
    return updatedService;
  };

  const handleSubmit = async () => {
    if (submitInFlightRef.current) {
      return;
    }
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

    if (imageIntent === 'replace' && !stagedImageFile) {
      setImageError('Choose an image before saving.');
      return;
    }

    submitInFlightRef.current = true;
    setSavePhase('saving-details');
    setError(null);
    setImageError(null);

    let savedService: ServiceData | null = null;
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

      const savedResponse
        = result?.data?.service as ServiceData | undefined;
      if (!savedResponse) {
        throw new Error('Saved service was missing from the response');
      }
      savedService = Object.prototype.hasOwnProperty.call(savedResponse, 'imageUrl')
        ? savedResponse
        : {
            ...savedResponse,
            imageUrl: service?.imageUrl ?? null,
          };
      // The technician count only comes back on CREATE. An edit (PATCH) and
      // the image endpoints do not report it, so carry the count we already
      // knew rather than dropping it — a dropped count would make an ordinary
      // edit look like "not visible in booking" (AG-w2-services-01).
      const carryAssignmentCount = (next: ServiceData): ServiceData => ({
        ...next,
        assignedTechnicianCount:
          next.assignedTechnicianCount
          ?? savedService?.assignedTechnicianCount
          ?? service?.assignedTechnicianCount,
      });
      savedService = carryAssignmentCount(savedService);

      const expectedImageUrl = imageOperationExpectedUrlRef.current;
      let finalService = savedService;

      try {
        if (imageIntent === 'replace' && stagedImageFile) {
          finalService = await saveReplacementImage(
            savedService,
            expectedImageUrl,
            stagedImageFile,
          );
        } else if (imageIntent === 'remove') {
          finalService = await removeSavedImage(savedService, expectedImageUrl);
        }
      } catch (imageOperationError) {
        onSaved(savedService, {
          imageOperationError: normalizeServiceImageError(imageOperationError),
        });
        return;
      }

      onSaved(carryAssignmentCount(finalService));
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to save service',
      );
    } finally {
      submitInFlightRef.current = false;
      setSavePhase('idle');
    }
  };

  const hasPersistedImageValue = Boolean(service?.imageUrl);
  const hasPersistedCustomImage
    = isPublicServiceCustomImageUrl(service?.imageUrl);
  const previewIsCustom
    = Boolean(stagedPreviewUrl)
    || (hasPersistedCustomImage && imageIntent === 'keep');
  const previewImageUrl
    = stagedPreviewUrl
    ?? resolveServiceCardImage({
      imageUrl:
        hasPersistedImageValue && imageIntent === 'keep'
          ? service?.imageUrl
          : null,
      templateKey: service?.templateKey ?? prefill?.templateKey ?? null,
      bookingCategory,
      name,
    });
  const hasCurrentCustomImage
    = Boolean(stagedImageFile)
    || (hasPersistedCustomImage && imageIntent === 'keep');
  const saveStatus = (() => {
    switch (savePhase) {
      case 'saving-details':
        return 'Saving service details…';
      case 'preparing-image':
        return 'Preparing image upload…';
      case 'uploading-image':
        return 'Uploading service image…';
      case 'finalizing-image':
        return 'Finishing service image…';
      case 'removing-image':
        return 'Removing service image…';
      default:
        return '';
    }
  })();

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      maxWidthClassName="max-w-md"
      contentClassName="max-h-[90dvh] overflow-y-auto rounded-3xl bg-[var(--owner-surface)] p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4" aria-busy={saving}>
        <div>
          <h2 className="text-xl font-semibold text-[var(--owner-ink)]">
            {service ? 'Edit Service' : 'Add Service'}
          </h2>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">
            {service
              ? 'Update what clients see and how much calendar time this service reserves.'
              : 'Create a new bookable service for this salon.'}
          </p>
        </div>

        <fieldset
          className="space-y-3 rounded-2xl border border-[var(--owner-line)] p-3"
          disabled={saving}
          aria-describedby={imageError ? 'service-image-error' : 'service-image-help'}
        >
          <legend className="px-1 text-sm font-semibold text-[var(--owner-ink)]">
            Service image
          </legend>
          <div className="overflow-hidden rounded-xl border border-[var(--owner-line)] bg-[var(--owner-ground)]">
            {/* A native img can preview browser blob URLs selected before save. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImageUrl}
              alt={
                previewIsCustom
                  ? `Preview of custom image for ${name.trim() || 'this service'}`
                  : `Built-in booking artwork preview for ${name.trim() || 'this service'}`
              }
              data-testid="service-image-preview"
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
          <p
            id="service-image-help"
            className="text-xs leading-5 text-[var(--owner-muted)]"
          >
            {previewIsCustom
              ? 'Custom image. Replacing or removing it takes effect only when you save.'
              : imageIntent === 'remove'
                ? 'The custom image will be removed when you update. Built-in booking artwork will remain.'
                : 'Built-in booking artwork is shown until you add a custom image.'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={handleImageSelection}
            className="sr-only"
            aria-label="Service image"
            aria-invalid={Boolean(imageError)}
            aria-describedby={imageError ? 'service-image-error' : 'service-image-help'}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="brandSoft"
              size="pillSm"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
            >
              <ImagePlus className="mr-2 size-4" />
              {hasCurrentCustomImage ? 'Replace image' : 'Add image'}
            </Button>
            {imageIntent === 'remove'
              ? (
                  <Button
                    type="button"
                    variant="brandSoft"
                    size="pillSm"
                    onClick={handleUndoImageRemoval}
                    disabled={saving}
                  >
                    Undo removal
                  </Button>
                )
              : (
                  <Button
                    type="button"
                    variant="brandSoft"
                    size="pillSm"
                    onClick={handleRemoveImage}
                    disabled={saving || (!stagedImageFile && !hasPersistedCustomImage)}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Remove image
                  </Button>
                )}
          </div>
          {imageError && (
            <p
              id="service-image-error"
              role="alert"
              className="text-sm text-red-600"
            >
              {imageError}
            </p>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
              Preparation buffer
            </span>
            <input
              type="number"
              min="0"
              max="120"
              step="5"
              inputMode="numeric"
              value={preparationBufferMinutes}
              disabled={saving}
              onChange={event =>
                setPreparationBufferMinutes(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
              Cleanup buffer
            </span>
            <input
              type="number"
              min="0"
              max="120"
              step="5"
              inputMode="numeric"
              value={cleanupBufferMinutes}
              disabled={saving}
              onChange={event => setCleanupBufferMinutes(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
          <p className="col-span-2 text-xs leading-5 text-[var(--owner-muted)]">
            Luster reserves the larger of the salon-wide buffer or these service
            buffers after the client duration, preventing back-to-back overlap.
          </p>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
            Name
          </span>
          <input
            type="text"
            value={name}
            disabled={saving}
            onChange={event => setName(event.target.value)}
            placeholder="BIAB Short"
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
              Price
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              disabled={saving}
              onChange={event => setPrice(event.target.value)}
              placeholder="65"
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
              Duration
            </span>
            <input
              type="number"
              min="5"
              step="5"
              inputMode="numeric"
              value={durationMinutes}
              disabled={saving}
              onChange={event => setDurationMinutes(event.target.value)}
              placeholder="75"
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
            Category
          </span>
          <select
            data-testid="service-category"
            value={category}
            disabled={saving}
            onChange={(event) => {
              const nextCategory = event.target.value as ServiceCategory;
              setCategory(nextCategory);
              if (!bookingCategoryTouched) {
                setBookingCategory(deriveBookingCategory(nextCategory));
              }
            }}
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          >
            <option value="manicure">Manicure</option>
            <option value="builder_gel">Builder Gel</option>
            <option value="extensions">Extensions</option>
            <option value="pedicure">Pedicure</option>
            <option value="combo">Combo</option>
            <option value="hands">Hands</option>
            <option value="feet">Feet</option>
          </select>
          {/* The old copy claimed hands/feet services are hidden from the
              booking page. They are not: public visibility is decided by the
              Booking page section below plus technician assignment, and
              category-'hands' services sit on live menus today
              (AG-w2-services-06). */}
          {['hands', 'feet'].includes(category) && (
            <span
              data-testid="service-category-internal-note"
              className="mt-1.5 block text-xs text-[var(--owner-muted)]"
            >
              Clients never see this label. Choose where they find the service
              under “Booking page section” below.
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
            Booking page section
          </span>
          <select
            data-testid="service-booking-category"
            value={bookingCategory}
            disabled={saving}
            onChange={(event) => {
              setBookingCategory(event.target.value as BookingCategory);
              setBookingCategoryTouched(true);
            }}
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          >
            <option value="manicure">Manicure</option>
            <option value="pedicure">Pedicure</option>
            <option value="combo">Combos</option>
          </select>
          <span className="mt-1.5 block text-xs text-[var(--owner-muted)]">
            Which tab clients find this service under on your booking page.
          </span>
        </label>

        <label className="flex items-center justify-between rounded-xl border border-[var(--owner-line)] p-3">
          <span>
            <span className="block text-sm font-medium text-[var(--owner-ink)]">
              ⭐ Feature this service
            </span>
            <span className="block text-xs text-[var(--owner-muted)]">
              {isFeatured && service?.featuredOrder != null
                ? `Featured — position ${service.featuredOrder}`
                : 'Show it in Featured Services on your booking page.'}
            </span>
          </span>
          <input
            type="checkbox"
            data-testid="service-featured-toggle"
            checked={isFeatured}
            disabled={saving}
            onChange={event => setIsFeatured(event.target.checked)}
            className="size-4"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
            Description items
          </span>
          <textarea
            value={description}
            disabled={saving}
            onChange={event => setDescription(event.target.value)}
            rows={3}
            placeholder={
              'One benefit per line\nDry manicure\nDetailed cuticle work'
            }
            className="w-full rounded-xl border border-[var(--owner-line)] px-3 py-2 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
            Price display text
          </span>
          <input
            type="text"
            value={priceDisplayText}
            disabled={saving}
            onChange={event => setPriceDisplayText(event.target.value)}
            placeholder="$70+"
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>

        <label className="flex items-center justify-between rounded-xl border border-[var(--owner-line)] p-3">
          <span className="text-sm font-medium text-[var(--owner-ink)]">
            Intro pricing badge
          </span>
          <input
            type="checkbox"
            checked={isIntroPrice}
            disabled={saving}
            onChange={event => setIsIntroPrice(event.target.checked)}
            className="size-4"
          />
        </label>

        {service && (
          <label className="flex items-center justify-between rounded-xl border border-[var(--owner-line)] p-3">
            <span>
              <span className="block text-sm font-medium text-[var(--owner-ink)]">
                Bookable
              </span>
              <span className="block text-xs text-[var(--owner-muted)]">
                Turn off to hide this service without deleting history.
              </span>
            </span>
            <input
              type="checkbox"
              checked={isActive}
              disabled={saving}
              onChange={event => setIsActive(event.target.checked)}
              className="size-4"
            />
          </label>
        )}

        {isIntroPrice && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
              Intro label
            </span>
            <input
              type="text"
              value={introPriceLabel}
              disabled={saving}
              onChange={event => setIntroPriceLabel(event.target.value)}
              placeholder="Founding Client Price"
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
        )}

        {error && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        <p
          className="sr-only"
          aria-live="polite"
          data-testid="service-save-status"
        >
          {saveStatus}
        </p>

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
                    {saveStatus || 'Saving…'}
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

// Derived from the template catalog so the promo-card setup flow can never
// drift from the seeded defaults (price/intro badge must stay in sync).
const lusterTemplate = getTemplateByKey(LUSTER_MANICURE_TEMPLATE_KEY);

const LUSTER_PREFILL: ServicePrefill = {
  name: lusterTemplate?.name ?? 'Luster Manicure',
  description: lusterTemplate?.description ?? 'A premium structured manicure using Luster professional products.',
  price: lusterTemplate?.defaultPriceCents ?? 5500,
  durationMinutes: lusterTemplate?.defaultDurationMinutes ?? 60,
  category: 'manicure',
  templateKey: LUSTER_MANICURE_TEMPLATE_KEY,
  isIntroPrice: lusterTemplate?.isIntroPrice ?? true,
  introPriceLabel: lusterTemplate?.introPriceLabel ?? 'Intro price',
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
      className="mx-4 mt-3 rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-[var(--owner-ink)]">
            Offer the Luster Manicure
          </div>
          <p className="mt-1 text-[13px] leading-5 text-[var(--owner-muted)]">
            Add a premium manicure service using your complimentary Luster
            product sample.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          data-testid="luster-promo-dismiss"
          onClick={onDismiss}
          className="shrink-0 text-[13px] font-medium text-[var(--owner-muted)]"
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
  activeTechnicianCount,
  onOpenStaff,
  onBack,
  onEdit,
  onToggleActive,
  toggleActiveBusy,
  toggleActiveError,
}: {
  service: ServiceData;
  activeTechnicianCount: number;
  onOpenStaff?: () => void;
  onBack: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  toggleActiveBusy: boolean;
  toggleActiveError: string | null;
}) {
  return (
    // In flow AFTER the sticky chrome (never an inset-0 overlay): the sticky
    // header/tabs/chips paint above overlays, which hid the detail's first
    // ~chrome-height pixels (hero icon) behind them with no way to scroll
    // them into view. In flow, the detail starts exactly at the chrome's
    // bottom edge at every width and the sheet scroller owns all scrolling.
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      data-testid="service-detail-root"
      className="flex flex-1 flex-col bg-[var(--owner-ground)]"
    >
      <ModalHeader
        title={service.name}
        leftAction={<BackButton onClick={onBack} label="Services" />}
        rightAction={(
          <button
            type="button"
            onClick={onEdit}
            className="text-[17px] font-medium text-[var(--owner-accent)]"
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
              data-testid="service-detail-hero-icon"
              className={`size-20 rounded-[20px] ${CATEGORY_PLACEHOLDER_CLASS} mb-4 flex items-center justify-center shadow-lg`}
            >
              <Scissors className="size-10 text-white" />
            </div>
            <h2 className="text-center text-[22px] font-semibold text-[var(--owner-ink)]">
              {service.name}
            </h2>
            <div className="mt-3 flex items-center gap-4">
              <span className="rounded-full bg-[var(--owner-ground)] px-3 py-1 text-[13px] text-[var(--owner-muted)]">
                {BOOKING_CATEGORY_META[resolveVisibleBookingCategory(service)].label}
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
                    <span className="rounded-full bg-[var(--owner-ground)] px-3 py-1 text-[13px] text-[var(--owner-muted)]">
                      Inactive
                    </span>
                  )}
            </div>
          </div>
        </AdminDetailCard>

        {/* Truthful public-visibility explanation */}
        {isHiddenFromBooking(service) && (
          <AdminDetailCard className="mb-4">
            <div
              data-testid="service-detail-visibility-warning"
              className="text-[14px] leading-relaxed text-amber-700"
            >
              {activeTechnicianCount === 0
                ? 'Not visible in booking — add a technician before this service can be booked.'
                : 'Not visible in booking — assign at least one technician (Team → technician → Services).'}
              {activeTechnicianCount > 0 && onOpenStaff && (
                <button
                  type="button"
                  className="mt-2 block font-semibold underline"
                  onClick={onOpenStaff}
                  data-testid="service-detail-open-staff"
                >
                  Open Team services
                </button>
              )}
            </div>
          </AdminDetailCard>
        )}

        {/* Price & Duration */}
        <div className="mb-4 grid grid-cols-2 gap-4">
          <AdminDetailCard>
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[var(--owner-muted)]">
              <DollarSign className="size-4" />
              Price
            </div>
            {/* The amount clients are actually charged is the headline; the
                marketing string is shown as well, never instead of it
                (AG-w2-services-03). `break-words` keeps a long display string
                inside the card at 390 px. */}
            <div
              data-testid="service-detail-price"
              className="mt-1 text-[32px] font-bold leading-tight text-emerald-700"
            >
              {formatCurrency(service.price)}
            </div>
            {service.priceDisplayText && (
              <div
                data-testid="service-detail-price-display"
                className="mt-1 break-words text-[13px] leading-5 text-[var(--owner-muted)]"
              >
                Shown to clients as “
                {service.priceDisplayText}
                ”
              </div>
            )}
          </AdminDetailCard>
          <AdminDetailCard>
            <div className="flex items-center gap-2 text-[13px] font-medium uppercase text-[var(--owner-muted)]">
              <Clock className="size-4" />
              Duration
            </div>
            <div className="mt-1 text-[32px] font-bold text-[var(--owner-ink)]">
              {formatDuration(service.durationMinutes)}
            </div>
          </AdminDetailCard>
        </div>

        {(service.preparationBufferMinutes > 0
          || service.cleanupBufferMinutes > 0) && (
          <AdminDetailCard className="mb-4">
            <div className="text-[13px] font-medium uppercase text-[var(--owner-muted)]">
              Reserved setup time
            </div>
            <p className="mt-1 text-[15px] text-[var(--owner-ink)]">
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
            <div className="mb-2 text-[13px] font-medium uppercase text-[var(--owner-muted)]">
              Description
            </div>
            {service.descriptionItems && service.descriptionItems.length > 0
              ? (
                  <ul className="space-y-2 text-[15px] leading-relaxed text-[var(--owner-ink)]">
                    {service.descriptionItems.map(item => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 text-[var(--owner-muted)]">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )
              : (
                  <p className="text-[15px] leading-relaxed text-[var(--owner-ink)]">
                    {service.description}
                  </p>
                )}
          </AdminDetailCard>
        )}

        {/* Owner actions */}
        <div className="mt-4 space-y-2">
          <Button
            type="button"
            variant="brand"
            size="pill"
            className="w-full"
            data-testid="service-detail-edit"
            onClick={onEdit}
          >
            Edit Service
          </Button>
          <Button
            type="button"
            variant="brandSoft"
            size="pill"
            className={`w-full ${service.isActive ? 'text-red-600' : 'text-emerald-700'}`}
            data-testid="service-detail-toggle-active"
            disabled={toggleActiveBusy}
            onClick={onToggleActive}
          >
            {toggleActiveBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
            {service.isActive ? 'Deactivate Service' : 'Reactivate Service'}
          </Button>
          {toggleActiveError && (
            <div
              data-testid="service-detail-toggle-error"
              className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
            >
              {toggleActiveError}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Owner add-on editor: name, description, price, duration, quantity cap,
 * which base services it is offered under, and bookable state. Pricing type
 * stays read-only (it is a template-level decision).
 */
function AddOnEditDialog({
  addOn,
  salonSlug,
  services,
  onClose,
  onSaved,
}: {
  addOn: AddOnData | null;
  salonSlug: string | null;
  services: ServiceData[];
  onClose: () => void;
  onSaved: (addOn: AddOnData) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [maxQuantity, setMaxQuantity] = useState('');
  const [priceDisplayText, setPriceDisplayText] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (addOn) {
      setName(addOn.name);
      setDescription((addOn.descriptionItems ?? []).join('\n'));
      setPrice(String(addOn.priceCents / 100));
      setDurationMinutes(String(addOn.durationMinutes));
      setMaxQuantity(addOn.maxQuantity != null ? String(addOn.maxQuantity) : '');
      setPriceDisplayText(addOn.priceDisplayText || '');
      setIsActive(addOn.isActive);
      setServiceIds(addOn.compatibleServiceIds ?? []);
      setSaving(false);
      setError(null);
    }
  }, [addOn]);

  if (!addOn) {
    return null;
  }

  const handleSubmit = async () => {
    if (!salonSlug) {
      setError('Select a salon before editing add-ons.');
      return;
    }
    const parsedPrice = Number.parseFloat(price);
    const parsedDuration = Number.parseInt(durationMinutes, 10);
    const parsedMaxQuantity = maxQuantity.trim() === '' ? null : Number.parseInt(maxQuantity, 10);
    if (!name.trim()) {
      setError('Add-on name is required.');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError('Enter a valid price.');
      return;
    }
    if (!Number.isInteger(parsedDuration) || parsedDuration < 0) {
      setError('Enter a valid duration in minutes.');
      return;
    }
    if (parsedMaxQuantity !== null && (!Number.isInteger(parsedMaxQuantity) || parsedMaxQuantity < 1)) {
      setError('Quantity limit must be at least 1, or left empty.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/salon/add-ons/${encodeURIComponent(addOn.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          name: name.trim(),
          descriptionItems: description
            .split('\n')
            .map(item => item.trim())
            .filter(Boolean),
          priceCents: Math.round(parsedPrice * 100),
          priceDisplayText: priceDisplayText.trim() || null,
          durationMinutes: parsedDuration,
          maxQuantity: parsedMaxQuantity,
          isActive,
          serviceIds,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Failed to save add-on');
      }
      const saved = result?.data?.addOn as AddOnData | undefined;
      if (!saved) {
        throw new Error('Saved add-on was missing from the response');
      }
      onSaved(saved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save add-on');
      setSaving(false);
    }
  };

  return (
    <DialogShell
      isOpen
      onClose={onClose}
      maxWidthClassName="max-w-md"
      contentClassName="max-h-[90dvh] overflow-y-auto rounded-3xl bg-[var(--owner-surface)] p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--owner-ink)]">Edit Add-on</h2>
          <p className="mt-1 text-sm text-[var(--owner-muted)]">
            Add-ons appear for clients after they pick a compatible base
            service — they are never listed on their own.
          </p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Name</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Description</span>
          <textarea
            value={description}
            rows={2}
            data-testid="addon-edit-description"
            onChange={event => setDescription(event.target.value)}
            placeholder="What the client gets — one line per point."
            className="w-full rounded-xl border border-[var(--owner-line)] p-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={event => setPrice(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Duration (min)</span>
            <input
              type="number"
              min="0"
              step="5"
              inputMode="numeric"
              value={durationMinutes}
              onChange={event => setDurationMinutes(event.target.value)}
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">Price display text</span>
          <input
            type="text"
            value={priceDisplayText}
            onChange={event => setPriceDisplayText(event.target.value)}
            placeholder="$10+"
            className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
          />
        </label>
        {addOn.pricingType === 'per_unit' && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
              Quantity limit
              {addOn.unitLabel ? ` (per ${addOn.unitLabel})` : ''}
            </span>
            <input
              type="number"
              min="1"
              inputMode="numeric"
              value={maxQuantity}
              onChange={event => setMaxQuantity(event.target.value)}
              placeholder="10"
              className="h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-sm outline-none transition focus:border-[var(--owner-accent)]"
            />
          </label>
        )}
        <div data-testid="addon-edit-compatibility">
          <span className="mb-1.5 block text-sm font-medium text-[var(--owner-ink)]">
            Offered with
          </span>
          <p className="mb-2 text-xs text-[var(--owner-muted)]">
            Clients see this add-on only after choosing one of these services.
          </p>
          {services.length === 0
            ? (
                <p className="rounded-xl border border-[var(--owner-line)] p-3 text-xs text-[var(--owner-muted)]">
                  Add a service first, then choose where this add-on appears.
                </p>
              )
            : (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-[var(--owner-line)] p-2">
                  {services.map(service => (
                    <label
                      key={service.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-[13px] text-[var(--owner-ink)]">
                        {service.name}
                        {!service.isActive && (
                          <span className="ml-1 text-[11px] text-[var(--owner-muted)]">(inactive)</span>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        data-testid={`addon-edit-service-${service.id}`}
                        checked={serviceIds.includes(service.id)}
                        onChange={(event) => {
                          setServiceIds(current => (event.target.checked
                            ? [...current, service.id]
                            : current.filter(id => id !== service.id)));
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
        </div>
        <label className="flex items-center justify-between rounded-xl border border-[var(--owner-line)] p-3">
          <span>
            <span className="block text-sm font-medium text-[var(--owner-ink)]">Bookable</span>
            <span className="block text-xs text-[var(--owner-muted)]">
              Turn off to hide this add-on without deleting history.
            </span>
          </span>
          <input
            type="checkbox"
            checked={isActive}
            onChange={event => setIsActive(event.target.checked)}
            className="size-4"
          />
        </label>
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
              : (
                  'Update Add-on'
                )}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

export function ServicesModal({ onClose, salonSlug, onOpenStaff }: ServicesModalProps) {
  const [services, setServices] = useState<ServiceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [menuQuery, setMenuQuery] = useState('');
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
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
  const [showServiceImages, setShowServiceImages] = useState<boolean | null>(null);
  const [showServiceImagesSaving, setShowServiceImagesSaving] = useState(false);
  const [showServiceImagesError, setShowServiceImagesError] = useState<string | null>(null);
  const [menuDisplay, setMenuDisplay] = useState<{
    introPriceDefaultLabel: string;
    firstVisitDiscountEnabled: boolean;
    featureLusterManicure: boolean;
  } | null>(null);
  const [menuDisplayPatch, setMenuDisplayPatch] = useState<Partial<{
    introPriceDefaultLabel: string;
    firstVisitDiscountEnabled: boolean;
    featureLusterManicure: boolean;
  }>>({});
  const [menuDisplayLoadState, setMenuDisplayLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [menuDisplayError, setMenuDisplayError] = useState<string | null>(null);
  const [menuDisplaySaving, setMenuDisplaySaving] = useState(false);
  const [menuDisplaySaved, setMenuDisplaySaved] = useState(false);
  const showServiceImagesSaveInFlight = useRef(false);
  const showServiceImagesSaveAbort = useRef<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<'menu' | 'library' | 'addons' | 'catalog'>('menu');
  /**
   * Tab-switch scroll memory (w2-services "scroll position on tab switch",
   * recorded NOT TESTED in the audit).
   *
   * All four tabs render into one scroller — `AppModal`'s
   * `app-modal-scroll-region` — so switching tabs used to leave the owner
   * wherever the *previous* tab had been scrolled to: leaving My Menu 900 px
   * down dropped them into the middle of the Library. Each tab now keeps its
   * own offset: a tab opened for the first time starts at the top, and coming
   * back to My Menu returns to the row the owner left.
   */
  const servicesRootRef = useRef<HTMLDivElement>(null);
  const tabScrollOffsets = useRef<Partial<Record<typeof activeTab, number>>>({});
  const renderedTabRef = useRef(activeTab);
  const cancelTabScrollRestore = useRef<(() => void) | null>(null);
  const [ownedTemplateKeys, setOwnedTemplateKeys] = useState<Set<string>>(new Set());
  const [bulkAddBusy, setBulkAddBusy] = useState(false);
  const [toggleActiveBusy, setToggleActiveBusy] = useState(false);
  const [toggleActiveError, setToggleActiveError] = useState<string | null>(null);
  const [activeTechnicianCount, setActiveTechnicianCount] = useState(0);
  const [addOns, setAddOns] = useState<AddOnData[]>([]);
  const [addOnsLoading, setAddOnsLoading] = useState(true);
  const [addOnsError, setAddOnsError] = useState<string | null>(null);
  const [editingAddOn, setEditingAddOn] = useState<AddOnData | null>(null);
  const [showAddOnCreate, setShowAddOnCreate] = useState(false);
  const [addOnNotice, setAddOnNotice] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<{
    tone: 'warning' | 'error';
    message: string;
    assignmentRequired: boolean;
  } | null>(null);

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
          sortOrder?: number | null;
          isActive: boolean;
          isIntroPrice?: boolean | null;
          introPriceLabel?: string | null;
          assignedTechnicianCount?: number;
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
          sortOrder: service.sortOrder ?? null,
          isActive: service.isActive,
          isIntroPrice: service.isIntroPrice ?? false,
          introPriceLabel: service.introPriceLabel ?? null,
          assignedTechnicianCount: service.assignedTechnicianCount,
        }),
      );

      setActiveTechnicianCount(result.data?.activeTechnicianCount ?? 0);
      setServices(transformedServices);
    } catch (err) {
      console.error('Failed to fetch services:', err);
      setError('Failed to load services');
    } finally {
      setLoading(false);
    }
  }, [salonSlug]);

  /**
   * A failed load must never look like an empty menu. Swallowing the response
   * here is what hid a 401 behind "No add-ons yet" while the salon's add-ons
   * sat untouched in the database.
   */
  const fetchAddOns = useCallback(async () => {
    if (!salonSlug) {
      setAddOns([]);
      setAddOnsLoading(false);
      return;
    }
    try {
      setAddOnsLoading(true);
      setAddOnsError(null);
      const response = await fetch(`/api/salon/add-ons?salonSlug=${encodeURIComponent(salonSlug)}`);
      if (!response.ok) {
        throw new Error(`Failed to load add-ons (${response.status})`);
      }
      const result = await response.json();
      setAddOns((result.data?.addOns ?? []).map((addOn: AddOnData & { isActive: boolean | null }) => ({
        ...addOn,
        isActive: addOn.isActive ?? true,
      })));
    } catch (addOnError) {
      console.error('Failed to fetch add-ons:', addOnError);
      setAddOnsError(
        addOnError instanceof Error ? addOnError.message : 'Failed to load add-ons',
      );
    } finally {
      setAddOnsLoading(false);
    }
  }, [salonSlug]);

  useEffect(() => {
    fetchServices();
    void fetchAddOns();
  }, [fetchServices, fetchAddOns]);

  // Load the shared merchandising settings used throughout the owner UI.
  useEffect(() => {
    showServiceImagesSaveAbort.current?.abort();
    showServiceImagesSaveAbort.current = null;
    showServiceImagesSaveInFlight.current = false;
    setShowServiceImagesSaving(false);
    setShowServiceImagesError(null);

    if (!salonSlug) {
      setShowServiceImages(true);
      setMenuDisplay(null);
      setMenuDisplayLoadState('error');
      setMenuDisplayError('Menu settings are unavailable until a salon is selected.');
      return;
    }
    setShowServiceImages(null);
    setMenuDisplay(null);
    setMenuDisplayPatch({});
    setMenuDisplayLoadState('loading');
    setMenuDisplayError(null);
    let cancelled = false;
    const loadMerchandising = async () => {
      try {
        const response = await fetch(
          `/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        );
        if (!response.ok) {
          if (!cancelled) {
            setShowServiceImages(true);
            setMenuDisplayLoadState('error');
            setMenuDisplayError('Menu display settings could not be loaded. Reload to try again.');
          }
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
          setShowServiceImages(
            result?.merchandising?.showServiceImages !== false,
          );
          const introPriceDefaultLabel = result?.bookingConfig?.introPriceDefaultLabel;
          const firstVisitDiscountEnabled = result?.bookingConfig?.firstVisitDiscountEnabled;
          const featureLusterManicure = result?.merchandising?.featureLusterManicure;
          if (
            (typeof introPriceDefaultLabel === 'string' || introPriceDefaultLabel === null)
            && typeof firstVisitDiscountEnabled === 'boolean'
            && typeof featureLusterManicure === 'boolean'
          ) {
            setMenuDisplay({
              introPriceDefaultLabel: introPriceDefaultLabel ?? '',
              firstVisitDiscountEnabled,
              featureLusterManicure,
            });
            setMenuDisplayPatch({});
            setMenuDisplayLoadState('ready');
          } else {
            setMenuDisplayLoadState('error');
            setMenuDisplayError('Menu display settings could not be loaded. Reload to try again.');
          }
        }
      } catch {
        // Visibility follows the existing fail-open behavior if settings
        // cannot be loaded. Promo cards still stay hidden until known.
        if (!cancelled) {
          setShowServiceImages(true);
          setMenuDisplayLoadState('error');
          setMenuDisplayError('Menu display settings could not be loaded. Reload to try again.');
        }
      }
    };
    void loadMerchandising();
    return () => {
      cancelled = true;
      showServiceImagesSaveAbort.current?.abort();
      showServiceImagesSaveAbort.current = null;
      showServiceImagesSaveInFlight.current = false;
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

  const handleShowServiceImagesChange = useCallback(async () => {
    if (
      !salonSlug
      || showServiceImages === null
      || showServiceImagesSaveInFlight.current
    ) {
      return;
    }

    const nextValue = !showServiceImages;
    showServiceImagesSaveInFlight.current = true;
    setShowServiceImagesSaving(true);
    setShowServiceImagesError(null);
    const controller = new AbortController();
    showServiceImagesSaveAbort.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(
        `/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            merchandising: { showServiceImages: nextValue },
          }),
        },
      );
      const result = await response.json().catch(() => null);
      const authoritativeValue = result?.merchandising?.showServiceImages;

      if (!response.ok || typeof authoritativeValue !== 'boolean') {
        throw new Error('Service-image visibility was not saved');
      }

      if (showServiceImagesSaveAbort.current === controller) {
        setShowServiceImages(authoritativeValue);
      }
    } catch {
      if (showServiceImagesSaveAbort.current === controller) {
        setShowServiceImagesError(
          'Service image visibility could not be saved. Try again.',
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (showServiceImagesSaveAbort.current === controller) {
        showServiceImagesSaveAbort.current = null;
        showServiceImagesSaveInFlight.current = false;
        setShowServiceImagesSaving(false);
      }
    }
  }, [salonSlug, showServiceImages]);

  const saveMenuDisplay = useCallback(async () => {
    const changedFields = Object.keys(menuDisplayPatch);
    if (!salonSlug || !menuDisplay || menuDisplayLoadState !== 'ready' || changedFields.length === 0 || menuDisplaySaving) {
      return;
    }
    setMenuDisplaySaving(true);
    setMenuDisplaySaved(false);
    setMenuDisplayError(null);
    try {
      const bookingConfig: {
        introPriceDefaultLabel?: string | null;
        firstVisitDiscountEnabled?: boolean;
      } = {};
      const merchandising: { featureLusterManicure?: boolean } = {};
      if (Object.prototype.hasOwnProperty.call(menuDisplayPatch, 'introPriceDefaultLabel')) {
        bookingConfig.introPriceDefaultLabel = menuDisplayPatch.introPriceDefaultLabel?.trim() || null;
      }
      if (typeof menuDisplayPatch.firstVisitDiscountEnabled === 'boolean') {
        bookingConfig.firstVisitDiscountEnabled = menuDisplayPatch.firstVisitDiscountEnabled;
      }
      if (typeof menuDisplayPatch.featureLusterManicure === 'boolean') {
        merchandising.featureLusterManicure = menuDisplayPatch.featureLusterManicure;
      }
      const response = await fetch(`/api/admin/salon/settings?salonSlug=${encodeURIComponent(salonSlug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(Object.keys(bookingConfig).length > 0 ? { bookingConfig } : {}),
          ...(Object.keys(merchandising).length > 0 ? { merchandising } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error('Could not save menu display settings.');
      }
      setMenuDisplayPatch({});
      setMenuDisplaySaved(true);
    } catch (saveError) {
      setMenuDisplayError(saveError instanceof Error ? saveError.message : 'Could not save menu display settings.');
    } finally {
      setMenuDisplaySaving(false);
    }
  }, [menuDisplay, menuDisplayLoadState, menuDisplayPatch, menuDisplaySaving, salonSlug]);

  // One-tap Deactivate/Reactivate from the detail view: same PATCH contract as
  // the edit dialog, with every field unchanged except isActive.
  const handleToggleActive = useCallback(async () => {
    if (!salonSlug || !selectedService || toggleActiveBusy) {
      return;
    }
    const service = selectedService;
    if (service.isActive && !window.confirm(`Deactivate "${service.name}"? Clients won't be able to book it; nothing is deleted.`)) {
      return;
    }

    setToggleActiveBusy(true);
    setToggleActiveError(null);
    try {
      const response = await fetch(
        `/api/salon/services/${encodeURIComponent(service.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            name: service.name,
            description: service.description,
            descriptionItems: service.descriptionItems ?? [],
            price: service.price,
            priceDisplayText: service.priceDisplayText,
            durationMinutes: service.durationMinutes,
            preparationBufferMinutes: service.preparationBufferMinutes,
            cleanupBufferMinutes: service.cleanupBufferMinutes,
            category: service.category,
            bookingCategory: service.bookingCategory,
            featuredOrder: service.featuredOrder ?? null,
            isIntroPrice: Boolean(service.isIntroPrice),
            introPriceLabel: service.introPriceLabel ?? null,
            isActive: !service.isActive,
          }),
        },
      );
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error?.message ?? 'Failed to update service');
      }
      const updatedService = result?.data?.service as ServiceData | undefined;
      if (!updatedService) {
        throw new Error('Updated service was missing from the response');
      }
      // PATCH does not report technician assignment; keep the count we already
      // had so a deactivate/reactivate never invents a visibility warning
      // (AG-w2-services-01).
      const mergedService: ServiceData = {
        ...service,
        ...updatedService,
        assignedTechnicianCount:
          updatedService.assignedTechnicianCount ?? service.assignedTechnicianCount,
      };
      setSelectedService(mergedService);
      // Keep the list (and the counts/pills it feeds) in step immediately
      // rather than only after the refetch lands (AG-w2-services-04).
      setServices(current =>
        current.map(item => (item.id === mergedService.id ? mergedService : item)),
      );
      void fetchServices();
    } catch (toggleError) {
      setToggleActiveError(
        toggleError instanceof Error
          ? toggleError.message
          : 'Failed to update service',
      );
    } finally {
      setToggleActiveBusy(false);
    }
  }, [salonSlug, selectedService, toggleActiveBusy, fetchServices]);

  /**
   * Menu reordering (AG-services-03). Optimistic: the list moves under the
   * owner's thumb immediately and the whole order is persisted in one
   * request; a refusal puts the previous order back and says so, rather than
   * leaving the screen disagreeing with the database.
   */
  const handleReorder = useCallback(
    async (serviceId: string, direction: 'up' | 'down', visibleIds: string[]) => {
      if (!salonSlug || reorderBusy) {
        return;
      }
      const previousOrder = services;
      const nextIds = moveServiceOrder(
        previousOrder.map(service => service.id),
        visibleIds,
        serviceId,
        direction,
      );
      if (!nextIds) {
        return;
      }
      const byId = new Map(previousOrder.map(service => [service.id, service]));
      const nextOrder = nextIds
        .map(id => byId.get(id))
        .filter((service): service is ServiceData => Boolean(service));

      setReorderBusy(true);
      setReorderError(null);
      setServices(nextOrder);
      try {
        const response = await fetch('/api/salon/services', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug, orderedIds: nextIds }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(
            result?.error?.message ?? 'The new menu order could not be saved.',
          );
        }
      } catch (error) {
        setServices(previousOrder);
        setReorderError(
          error instanceof Error
            ? error.message
            : 'The new menu order could not be saved.',
        );
      } finally {
        setReorderBusy(false);
      }
    },
    [salonSlug, services, reorderBusy],
  );

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
      const result = await response.json().catch(() => null);
      if (response.ok) {
        setOwnedTemplateKeys(current => new Set([...current, template.systemKey]));
        void fetchServices();
        // The new add-on must show up in the Add-ons tab straight away.
        void fetchAddOns();
        const data = result?.data;
        setOperationNotice(data?.assignmentRequired || data?.noActiveTechnicianWarning
          ? {
              tone: 'warning',
              assignmentRequired: Boolean(data.assignmentRequired),
              message: data.noActiveTechnicianWarning
                ? 'This add-on was added, but services will not appear in booking until a technician is added and assigned.'
                : 'The add-on was added. Any new services still need technician assignment before booking.',
            }
          : null);
      } else {
        setOperationNotice({ tone: 'error', assignmentRequired: false, message: result?.error?.message ?? 'Unable to add this add-on.' });
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
      isIntroPrice: template.isIntroPrice ?? false,
      introPriceLabel: template.introPriceLabel ?? null,
    });
    setShowAddDialog(true);
  }, [salonSlug, fetchServices, fetchAddOns]);

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
      const result = await response.json().catch(() => null);
      if (response.ok) {
        setOwnedTemplateKeys(current => new Set([...current, ...templateKeys]));
        void fetchServices();
        // A bulk add seeds add-ons too — refresh both lists, not just services.
        void fetchAddOns();
        const data = result?.data;
        setOperationNotice(data?.assignmentRequired || data?.noActiveTechnicianWarning || data?.assignmentFailures?.length
          ? {
              tone: data.assignmentFailures?.length ? 'error' : 'warning',
              assignmentRequired: Boolean(data.assignmentRequired),
              message: data.assignmentFailures?.length
                ? 'Some services were added but technician assignment was incomplete.'
                : data.noActiveTechnicianWarning
                  ? 'These services were added, but they will not appear in booking until a technician is added and assigned.'
                  : 'These services were added, but choose who can perform them before they appear in booking.',
            }
          : null);
      } else {
        setOperationNotice({ tone: 'error', assignmentRequired: false, message: result?.error?.message ?? 'Unable to add the selected templates.' });
      }
    } finally {
      setBulkAddBusy(false);
    }
  }, [salonSlug, fetchServices, fetchAddOns]);

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

  // Filter services by category, then by the owner's search text.
  const filteredServices = services.filter((service) => {
    const matchesCategory
      = activeCategory === 'all'
      || resolveVisibleBookingCategory(service) === activeCategory;

    return matchesCategory && matchesServiceQuery(service, menuQuery);
  });
  const filteredServiceIds = filteredServices.map(service => service.id);
  const hasMenuQuery = menuQuery.trim().length > 0;

  // Count per visible category (base services + combos only — add-ons are a
  // separate record type and never inflate these counts).
  const categoryCounts: Record<string, number> = {};
  for (const service of services) {
    const visibleCategory = resolveVisibleBookingCategory(service);
    categoryCounts[visibleCategory] = (categoryCounts[visibleCategory] || 0) + 1;
  }

  const getTabScroller = useCallback(
    () =>
      servicesRootRef.current?.closest<HTMLElement>(
        '[data-testid="app-modal-scroll-region"]',
      ) ?? null,
    [],
  );

  /**
   * Switch tabs, remembering where the owner was in the tab they are leaving.
   * Recording on the click rather than on every scroll event keeps the offset
   * honest: our own restore writes to the same scroller, and a tab that is
   * still laying out reports a clamped `scrollTop` we must not save.
   */
  const selectTab = useCallback(
    (next: typeof activeTab) => {
      const scroller = getTabScroller();
      if (scroller) {
        tabScrollOffsets.current[renderedTabRef.current] = scroller.scrollTop;
      }
      setActiveTab(next);
    },
    [getTabScroller],
  );

  useLayoutEffect(() => {
    // React runs a layout effect twice on mount in development (StrictMode),
    // so the restore must NOT live in the effect's cleanup: the second invoke
    // would cancel the restore the first one just started. The in-flight
    // animation frame lives in a ref instead and is cancelled only by the next
    // tab switch, by owner input, or on unmount.
    if (renderedTabRef.current === activeTab) {
      return;
    }
    renderedTabRef.current = activeTab;
    const scroller = getTabScroller();
    if (!scroller) {
      return;
    }
    cancelTabScrollRestore.current?.();

    const target = tabScrollOffsets.current[activeTab] ?? 0;
    scroller.scrollTop = target;
    if (target === 0 || scroller.scrollTop === target) {
      return;
    }

    // The incoming tab is still loading its rows, so the assignment above was
    // clamped to the height that exists right now. Keep re-applying until the
    // content is tall enough — or until the owner touches the scroller, whose
    // input always wins over a restore.
    const deadline = Date.now() + 1_200;
    let handle = 0;
    const stop = () => {
      cancelAnimationFrame(handle);
      for (const type of INTERRUPT_EVENTS) {
        scroller.removeEventListener(type, stop);
      }
      cancelTabScrollRestore.current = null;
    };
    const reapply = () => {
      scroller.scrollTop = target;
      if (scroller.scrollTop < target && Date.now() < deadline) {
        handle = requestAnimationFrame(reapply);
        return;
      }
      stop();
    };
    for (const type of INTERRUPT_EVENTS) {
      scroller.addEventListener(type, stop, { passive: true });
    }
    handle = requestAnimationFrame(reapply);
    cancelTabScrollRestore.current = stop;
  }, [activeTab, getTabScroller]);

  useEffect(() => () => cancelTabScrollRestore.current?.(), []);

  return (
    <div ref={servicesRootRef} className="relative flex min-h-full w-full flex-col bg-[var(--owner-ground)] font-sans text-[var(--owner-ink)]">
      {/* Header */}
      <div data-testid="services-sticky-chrome" className="sticky top-0 z-20 bg-[var(--owner-ground)] backdrop-blur-md">
        <ModalHeader
          title="Services"
          subtitle={`${services.length} services · ${
            addOnsError ? 'add-ons unavailable' : `${addOns.length} add-ons`
          }`}
          leftAction={<BackButton onClick={onClose} label="Back" />}
          rightAction={(
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              disabled={!salonSlug}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-[17px] font-medium text-[var(--owner-accent)] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] active:opacity-50 disabled:text-[var(--owner-muted)] disabled:opacity-60"
            >
              Add
            </button>
          )}
        />
        <div className="px-4 pb-2">
          <div className="grid grid-cols-4 gap-1 rounded-full bg-[var(--owner-blush)] p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'menu'}
              data-testid="services-tab-menu"
              onClick={() => selectTab('menu')}
              className={`min-h-11 rounded-full px-2 text-[13px] font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${
                activeTab === 'menu' ? 'bg-[var(--owner-surface)] text-[var(--owner-accent)] shadow-sm' : 'text-[var(--owner-muted)]'
              }`}
            >
              My Menu
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'addons'}
              data-testid="services-tab-addons"
              onClick={() => selectTab('addons')}
              className={`min-h-11 rounded-full px-2 text-[13px] font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${
                activeTab === 'addons' ? 'bg-[var(--owner-surface)] text-[var(--owner-accent)] shadow-sm' : 'text-[var(--owner-muted)]'
              }`}
            >
              Add-ons
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'library'}
              data-testid="services-tab-library"
              onClick={() => selectTab('library')}
              className={`min-h-11 rounded-full px-2 text-[13px] font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${
                activeTab === 'library' ? 'bg-[var(--owner-surface)] text-[var(--owner-accent)] shadow-sm' : 'text-[var(--owner-muted)]'
              }`}
            >
              Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'catalog'}
              data-testid="services-tab-catalog"
              onClick={() => selectTab('catalog')}
              className={`min-h-11 rounded-full px-2 text-[13px] font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${
                activeTab === 'catalog' ? 'bg-[var(--owner-surface)] text-[var(--owner-accent)] shadow-sm' : 'text-[var(--owner-muted)]'
              }`}
            >
              Menu Setup
            </button>
          </div>
        </div>
        <div
          data-testid="service-images-visibility-row"
          className="mx-4 mb-2 flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3 py-2"
        >
          <div className="min-w-0">
            <p
              id="service-images-visibility-label"
              className="text-[14px] font-semibold leading-5 text-[var(--owner-ink)]"
            >
              Service images
            </p>
            <p
              id="service-images-visibility-description"
              className="text-[12px] leading-4 text-[var(--owner-muted)]"
            >
              {showServiceImages === false
                ? 'Images are hidden from clients. Your uploaded images are saved.'
                : 'Show images on your public booking page.'}
            </p>
            {showServiceImagesError && (
              <p
                role="alert"
                data-testid="service-images-visibility-error"
                className="mt-1 text-[12px] leading-4 text-red-700"
              >
                {showServiceImagesError}
              </p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showServiceImages ?? true}
            aria-busy={showServiceImagesSaving}
            aria-labelledby="service-images-visibility-label"
            aria-describedby="service-images-visibility-description"
            disabled={showServiceImages === null || showServiceImagesSaving || !salonSlug}
            data-testid="services-show-service-images-toggle"
            onClick={() => void handleShowServiceImagesChange()}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
              showServiceImages !== false ? 'bg-[var(--owner-accent)]' : 'bg-gray-300'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute left-1 top-1 size-5 rounded-full bg-[var(--owner-surface)] shadow-sm transition-transform ${
                showServiceImages !== false ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
            <span className="sr-only">
              Toggle service images
            </span>
          </button>
          <span className="sr-only" role="status" aria-live="polite">
            {showServiceImagesSaving ? 'Saving service image visibility' : ''}
          </span>
        </div>
        {activeTab === 'menu' && (
          <details className="mx-4 mb-2 rounded-xl border border-[var(--owner-line)] bg-[var(--owner-surface)] px-3 py-2">
            <summary className="flex min-h-11 cursor-pointer items-center text-[14px] font-semibold text-[var(--owner-ink)]">Menu display &amp; offers</summary>
            <div className="space-y-3 border-t border-[var(--owner-line)] py-3">
              {menuDisplayLoadState === 'loading' ? <p className="text-[13px] text-[var(--owner-muted)]" role="status">Loading saved menu settings…</p> : null}
              {menuDisplayError ? <p className="text-[13px] text-red-700" role="alert">{menuDisplayError}</p> : null}
              <label className="block text-[13px] font-medium text-[var(--owner-ink)]">
                Default intro label
                <input
                  type="text"
                  value={menuDisplay?.introPriceDefaultLabel ?? ''}
                  disabled={menuDisplayLoadState !== 'ready' || menuDisplaySaving}
                  onChange={(event) => {
                    const value = event.target.value;
                    setMenuDisplay(current => current ? { ...current, introPriceDefaultLabel: value } : current);
                    setMenuDisplayPatch(current => ({ ...current, introPriceDefaultLabel: value }));
                    setMenuDisplaySaved(false);
                  }}
                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--owner-line)] px-3 text-[15px]"
                  placeholder="Founding Client Price"
                />
              </label>
              <label className="flex min-h-11 items-center justify-between gap-3 text-[13px]">
                <span>
                  <span className="block font-medium">First-visit offer</span>
                  <span className="text-[12px] text-[var(--owner-muted)]">25% off for first-time clients</span>
                </span>
                <input
                  type="checkbox"
                  checked={menuDisplay?.firstVisitDiscountEnabled ?? false}
                  disabled={menuDisplayLoadState !== 'ready' || menuDisplaySaving}
                  onChange={(event) => {
                    const value = event.target.checked;
                    setMenuDisplay(current => current ? { ...current, firstVisitDiscountEnabled: value } : current);
                    setMenuDisplayPatch(current => ({ ...current, firstVisitDiscountEnabled: value }));
                    setMenuDisplaySaved(false);
                  }}
                  className="size-5 accent-[var(--owner-accent)]"
                />
              </label>
              <label className="flex min-h-11 items-center justify-between gap-3 text-[13px]">
                <span>
                  <span className="block font-medium">Feature Luster Manicure</span>
                  <span className="text-[12px] text-[var(--owner-muted)]">Show the active Luster Manicure first</span>
                </span>
                <input
                  type="checkbox"
                  checked={menuDisplay?.featureLusterManicure ?? false}
                  disabled={menuDisplayLoadState !== 'ready' || menuDisplaySaving}
                  onChange={(event) => {
                    const value = event.target.checked;
                    setMenuDisplay(current => current ? { ...current, featureLusterManicure: value } : current);
                    setMenuDisplayPatch(current => ({ ...current, featureLusterManicure: value }));
                    setMenuDisplaySaved(false);
                  }}
                  className="size-5 accent-[var(--owner-accent)]"
                />
              </label>
              <div className="flex items-center justify-end gap-3">
                {menuDisplaySaved ? <span className="text-[12px] font-medium text-emerald-700">Saved</span> : null}
                <button type="button" onClick={() => void saveMenuDisplay()} disabled={menuDisplayLoadState !== 'ready' || Object.keys(menuDisplayPatch).length === 0 || menuDisplaySaving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--owner-accent)] px-4 text-[13px] font-semibold text-white disabled:opacity-50">
                  <Save aria-hidden="true" className="size-4" />
                  {menuDisplaySaving ? 'Saving…' : 'Save menu display'}
                </button>
              </div>
            </div>
          </details>
        )}
        {activeTab === 'menu' && (
          <>
            {/* Owner search (AG-services-01). The client's copy of this menu and
                the Library tab both have one; the owner's did not. */}
            <div className="px-4 pb-2">
              <label htmlFor="services-menu-search" className="sr-only">
                Search your services
              </label>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--owner-muted)]"
                />
                <input
                  id="services-menu-search"
                  type="search"
                  value={menuQuery}
                  onChange={event => setMenuQuery(event.target.value)}
                  placeholder="Search services…"
                  data-testid="services-menu-search"
                  className="h-10 w-full rounded-full border border-[var(--owner-line)] bg-[var(--owner-surface)] pl-9 pr-3 text-[15px] text-[var(--owner-ink)] outline-none transition placeholder:text-[var(--owner-muted)] focus:border-[var(--owner-accent)]"
                />
              </div>
            </div>
            <CategoryTabs
              active={activeCategory}
              onChange={setActiveCategory}
              counts={categoryCounts}
            />
          </>
        )}
      </div>

      {reorderError && (
        <div
          role="alert"
          data-testid="services-reorder-error"
          className="mx-4 mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-[13px] leading-relaxed text-red-800"
        >
          {reorderError}
        </div>
      )}

      {operationNotice && (
        <div
          role="alert"
          data-testid="service-operation-notice"
          className={`mx-4 mt-3 rounded-2xl border p-3 text-[13px] leading-relaxed ${operationNotice.tone === 'error'
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'}`}
        >
          <p>{operationNotice.message}</p>
          {operationNotice.assignmentRequired && onOpenStaff && (
            <button
              type="button"
              className="mt-2 font-semibold underline"
              onClick={onOpenStaff}
              data-testid="service-operation-open-staff"
            >
              Open Team services
            </button>
          )}
        </div>
      )}

      {/* Content — display:none while a detail is open so the detail owns the
          flow slot below the sticky chrome (list state stays mounted). */}
      <div className={`flex-1 overflow-y-auto pb-10 ${selectedService ? 'hidden' : ''}`}>
        {activeTab === 'addons' && (
          <div className="px-4 pb-4" data-testid="addons-tab-panel">
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-[13px] leading-relaxed text-[var(--owner-muted)]">
                Add-ons appear for clients after they pick a compatible base
                service — they are never listed as standalone services.
              </p>
              <Button
                type="button"
                variant="ownerPrimary"
                size="pillSm"
                className="shrink-0"
                data-testid="addons-create-open"
                disabled={!salonSlug}
                onClick={() => {
                  setAddOnNotice(null);
                  setShowAddOnCreate(true);
                }}
              >
                New add-on
              </Button>
            </div>
            {addOnNotice && (
              <InlineFeedback
                tone="success"
                className="mb-3"
                message={addOnNotice}
                data-testid="addons-create-notice"
                onDismiss={() => setAddOnNotice(null)}
              />
            )}
            {addOnsLoading
              ? (
                  <AsyncStatePanel
                    loading
                    title="Loading add-ons"
                    description="Fetching the extras clients can add to a service."
                  />
                )
              : addOnsError
                ? (
                    <div data-testid="addons-load-error">
                      <AsyncStatePanel
                        tone="error"
                        title="Unable to load add-ons"
                        description={addOnsError}
                        action={(
                          <Button
                            type="button"
                            variant="brandSoft"
                            size="pillSm"
                            onClick={() => void fetchAddOns()}
                          >
                            Try again
                          </Button>
                        )}
                      />
                    </div>
                  )
                : addOns.length === 0
                  ? (
                      <div
                        data-testid="addons-empty"
                        className="rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 text-[14px] text-[var(--owner-muted)]"
                      >
                        <p>
                          No add-ons yet. Create your own, or add one from the
                          Service Library.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="ownerPrimary"
                            size="pillSm"
                            data-testid="addons-empty-create"
                            disabled={!salonSlug}
                            onClick={() => {
                              setAddOnNotice(null);
                              setShowAddOnCreate(true);
                            }}
                          >
                            Create add-on
                          </Button>
                          <Button
                            type="button"
                            variant="ownerSecondary"
                            size="pillSm"
                            data-testid="addons-empty-library"
                            onClick={() => selectTab('library')}
                          >
                            Browse Library
                          </Button>
                        </div>
                      </div>
                    )
                  : (
                      <div className="overflow-hidden rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)]">
                        {addOns.map((addOn, index) => (
                          <button
                            key={addOn.id}
                            type="button"
                            data-testid={`addon-row-${addOn.id}`}
                            onClick={() => setEditingAddOn(addOn)}
                            className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors active:bg-[var(--owner-ground)] ${
                              index < addOns.length - 1 ? 'border-b border-[var(--owner-line)]' : ''
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-semibold text-[var(--owner-ink)]">
                                {addOn.name}
                              </span>
                              {/* Same meta line the Service Library uses, so the
                                  two lists read as one system. */}
                              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--owner-muted)]">
                                <span>{addOn.priceDisplayText || formatCurrency(addOn.priceCents)}</span>
                                <span>·</span>
                                <span>{formatDuration(addOn.durationMinutes)}</span>
                                <span className="rounded-full bg-[var(--owner-ground)] px-2 py-0.5 text-[11px]">
                                  Add-on
                                </span>
                                <span className="rounded-full bg-[var(--owner-ground)] px-2 py-0.5 text-[11px] text-[var(--owner-muted)]">
                                  {ADD_ON_CATEGORY_LABELS[addOn.category] ?? addOn.category}
                                </span>
                                {addOn.pricingType === 'per_unit' && (
                                  <span className="rounded-full bg-[var(--owner-ground)] px-2 py-0.5">
                                    per
                                    {' '}
                                    {addOn.unitLabel ?? 'unit'}
                                  </span>
                                )}
                                {!addOn.isActive && (
                                  <span
                                    data-testid={`addon-row-inactive-${addOn.id}`}
                                    className="rounded-full bg-gray-200 px-2 py-0.5 text-[var(--owner-muted)]"
                                  >
                                    Inactive
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-[var(--owner-muted)]">
                                {addOn.compatibleServiceIds?.length
                                  ? `Offered with ${addOn.compatibleServiceIds.length} ${addOn.compatibleServiceIds.length === 1 ? 'service' : 'services'}`
                                  : 'Not offered with any service yet'}
                              </span>
                            </span>
                            <span className="ml-3 flex shrink-0 items-center gap-2">
                              <span className="text-[13px] font-medium text-[var(--owner-accent)]">Edit</span>
                              <ChevronRight className="size-4 text-[var(--owner-line-strong)]" />
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
          </div>
        )}
        {activeTab === 'library' && (
          <ServiceLibraryTab
            ownedTemplateKeys={ownedTemplateKeys}
            bulkAddBusy={bulkAddBusy}
            menuServiceCount={services.length}
            menuAddOnCount={addOns.length}
            onAddTemplate={handleAddTemplate}
            onBulkAdd={handleBulkAdd}
            onCreateCustom={() => {
              setAddDialogPrefill(null);
              setShowAddDialog(true);
            }}
            onDone={() => selectTab('menu')}
          />
        )}
        {activeTab === 'catalog' && (
          <CatalogConfigTab salonSlug={salonSlug} />
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
              ? hasMenuQuery
                ? (
                    <AsyncStatePanel
                      icon={<Search className="mx-auto size-8 text-[var(--owner-muted)]" />}
                      title="No matching services"
                      description={`Nothing on your menu matches “${menuQuery.trim()}”.`}
                      className="mx-4 my-8"
                      action={(
                        <Button
                          type="button"
                          variant="brandSoft"
                          size="pillSm"
                          data-testid="services-menu-search-clear"
                          onClick={() => setMenuQuery('')}
                        >
                          Clear search
                        </Button>
                      )}
                    />
                  )
                : (
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
                        showNotBookable={isHiddenFromBooking(service)}
                        canMoveUp={index > 0}
                        canMoveDown={index < filteredServices.length - 1}
                        reorderBusy={reorderBusy}
                        onMoveUp={() => void handleReorder(service.id, 'up', filteredServiceIds)}
                        onMoveDown={() => void handleReorder(service.id, 'down', filteredServiceIds)}
                        onClick={() => {
                          setSelectedService(service);
                          setToggleActiveError(null);
                        }}
                      />
                    ))}
                  </ListSurface>
                ))}
        {/* Promotional nudges sit BELOW the menu (AG-services-05): stacked above
            it they filled the whole first screen of a 390x844 phone, so the
            screen called "My Menu" opened on no menu at all. They are also
            hidden while a search is active — a filtered list is a question
            being answered, not a place to advertise. */}
        {activeTab === 'menu' && !hasMenuQuery && !loading && !error && libraryIntroDismissed === false && (
          <div
            data-testid="library-intro-card"
            className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[18px] border border-[var(--owner-line)] bg-[var(--owner-surface)] p-4 shadow-sm"
          >
            <div>
              <div className="text-[15px] font-semibold text-[var(--owner-ink)]">
                Explore the new Service Library
              </div>
              <p className="mt-0.5 text-[13px] text-[var(--owner-muted)]">
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
                className="text-[13px] font-medium text-[var(--owner-muted)]"
              >
                Not now
              </button>
              <Button
                type="button"
                variant="brand"
                size="pillSm"
                data-testid="library-intro-open"
                onClick={() => selectTab('library')}
              >
                Open
              </Button>
            </div>
          </div>
        )}
        {activeTab === 'menu' && !hasMenuQuery && showLusterPromo && (
          <LusterPromoCard
            onSetUp={() => {
              setAddDialogPrefill(LUSTER_PREFILL);
              setShowAddDialog(true);
            }}
            onDismiss={() => void dismissLusterPromo()}
          />
        )}
      </div>

      {/* Service Detail — in flow below the sticky chrome */}
      {selectedService && (
        <ServiceDetail
          service={selectedService}
          activeTechnicianCount={activeTechnicianCount}
          onOpenStaff={onOpenStaff}
          onBack={() => {
            setSelectedService(null);
            setToggleActiveError(null);
          }}
          onEdit={() => setEditingService(selectedService)}
          onToggleActive={() => void handleToggleActive()}
          toggleActiveBusy={toggleActiveBusy}
          toggleActiveError={toggleActiveError}
        />
      )}

      <AddOnCreateDialog
        isOpen={showAddOnCreate}
        salonSlug={salonSlug}
        services={services.map(service => ({
          id: service.id,
          name: service.name,
          isActive: service.isActive,
        }))}
        onClose={() => setShowAddOnCreate(false)}
        onCreated={(created) => {
          setShowAddOnCreate(false);
          setAddOnNotice(`“${created.name}” is on your add-on list.`);
          void fetchAddOns();
        }}
      />

      <AddOnEditDialog
        addOn={editingAddOn}
        salonSlug={salonSlug}
        services={services}
        onClose={() => setEditingAddOn(null)}
        onSaved={() => {
          setEditingAddOn(null);
          void fetchAddOns();
        }}
      />

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
        onSaved={(savedService, options) => {
          setShowAddDialog(false);
          setEditingService(null);
          setAddDialogPrefill(null);
          setSelectedService(savedService);
          selectTab('menu');
          // The header count and the category chips read from `services`.
          // Waiting for the refetch left them saying "8 services" on the very
          // screen the owner uses to confirm the save landed
          // (AG-w2-services-04), so merge the saved record straight in — the
          // refetch below still reconciles anything the server changed.
          setServices((current) => {
            const index = current.findIndex(item => item.id === savedService.id);
            if (index < 0) {
              return [...current, savedService];
            }
            const next = current.slice();
            next[index] = { ...current[index], ...savedService };
            return next;
          });
          // Only move the chips when the saved service would otherwise be
          // filtered out of view — and then to a category that actually exists
          // on the chip row (the storage category does not).
          setActiveCategory((current) => {
            const visibleCategory = resolveVisibleBookingCategory(savedService);
            return current === 'all' || current === visibleCategory
              ? current
              : visibleCategory;
          });
          setMenuQuery('');
          if (options?.imageOperationError) {
            setOperationNotice({
              tone: 'warning',
              assignmentRequired: false,
              message: serviceImagePartialSuccessMessage(
                options.imageOperationError,
              ),
            });
          } else {
            setOperationNotice(null);
          }
          void fetchServices();
          void fetchOwnedTemplateKeys();
        }}
      />
    </div>
  );
}

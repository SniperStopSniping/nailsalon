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
  ChevronRight,
  Clock,
  DollarSign,
  ImagePlus,
  Loader2,
  Scissors,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminDetailCard } from '@/components/admin/AdminDetailCard';
import { AsyncStatePanel } from '@/components/ui/async-state-panel';
import { Button } from '@/components/ui/button';
import { DialogShell } from '@/components/ui/dialog-shell';
import { ListSurface } from '@/components/ui/list-surface';
import { BOOKING_CATEGORY_META, deriveBookingCategory, resolveVisibleBookingCategory } from '@/libs/bookingCategory';
import { LUSTER_MANICURE_TEMPLATE_KEY } from '@/libs/bookingMerchandising';
import { formatMoney } from '@/libs/formatMoney';
import {
  isPublicServiceCustomImageUrl,
  resolveServiceCardImage,
} from '@/libs/serviceImage';
import { getTemplateByKey, type ServiceTemplate } from '@/libs/serviceTemplateCatalog';
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
  /** Enabled links to ACTIVE technicians; 0 ⇒ hidden from public booking. */
  assignedTechnicianCount?: number;
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
  finalizeToken?: string;
  cloudName?: string;
};

const SERVICE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const SERVICE_IMAGE_ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const SERVICE_IMAGE_PARTIAL_SUCCESS_MESSAGE
  = 'Service details were saved, but the image could not be updated. Open Edit Service to try the image again.';

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

/**
 * Add-on category labels. The library's TEMPLATE_TYPE_LABELS is keyed by
 * ServiceTemplateCategory, which is a different vocabulary — these are the
 * four values of the add_on_category enum.
 */
const ADD_ON_CATEGORY_LABELS: Record<string, string> = {
  nail_art: 'Nail art',
  repair: 'Repair',
  removal: 'Removal',
  pedicure_addon: 'Pedicure add-on',
};

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
  showNotBookable,
  onClick,
}: {
  service: ServiceData;
  isLast: boolean;
  /** Active service with no eligible technician — hidden from booking. */
  showNotBookable: boolean;
  onClick: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      data-testid={`service-row-${service.id}`}
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
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[12px]">
              {BOOKING_CATEGORY_META[resolveVisibleBookingCategory(service)].label}
            </span>
            {!service.isActive && (
              <span
                data-testid={`service-row-inactive-${service.id}`}
                className="rounded-full bg-gray-200 px-2 py-0.5 text-[12px] text-gray-600"
              >
                Inactive
              </span>
            )}
            {showNotBookable && (
              <span
                data-testid={`service-row-not-bookable-${service.id}`}
                className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] text-amber-700"
              >
                Not bookable
              </span>
            )}
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
  onSaved: (
    service: ServiceData,
    options?: { imageOperationFailed?: boolean },
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
    if (!SERVICE_IMAGE_ALLOWED_TYPES.has(file.type)) {
      clearStagedImage();
      setImageIntent('keep');
      setImageError('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size <= 0) {
      clearStagedImage();
      setImageIntent('keep');
      setImageError('Choose a non-empty image.');
      return;
    }
    if (file.size > SERVICE_IMAGE_MAX_BYTES) {
      clearStagedImage();
      setImageIntent('keep');
      setImageError('Image must be 5 MB or smaller.');
      return;
    }

    clearStagedImage();
    const previewUrl = URL.createObjectURL(file);

    stagedPreviewUrlRef.current = previewUrl;
    setStagedImageFile(file);
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
      throw new Error('Select a salon before updating a service image.');
    }
    setSavePhase('preparing-image');
    const presignResponse = await fetch(
      `/api/salon/services/${encodeURIComponent(savedService.id)}/image/presign`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          contentType: file.type,
          fileSize: file.size,
          expectedImageUrl,
        }),
      },
    );
    const presignResult = await presignResponse.json().catch(() => null);

    if (!presignResponse.ok) {
      throw new Error(
        presignResult?.error?.message ?? 'Failed to prepare the service image',
      );
    }

    const presign = presignResult?.data as ServiceImagePresignData | undefined;

    if (!presign || (presign.strategy !== 'cloudinary' && presign.strategy !== 'local')) {
      throw new Error('Image upload preparation was missing from the response');
    }

    const imageUrl = `/api/salon/services/${encodeURIComponent(savedService.id)}/image`;

    if (presign.strategy === 'local') {
      setSavePhase('uploading-image');
      const localForm = new FormData();

      localForm.append('file', file);
      localForm.append('salonSlug', salonSlug);
      localForm.append('expectedImageUrl', expectedImageUrl ?? '');

      const imageResponse = await fetch(imageUrl, {
        method: 'POST',
        body: localForm,
      });
      const imageResult = await imageResponse.json().catch(() => null);

      if (!imageResponse.ok) {
        throw new Error(
          imageResult?.error?.message ?? 'Failed to update the service image',
        );
      }
      const updatedService = imageResult?.data?.service as ServiceData | undefined;

      if (!updatedService) {
        throw new Error('Updated service was missing from the image response');
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
      || !finalizeToken
    ) {
      throw new Error('Cloud image upload parameters were incomplete');
    }

    setSavePhase('uploading-image');
    const cloudinaryForm = new FormData();

    cloudinaryForm.append('file', file);
    cloudinaryForm.append('api_key', apiKey);
    cloudinaryForm.append('timestamp', String(timestamp));
    cloudinaryForm.append('signature', signature);
    cloudinaryForm.append('upload_preset', uploadPreset);
    cloudinaryForm.append('public_id', publicId);
    cloudinaryForm.append('overwrite', String(overwrite));

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: cloudinaryForm,
    });
    const uploadResult = await uploadResponse.json().catch(() => null);

    if (!uploadResponse.ok) {
      throw new Error(
        uploadResult?.error?.message ?? 'Failed to upload the service image',
      );
    }

    setSavePhase('finalizing-image');
    const imageResponse = await fetch(imageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        salonSlug,
        publicId,
        expectedImageUrl,
        timestamp,
        finalizeToken,
      }),
    });
    const imageResult = await imageResponse.json().catch(() => null);

    if (!imageResponse.ok) {
      throw new Error(
        imageResult?.error?.message ?? 'Failed to update the service image',
      );
    }
    const updatedService = imageResult?.data?.service as ServiceData | undefined;

    if (!updatedService) {
      throw new Error('Updated service was missing from the image response');
    }
    return updatedService;
  };

  const removeSavedImage = async (
    savedService: ServiceData,
    expectedImageUrl: string | null,
  ): Promise<ServiceData> => {
    if (!salonSlug) {
      throw new Error('Select a salon before removing a service image.');
    }
    setSavePhase('removing-image');
    const params = new URLSearchParams({
      salonSlug,
      expectedImageUrl: expectedImageUrl ?? '',
    });
    const response = await fetch(
      `/api/salon/services/${encodeURIComponent(savedService.id)}/image?${params.toString()}`,
      { method: 'DELETE' },
    );
    const result = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        result?.error?.message ?? 'Failed to remove the service image',
      );
    }
    const updatedService = result?.data?.service as ServiceData | undefined;

    if (!updatedService) {
      throw new Error('Updated service was missing from the image response');
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
      } catch {
        onSaved(savedService, { imageOperationFailed: true });
        return;
      }

      onSaved(finalService);
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
      contentClassName="max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4" aria-busy={saving}>
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

        <fieldset
          className="space-y-3 rounded-2xl border border-gray-200 p-3"
          disabled={saving}
          aria-describedby={imageError ? 'service-image-error' : 'service-image-help'}
        >
          <legend className="px-1 text-sm font-semibold text-[#1C1C1E]">
            Service image
          </legend>
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
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
            className="text-xs leading-5 text-[#6B7280]"
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
            accept="image/jpeg,image/png,image/webp"
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
              disabled={saving}
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
              disabled={saving}
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
            disabled={saving}
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
              disabled={saving}
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
              disabled={saving}
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
            disabled={saving}
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
            disabled={saving}
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
            disabled={saving}
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
            disabled={saving}
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
            disabled={saving}
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
            disabled={saving}
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
              disabled={saving}
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
              disabled={saving}
              onChange={event => setIntroPriceLabel(event.target.value)}
              placeholder="Founding Client Price"
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
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
      className="flex flex-1 flex-col bg-[#FFF8F5]"
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
              data-testid="service-detail-hero-icon"
              className={`size-20 rounded-[20px] bg-gradient-to-br ${getCategoryGradient(service.category)} mb-4 flex items-center justify-center shadow-lg`}
            >
              <Scissors className="size-10 text-white" />
            </div>
            <h2 className="text-center text-[22px] font-semibold text-[#1C1C1E]">
              {service.name}
            </h2>
            <div className="mt-3 flex items-center gap-4">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[13px] text-[#8E8E93]">
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
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-[13px] text-gray-500">
                      Inactive
                    </span>
                  )}
            </div>
          </div>
        </AdminDetailCard>

        {/* Truthful public-visibility explanation */}
        {service.isActive && (service.assignedTechnicianCount ?? 1) === 0 && (
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
      contentClassName="max-h-[90dvh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
      alignClassName="items-end justify-center p-4 sm:items-center"
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-[#1C1C1E]">Edit Add-on</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Add-ons appear for clients after they pick a compatible base
            service — they are never listed on their own.
          </p>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Name</span>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Description</span>
          <textarea
            value={description}
            rows={2}
            data-testid="addon-edit-description"
            onChange={event => setDescription(event.target.value)}
            placeholder="What the client gets — one line per point."
            className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none transition focus:border-rose-700"
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
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Duration (min)</span>
            <input
              type="number"
              min="0"
              step="5"
              inputMode="numeric"
              value={durationMinutes}
              onChange={event => setDurationMinutes(event.target.value)}
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">Price display text</span>
          <input
            type="text"
            value={priceDisplayText}
            onChange={event => setPriceDisplayText(event.target.value)}
            placeholder="$10+"
            className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
          />
        </label>
        {addOn.pricingType === 'per_unit' && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
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
              className="h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none transition focus:border-rose-700"
            />
          </label>
        )}
        <div data-testid="addon-edit-compatibility">
          <span className="mb-1.5 block text-sm font-medium text-[#1C1C1E]">
            Offered with
          </span>
          <p className="mb-2 text-xs text-[#6B7280]">
            Clients see this add-on only after choosing one of these services.
          </p>
          {services.length === 0
            ? (
                <p className="rounded-xl border border-gray-200 p-3 text-xs text-[#8E8E93]">
                  Add a service first, then choose where this add-on appears.
                </p>
              )
            : (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-2">
                  {services.map(service => (
                    <label
                      key={service.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-[13px] text-[#1C1C1E]">
                        {service.name}
                        {!service.isActive && (
                          <span className="ml-1 text-[11px] text-[#8E8E93]">(inactive)</span>
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
        <label className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span>
            <span className="block text-sm font-medium text-[#1C1C1E]">Bookable</span>
            <span className="block text-xs text-[#6B7280]">
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
  const [activeTab, setActiveTab] = useState<'menu' | 'library' | 'addons'>('menu');
  const [ownedTemplateKeys, setOwnedTemplateKeys] = useState<Set<string>>(new Set());
  const [bulkAddBusy, setBulkAddBusy] = useState(false);
  const [toggleActiveBusy, setToggleActiveBusy] = useState(false);
  const [toggleActiveError, setToggleActiveError] = useState<string | null>(null);
  const [activeTechnicianCount, setActiveTechnicianCount] = useState(0);
  const [addOns, setAddOns] = useState<AddOnData[]>([]);
  const [addOnsLoading, setAddOnsLoading] = useState(true);
  const [addOnsError, setAddOnsError] = useState<string | null>(null);
  const [editingAddOn, setEditingAddOn] = useState<AddOnData | null>(null);
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
      setSelectedService(updatedService);
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

  // Filter services by category
  const filteredServices
    = activeCategory === 'all'
      ? services
      : services.filter(s => resolveVisibleBookingCategory(s) === activeCategory);

  // Count per visible category (base services + combos only — add-ons are a
  // separate record type and never inflate these counts).
  const categoryCounts: Record<string, number> = {};
  for (const service of services) {
    const visibleCategory = resolveVisibleBookingCategory(service);
    categoryCounts[visibleCategory] = (categoryCounts[visibleCategory] || 0) + 1;
  }

  return (
    <div className="relative flex min-h-full w-full flex-col bg-[#FFF8F5] font-sans text-black">
      {/* Header */}
      <div data-testid="services-sticky-chrome" className="sticky top-0 z-20 bg-[#FFF8F5]/90 backdrop-blur-md">
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
              className="text-[17px] font-medium text-rose-800 transition-opacity active:opacity-50 disabled:text-[#8E8E93] disabled:opacity-60"
            >
              Add
            </button>
          )}
        />
        <div className="px-4 pb-2">
          <div className="grid grid-cols-3 gap-1 rounded-full bg-gray-100 p-1" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'menu'}
              data-testid="services-tab-menu"
              onClick={() => setActiveTab('menu')}
              className={`rounded-full px-3 py-2 text-[14px] font-semibold transition-all ${
                activeTab === 'menu' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
              }`}
            >
              My Menu
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'addons'}
              data-testid="services-tab-addons"
              onClick={() => setActiveTab('addons')}
              className={`rounded-full px-3 py-2 text-[14px] font-semibold transition-all ${
                activeTab === 'addons' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
              }`}
            >
              Add-ons
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'library'}
              data-testid="services-tab-library"
              onClick={() => setActiveTab('library')}
              className={`rounded-full px-3 py-2 text-[14px] font-semibold transition-all ${
                activeTab === 'library' ? 'bg-white text-[#1C1C1E] shadow-sm' : 'text-[#8E8E93]'
              }`}
            >
              Library
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
            <p className="mb-3 text-[13px] leading-relaxed text-[#6B7280]">
              Add-ons appear for clients after they pick a compatible base
              service — they are never listed as standalone services.
            </p>
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
                      <div className="rounded-[18px] border border-gray-200 bg-white p-4 text-[14px] text-[#8E8E93]">
                        No add-ons yet. Add them from the Library tab.
                      </div>
                    )
                  : (
                      <div className="overflow-hidden rounded-[18px] border border-gray-100 bg-white">
                        {addOns.map((addOn, index) => (
                          <button
                            key={addOn.id}
                            type="button"
                            data-testid={`addon-row-${addOn.id}`}
                            onClick={() => setEditingAddOn(addOn)}
                            className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors active:bg-gray-50 ${
                              index < addOns.length - 1 ? 'border-b border-gray-100' : ''
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-semibold text-[#1C1C1E]">
                                {addOn.name}
                              </span>
                              {/* Same meta line the Service Library uses, so the
                                  two lists read as one system. */}
                              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-[#8E8E93]">
                                <span>{addOn.priceDisplayText || formatCurrency(addOn.priceCents)}</span>
                                <span>·</span>
                                <span>{formatDuration(addOn.durationMinutes)}</span>
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px]">
                                  Add-on
                                </span>
                                <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-[#8E8E93]">
                                  {ADD_ON_CATEGORY_LABELS[addOn.category] ?? addOn.category}
                                </span>
                                {addOn.pricingType === 'per_unit' && (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5">
                                    per
                                    {' '}
                                    {addOn.unitLabel ?? 'unit'}
                                  </span>
                                )}
                                {!addOn.isActive && (
                                  <span
                                    data-testid={`addon-row-inactive-${addOn.id}`}
                                    className="rounded-full bg-gray-200 px-2 py-0.5 text-gray-600"
                                  >
                                    Inactive
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block truncate text-[12px] text-[#8E8E93]">
                                {addOn.compatibleServiceIds?.length
                                  ? `Offered with ${addOn.compatibleServiceIds.length} ${addOn.compatibleServiceIds.length === 1 ? 'service' : 'services'}`
                                  : 'Not offered with any service yet'}
                              </span>
                            </span>
                            <span className="ml-3 flex shrink-0 items-center gap-2">
                              <span className="text-[13px] font-medium text-rose-800">Edit</span>
                              <ChevronRight className="size-4 text-[#C7C7CC]" />
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
                        showNotBookable={service.isActive
                        && (service.assignedTechnicianCount ?? 1) === 0}
                        onClick={() => {
                          setSelectedService(service);
                          setToggleActiveError(null);
                        }}
                      />
                    ))}
                  </ListSurface>
                ))}
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
          setActiveTab('menu');
          setActiveCategory(savedService.category);
          if (options?.imageOperationFailed) {
            setOperationNotice({
              tone: 'warning',
              assignmentRequired: false,
              message: SERVICE_IMAGE_PARTIAL_SUCCESS_MESSAGE,
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

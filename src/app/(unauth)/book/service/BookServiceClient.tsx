'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BookingStepHeader } from '@/components/booking/BookingStepHeader';
import { ServiceCardImage } from '@/components/booking/ServiceCardImage';
import { TechnicianAvatar } from '@/components/booking/TechnicianAvatar';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StateCard } from '@/components/ui/state-card';
import { useBookingState } from '@/hooks/useBookingState';
import { BOOKING_CATEGORY_META } from '@/libs/bookingCategory';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep } from '@/libs/bookingFlow';
import { getFeaturedServices } from '@/libs/bookingMerchandising';
import { buildBookingUrl, parseSelectedAddOnsParam, type SelectedAddOnParam } from '@/libs/bookingParams';
import { triggerHaptic } from '@/libs/haptics';
import {
  getPublicTechnicianCompatibility,
  type PublicTechnicianPreview,
  technicianSupportsPublicLocation,
} from '@/libs/publicTechnicianCompatibility';
import { getPublicTechnicianRatingDisplay } from '@/libs/technicianRating';
import { BOOKING_CATEGORIES, type BookingCategory } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';
import { formatDuration } from '@/utils/Helpers';

type ServiceCategory =
  | 'manicure'
  | 'builder_gel'
  | 'extensions'
  | 'pedicure'
  | 'hands'
  | 'feet'
  | 'combo';

type AddOnCategory = 'nail_art' | 'repair' | 'removal' | 'pedicure_addon';
type AddOnPricingType = 'fixed' | 'per_unit';
type SelectionMode = 'optional' | 'required' | 'conditional';

export type ServiceData = {
  id: string;
  name: string;
  description: string | null;
  descriptionItems: string[];
  durationMinutes: number;
  priceCents: number;
  priceDisplayText: string | null;
  category: ServiceCategory;
  bookingCategory: BookingCategory;
  templateKey: string | null;
  featuredOrder: number | null;
  imageUrl: string;
  resolvedIntroPriceLabel: string | null;
  sortOrder?: number | null;
};

export type AddOnData = {
  id: string;
  name: string;
  descriptionItems: string[];
  category: AddOnCategory;
  pricingType: AddOnPricingType;
  unitLabel: string | null;
  maxQuantity: number | null;
  durationMinutes: number;
  priceCents: number;
  priceDisplayText: string | null;
  isActive: boolean;
};

export type ServiceAddOnRule = {
  id: string;
  serviceId: string;
  addOnId: string;
  selectionMode: SelectionMode;
  defaultQuantity: number | null;
  maxQuantityOverride: number | null;
  displayOrder: number;
};

export type LocationData = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  isPrimary: boolean;
};

type TechnicianPreviewData = PublicTechnicianPreview;

type BookServiceClientProps = {
  services: ServiceData[];
  addOns?: AddOnData[];
  serviceAddOnRules?: ServiceAddOnRule[];
  bookingFlow: BookingStep[];
  locations: LocationData[];
  technicians?: TechnicianPreviewData[];
  currency?: string;
  showNewClientPromo?: boolean;
  lusterFeaturingEnabled?: boolean;
};

// Height reserved for the fixed CTA bar. The in-page spacer and the tenant
// footer clearance var must stay byte-identical, or the last card / footer
// links end up underneath the bar on short viewports.
const STICKY_FOOTER_CLEARANCE = 'calc(4.75rem + env(safe-area-inset-bottom, 0px) + var(--ios-chrome-viewport-bottom, 0px))';

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function buildServiceRows(services: ServiceData[]): ServiceData[][] {
  const rows: ServiceData[][] = [];
  let currentRow: ServiceData[] = [];

  for (const service of services) {
    if (service.bookingCategory === 'combo') {
      if (currentRow.length > 0) {
        rows.push(currentRow);
        currentRow = [];
      }
      rows.push([service]);
      continue;
    }

    currentRow.push(service);
    if (currentRow.length === 2) {
      rows.push(currentRow);
      currentRow = [];
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  return rows;
}

function buildDefaultSelectedAddOns(
  serviceId: string | null,
  rules: ServiceAddOnRule[],
  addOns: AddOnData[],
  current: SelectedAddOnParam[],
): SelectedAddOnParam[] {
  if (!serviceId) {
    return [];
  }

  const relevantRules = rules
    .filter(rule => rule.serviceId === serviceId)
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const addOnsById = new Map(addOns.map(addOn => [addOn.id, addOn]));
  const currentById = new Map(current.map(item => [item.addOnId, item.quantity ?? 1]));
  const normalized: SelectedAddOnParam[] = [];

  for (const rule of relevantRules) {
    const addOn = addOnsById.get(rule.addOnId);
    if (!addOn || !addOn.isActive) {
      continue;
    }

    const existingQuantity = currentById.get(rule.addOnId);
    const rawQuantity = existingQuantity ?? rule.defaultQuantity ?? (rule.selectionMode === 'required' ? 1 : 0);
    const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;
    const normalizedQuantity = Math.min(
      maxQuantity,
      Math.max(addOn.pricingType === 'per_unit' ? 1 : 1, rawQuantity),
    );

    if (existingQuantity !== undefined || rule.selectionMode === 'required' || rule.defaultQuantity) {
      normalized.push({
        addOnId: rule.addOnId,
        quantity: addOn.pricingType === 'per_unit' ? normalizedQuantity : 1,
      });
    }
  }

  return normalized;
}

const EMPTY_ADD_ONS: AddOnData[] = [];
const EMPTY_ADD_ON_RULES: ServiceAddOnRule[] = [];
const EMPTY_TECHNICIANS: TechnicianPreviewData[] = [];

export function BookServiceClient({
  services,
  addOns = EMPTY_ADD_ONS,
  serviceAddOnRules = EMPTY_ADD_ON_RULES,
  bookingFlow,
  locations,
  technicians = EMPTY_TECHNICIANS,
  currency = 'CAD',
  showNewClientPromo = false,
  lusterFeaturingEnabled = true,
}: BookServiceClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;

  const isFirstStep = getFirstStep(bookingFlow) === 'service';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const manageToken = searchParams.get('manageToken') || '';
  const campaignToken = searchParams.get('campaign') || '';
  const urlLocationId = searchParams.get('locationId') || '';
  const urlBaseServiceId = searchParams.get('baseServiceId');
  const urlTechId = searchParams.get('techId');
  const urlSelectedAddOns = parseSelectedAddOnsParam(searchParams.get('selectedAddOns'));
  const legacyServiceIds = searchParams.get('serviceIds')?.split(',').filter(Boolean) ?? [];

  const {
    technicianId = null,
    technicianSelectionSource = null,
    baseServiceId: storedBaseServiceId = null,
    selectedAddOns: storedSelectedAddOns = [],
    locationId: storedLocationId = null,
    setTechnicianId = () => {},
    setBaseServiceId = () => {},
    setSelectedAddOns = () => {},
    setServiceIds = () => {},
    setLocationId = () => {},
    syncFromUrl = () => {},
    isHydrated = false,
  } = useBookingState(salonSlug);

  const primaryLocation = locations.find(l => l.isPrimary) || locations[0];
  const showLocationPicker = locations.length >= 2;
  const urlLocationValid = urlLocationId && locations.some(l => l.id === urlLocationId);
  const hadInvalidLocation = !!(urlLocationId && !urlLocationValid && showLocationPicker);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(() => {
    if (urlLocationValid) {
      return urlLocationId;
    }
    return primaryLocation?.id || null;
  });
  const [showLocationFallbackToast, setShowLocationFallbackToast] = useState(hadInvalidLocation);

  const urlDrivenBaseServiceId = urlBaseServiceId ?? legacyServiceIds[0] ?? null;
  const initialBaseServiceId = urlDrivenBaseServiceId ?? null;
  const initialSelectedService = services.find(service => service.id === initialBaseServiceId) ?? null;
  // Manicure is the default tab, unless the salon offers nothing under it —
  // then land on the first tab (in canonical order) that has services.
  const firstNonEmptyCategory: BookingCategory
    = BOOKING_CATEGORIES.find(category =>
      services.some(service => service.bookingCategory === category)) ?? 'manicure';
  const initialCategory: BookingCategory = initialSelectedService?.bookingCategory ?? firstNonEmptyCategory;
  const initialSelectedAddOns = initialBaseServiceId
    ? buildDefaultSelectedAddOns(
      initialBaseServiceId,
      serviceAddOnRules,
      addOns,
      urlSelectedAddOns,
    )
    : [];

  const [selectedCategory, setSelectedCategory] = useState<BookingCategory>(initialCategory);
  const [selectedBaseServiceId, setSelectedBaseServiceIdState] = useState<string | null>(initialBaseServiceId);
  const [selectedAddOnsState, setSelectedAddOnsState] = useState<SelectedAddOnParam[]>(initialSelectedAddOns);
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);
  const [campaignOffer, setCampaignOffer] = useState<{
    name: string;
    displayOffer: string;
    code: string | null;
  } | null>(null);
  const [campaignUnavailable, setCampaignUnavailable] = useState(false);
  const hasUserChangedSelectionRef = useRef(false);
  const hasAppliedHydratedBookingStateRef = useRef(false);
  const hasManuallyClearedSelectionRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!campaignToken || !salonSlug) {
      setCampaignOffer(null);
      setCampaignUnavailable(false);
      return undefined;
    }

    let active = true;
    const loadCampaign = async () => {
      try {
        const response = await fetch(
          `/api/public/retention-campaigns/${encodeURIComponent(campaignToken)}?salonSlug=${encodeURIComponent(salonSlug)}`,
          { cache: 'no-store' },
        );
        const payload = await response.json().catch(() => null);
        if (!active) {
          return;
        }
        const campaign = payload?.data?.campaign;
        if (!response.ok || !campaign?.displayOffer || !campaign?.promotion?.name) {
          setCampaignOffer(null);
          setCampaignUnavailable(true);
          return;
        }
        setCampaignOffer({
          name: campaign.promotion.name,
          displayOffer: campaign.displayOffer,
          code: campaign.promotion.code ?? null,
        });
        setCampaignUnavailable(false);
      } catch {
        if (active) {
          setCampaignOffer(null);
          setCampaignUnavailable(true);
        }
      }
    };

    void loadCampaign();
    return () => {
      active = false;
    };
  }, [campaignToken, salonSlug]);

  // iOS Chrome can leave fixed elements attached to the layout viewport while
  // its bottom toolbar changes the visible viewport. Keep a CSS offset in sync
  // with that gap. Safari is deliberately excluded because it already places
  // fixed elements against its visual viewport correctly.
  useEffect(() => {
    const visualViewport = window.visualViewport;
    const isIosChrome = /CriOS/i.test(window.navigator.userAgent);

    if (!isIosChrome || !visualViewport) {
      return undefined;
    }

    const updateViewportBottom = () => {
      const viewportBottom = visualViewport.offsetTop + visualViewport.height;
      const bottomInset = Math.max(0, window.innerHeight - viewportBottom);
      document.documentElement.style.setProperty('--ios-chrome-viewport-bottom', `${bottomInset}px`);
    };

    updateViewportBottom();
    visualViewport.addEventListener('resize', updateViewportBottom);
    visualViewport.addEventListener('scroll', updateViewportBottom);

    return () => {
      visualViewport.removeEventListener('resize', updateViewportBottom);
      visualViewport.removeEventListener('scroll', updateViewportBottom);
      document.documentElement.style.removeProperty('--ios-chrome-viewport-bottom');
    };
  }, []);

  useEffect(() => {
    if (!isHydrated || hasAppliedHydratedBookingStateRef.current || hasUserChangedSelectionRef.current) {
      return;
    }

    if (!urlLocationId && storedLocationId && locations.some(location => location.id === storedLocationId)) {
      setSelectedLocationId(storedLocationId);
    }

    const hasUrlDrivenSelection = Boolean(urlDrivenBaseServiceId || urlSelectedAddOns.length > 0 || urlTechId);
    if (hasUrlDrivenSelection) {
      hasManuallyClearedSelectionRef.current = false;
      hasAppliedHydratedBookingStateRef.current = true;
      return;
    }

    if (hasManuallyClearedSelectionRef.current || !storedBaseServiceId) {
      hasAppliedHydratedBookingStateRef.current = true;
      return;
    }

    const storedService = services.find(service => service.id === storedBaseServiceId);
    if (!storedService) {
      hasAppliedHydratedBookingStateRef.current = true;
      return;
    }

    const normalizedStoredAddOns = buildDefaultSelectedAddOns(
      storedBaseServiceId,
      serviceAddOnRules,
      addOns,
      storedSelectedAddOns,
    );

    setSelectedBaseServiceIdState(storedBaseServiceId);
    setSelectedCategory(storedService.bookingCategory);
    setSelectedAddOnsState(normalizedStoredAddOns);
    hasManuallyClearedSelectionRef.current = false;
    hasAppliedHydratedBookingStateRef.current = true;
  }, [
    addOns,
    isHydrated,
    locations,
    serviceAddOnRules,
    services,
    storedBaseServiceId,
    storedLocationId,
    storedSelectedAddOns,
    urlDrivenBaseServiceId,
    urlLocationId,
    urlTechId,
    urlSelectedAddOns,
  ]);

  useEffect(() => {
    if (hadInvalidLocation && primaryLocation?.id) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set('locationId', primaryLocation.id);
      window.history.replaceState(null, '', `?${newParams.toString()}`);
    }
  }, [hadInvalidLocation, primaryLocation?.id, searchParams]);

  useEffect(() => {
    if (urlBaseServiceId || legacyServiceIds[0] || urlTechId) {
      syncFromUrl({
        techId: urlTechId,
        technicianSelectionSource: urlTechId && urlTechId !== 'any' ? 'explicit' : null,
        baseServiceId: urlBaseServiceId ?? legacyServiceIds[0] ?? null,
        selectedAddOns: urlSelectedAddOns,
        serviceIds: legacyServiceIds,
        locationId: selectedLocationId,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!selectedBaseServiceId) {
      if (selectedAddOnsState.length > 0) {
        setSelectedAddOnsState([]);
      }
      setBaseServiceId(null);
      setServiceIds([]);
      setSelectedAddOns([]);
      return;
    }

    const normalized = buildDefaultSelectedAddOns(
      selectedBaseServiceId,
      serviceAddOnRules,
      addOns,
      selectedAddOnsState,
    );

    const sameSelection = normalized.length === selectedAddOnsState.length
      && normalized.every((item, index) => (
        item.addOnId === selectedAddOnsState[index]?.addOnId
        && (item.quantity ?? 1) === (selectedAddOnsState[index]?.quantity ?? 1)
      ));

    if (!sameSelection) {
      setSelectedAddOnsState(normalized);
    }

    setBaseServiceId(selectedBaseServiceId);
    setServiceIds([selectedBaseServiceId]);
    setSelectedAddOns(normalized);
  }, [addOns, isHydrated, selectedAddOnsState, selectedBaseServiceId, serviceAddOnRules, setBaseServiceId, setSelectedAddOns, setServiceIds]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    setLocationId(selectedLocationId);
  }, [isHydrated, selectedLocationId, setLocationId]);

  const handleServiceSelection = (service: ServiceData) => {
    hasUserChangedSelectionRef.current = true;

    if (selectedBaseServiceId === service.id) {
      hasManuallyClearedSelectionRef.current = true;
      setSelectedBaseServiceIdState(null);
      setSelectedAddOnsState([]);
      if (technicianSelectionSource === 'auto') {
        setTechnicianId(null, null);
      }
    } else {
      hasManuallyClearedSelectionRef.current = false;
      setSelectedBaseServiceIdState(service.id);
      setSelectedCategory(service.bookingCategory);
    }

    triggerHaptic('select');
  };

  const filteredServices = services.filter((service) => {
    if (searchQuery) {
      return service.name.toLowerCase().includes(searchQuery.toLowerCase());
    }

    return service.bookingCategory === selectedCategory;
  });

  const selectedService = services.find(service => service.id === selectedBaseServiceId) ?? null;
  const selectedRules = selectedBaseServiceId
    ? serviceAddOnRules
      .filter(rule => rule.serviceId === selectedBaseServiceId)
      .sort((a, b) => a.displayOrder - b.displayOrder)
    : [];
  const addOnsById = new Map(addOns.map(addOn => [addOn.id, addOn]));
  const selectedAddOnsById = new Map(selectedAddOnsState.map(item => [item.addOnId, item.quantity ?? 1]));
  const allowedAddOns = selectedRules
    .map((rule) => {
      const addOn = addOnsById.get(rule.addOnId);
      if (!addOn || !addOn.isActive) {
        return null;
      }

      return {
        rule,
        addOn,
        quantity: selectedAddOnsById.get(addOn.id) ?? 0,
      };
    })
    .filter(Boolean);
  const hasVisibleAddOns = Boolean(selectedService && allowedAddOns.length > 0);
  const locationCompatiblePreviewTechnicians = technicians.filter(technician =>
    technicianSupportsPublicLocation({
      technician,
      locationId: selectedLocationId,
    }),
  );
  const compatiblePreviewTechnicians = selectedService
    ? locationCompatiblePreviewTechnicians.filter(technician =>
      getPublicTechnicianCompatibility({
        selectionMode: 'base-service',
        technician,
        requestedServices: [{ id: selectedService.id, name: selectedService.name, category: selectedService.category }],
      }).bookable,
    )
    : [];
  const hasSingleTechnicianSalonPreview = !selectedService && locationCompatiblePreviewTechnicians.length === 1;
  const soleCompatiblePreviewTechnician = compatiblePreviewTechnicians.length === 1
    ? compatiblePreviewTechnicians[0] ?? null
    : null;
  const hasConflictingExplicitTechnician = Boolean(
    technicianSelectionSource === 'explicit'
    && technicianId
    && soleCompatiblePreviewTechnician
    && technicianId !== soleCompatiblePreviewTechnician.id,
  );
  const shouldPreviewAutoSkipTech = Boolean(
    bookingFlow.includes('tech')
    && soleCompatiblePreviewTechnician
    && !hasConflictingExplicitTechnician,
  );
  const shouldCollapseTechStepInHeader = Boolean(
    bookingFlow.includes('tech')
    && (hasSingleTechnicianSalonPreview || shouldPreviewAutoSkipTech),
  );
  const effectiveBookingFlow = shouldCollapseTechStepInHeader
    ? bookingFlow.filter(step => step !== 'tech')
    : bookingFlow;

  // The Free Luster footer is rendered by the tenant layout after this page.
  // Reserve the complete fixed CTA height after that footer only while the CTA
  // is visible, so the natural scroll end never leaves its links underneath
  // iPhone Chrome's visual viewport or browser controls.
  useEffect(() => {
    const footerClearanceProperty = '--service-sticky-footer-clearance';

    if (!selectedService) {
      document.documentElement.style.removeProperty(footerClearanceProperty);
      return undefined;
    }

    document.documentElement.style.setProperty(
      footerClearanceProperty,
      STICKY_FOOTER_CLEARANCE,
    );

    return () => {
      document.documentElement.style.removeProperty(footerClearanceProperty);
    };
  }, [selectedService]);

  useEffect(() => {
    if (!isHydrated || !bookingFlow.includes('tech')) {
      return;
    }

    if (!selectedBaseServiceId) {
      if (!hasAppliedHydratedBookingStateRef.current && storedBaseServiceId) {
        return;
      }

      if (technicianSelectionSource === 'auto' || technicianId) {
        setTechnicianId(null, null);
      }
      return;
    }

    const compatibleTechnicianIds = new Set(compatiblePreviewTechnicians.map(technician => technician.id));
    const hasValidExplicitTechnician = Boolean(
      technicianSelectionSource === 'explicit'
      && technicianId
      && compatibleTechnicianIds.has(technicianId),
    );

    if (technicianSelectionSource === 'explicit' && technicianId && !hasValidExplicitTechnician) {
      setTechnicianId(null, null);
      return;
    }

    if (technicianSelectionSource === 'auto') {
      if (!soleCompatiblePreviewTechnician || technicianId !== soleCompatiblePreviewTechnician.id) {
        setTechnicianId(null, null);
        return;
      }
    }

    if (!technicianId && soleCompatiblePreviewTechnician) {
      setTechnicianId(soleCompatiblePreviewTechnician.id, 'auto');
    }
  }, [
    bookingFlow,
    compatiblePreviewTechnicians,
    isHydrated,
    selectedBaseServiceId,
    setTechnicianId,
    soleCompatiblePreviewTechnician,
    storedBaseServiceId,
    technicianId,
    technicianSelectionSource,
  ]);

  const totalPriceCents = (selectedService?.priceCents ?? 0) + allowedAddOns.reduce(
    (sum, item) => {
      if (!item || item.quantity <= 0) {
        return sum;
      }
      return sum + (item.addOn.priceCents * item.quantity);
    },
    0,
  );
  const totalDurationMinutes = (selectedService?.durationMinutes ?? 0) + allowedAddOns.reduce(
    (sum, item) => {
      if (!item || item.quantity <= 0) {
        return sum;
      }
      return sum + (item.addOn.durationMinutes * item.quantity);
    },
    0,
  );
  const featuredServices = getFeaturedServices(services, { lusterFeaturingEnabled });
  const serviceRows = buildServiceRows(filteredServices);
  const soleCompatiblePreviewRating = soleCompatiblePreviewTechnician
    ? getPublicTechnicianRatingDisplay({
      rating: soleCompatiblePreviewTechnician.rating,
      reviewCount: soleCompatiblePreviewTechnician.reviewCount,
    })
    : null;
  const effectiveContinueTechnicianId = shouldPreviewAutoSkipTech
    ? soleCompatiblePreviewTechnician?.id ?? null
    : technicianSelectionSource === 'explicit' && technicianId && compatiblePreviewTechnicians.some(
      technician => technician.id === technicianId,
    )
      ? technicianId
      : null;
  const effectiveContinueTechnicianSelectionSource = effectiveContinueTechnicianId
    ? (
        technicianSelectionSource === 'explicit' && technicianId === effectiveContinueTechnicianId
          ? 'explicit'
          : shouldPreviewAutoSkipTech
            ? 'auto'
            : 'explicit'
      )
    : null;

  const goToNextStep = (baseServiceIdValue: string, selectedAddOnsValue: SelectedAddOnParam[]) => {
    const nextStep = getNextStep('service', effectiveBookingFlow);
    if (!nextStep) {
      return;
    }

    if (effectiveContinueTechnicianId) {
      setTechnicianId(
        effectiveContinueTechnicianId,
        effectiveContinueTechnicianSelectionSource,
      );
    }

    router.push(buildBookingUrl(`/${locale}/book/${nextStep}`, {
      salonSlug,
      baseServiceId: baseServiceIdValue,
      selectedAddOns: selectedAddOnsValue,
      techId: effectiveContinueTechnicianId,
      originalAppointmentId,
      manageToken,
      campaignToken,
      locationId: selectedLocationId,
    }, {
      routeSalonSlug,
      locale,
    }));
  };

  const handleBack = () => {
    const prevStep = getPrevStep('service', bookingFlow);
    if (prevStep) {
      router.push(buildBookingUrl(`/${locale}/book/${prevStep}`, {
        salonSlug,
        baseServiceId: selectedBaseServiceId,
        selectedAddOns: selectedAddOnsState,
        originalAppointmentId,
        manageToken,
        campaignToken,
        locationId: selectedLocationId,
      }, {
        routeSalonSlug,
        locale,
      }));
    } else {
      router.back();
    }
  };

  const handleContinue = () => {
    if (!selectedBaseServiceId) {
      return;
    }

    triggerHaptic('confirm');

    goToNextStep(selectedBaseServiceId, selectedAddOnsState);
  };

  const handleAddOnToggle = (addOnId: string, nextQuantity?: number) => {
    if (!selectedBaseServiceId) {
      return;
    }

    const rule = selectedRules.find(item => item.addOnId === addOnId);
    const addOn = addOnsById.get(addOnId);
    if (!rule || !addOn) {
      return;
    }

    const isRequired = rule.selectionMode === 'required';
    const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;

    const existing = selectedAddOnsState.find(item => item.addOnId === addOnId);
    const existingQuantity = existing?.quantity ?? 1;
    const resolvedQuantity = nextQuantity ?? (addOn.pricingType === 'per_unit'
      ? Math.min(maxQuantity, existingQuantity + 1)
      : existing
        ? 0
        : 1);

    let nextSelected = selectedAddOnsState.filter(item => item.addOnId !== addOnId);

    if (resolvedQuantity > 0 || isRequired) {
      nextSelected = [
        ...nextSelected,
        {
          addOnId,
          quantity: addOn.pricingType === 'per_unit'
            ? Math.min(maxQuantity, Math.max(1, resolvedQuantity))
            : 1,
        },
      ];
    }

    const normalized = buildDefaultSelectedAddOns(selectedBaseServiceId, serviceAddOnRules, addOns, nextSelected)
      .sort((a, b) => {
        const orderA = selectedRules.find(ruleItem => ruleItem.addOnId === a.addOnId)?.displayOrder ?? 0;
        const orderB = selectedRules.find(ruleItem => ruleItem.addOnId === b.addOnId)?.displayOrder ?? 0;
        return orderA - orderB;
      });

    hasUserChangedSelectionRef.current = true;
    setSelectedAddOnsState(normalized);
    setSelectedAddOns(normalized);
    triggerHaptic('select');
  };

  return (
    <div
      className="service-page-viewport"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        <BookingStepHeader
          salonName={salonName}
          mounted={mounted}
          salonNameVariant="editorial"
          announcement={campaignOffer
            ? (
                <div
                  className="inline-flex max-w-full items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-center text-[11px] font-semibold leading-tight text-emerald-900 shadow-[0_4px_14px_rgba(0,0,0,0.04)]"
                >
                  ✨
                  {' '}
                  {campaignOffer.name}
                  {' · '}
                  {campaignOffer.displayOffer}
                  {campaignOffer.code ? ` · ${campaignOffer.code}` : ''}
                </div>
              )
            : showNewClientPromo
              ? (
                  <div
                    className="inline-flex max-w-full items-center justify-center rounded-full border px-3 py-1.5 text-center text-[11px] font-medium leading-tight shadow-[0_4px_14px_rgba(0,0,0,0.04)]"
                    style={{
                      borderColor: `color-mix(in srgb, ${themeVars.accent} 18%, ${themeVars.cardBorder})`,
                      backgroundColor: `color-mix(in srgb, white 84%, ${themeVars.accent} 16%)`,
                      color: `color-mix(in srgb, ${themeVars.primaryDark} 74%, ${themeVars.accent})`,
                    }}
                  >
                    ✨ 25% off for new clients — until April 30
                  </div>
                )
              : undefined}
          title="Choose Your Service"
          description="Pick your main service, then add optional extras."
          bookingFlow={effectiveBookingFlow}
          currentStep="service"
          isFirstStep={isFirstStep}
          onBack={handleBack}
          className="-mb-1"
        />

        {campaignUnavailable && (
          <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This promotion link is no longer available. You can still book at the regular price.
          </div>
        )}

        <div
          className="mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <Card className="flex items-center px-4 py-3 shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-3 text-neutral-400">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <Input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search services..."
              className="h-auto flex-1 border-0 bg-transparent p-0 text-base text-neutral-800 shadow-none focus-visible:ring-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="ml-2 flex size-6 items-center justify-center rounded-full bg-neutral-100 transition-colors hover:bg-neutral-200"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </Card>
        </div>

        {showLocationFallbackToast && (
          <div
            className="mb-4 flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3"
            style={{
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: '#fbbf24',
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 110ms, transform 300ms ease-out 110ms',
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-amber-600">⚠️</span>
              <span className="text-sm text-amber-800">
                Location not found, defaulted to
                {' '}
                {primaryLocation?.name || 'primary location'}
                .
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowLocationFallbackToast(false)}
              className="ml-2 text-amber-600 hover:text-amber-800"
              aria-label="Dismiss"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {showLocationPicker && (
          <div
            className="mb-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 120ms, transform 300ms ease-out 120ms',
            }}
          >
            <div className="mb-2 text-center text-sm font-medium text-neutral-600">
              📍 Choose a location
            </div>
            <div className="flex flex-col gap-2">
              {locations.map((location) => {
                const isSelected = selectedLocationId === location.id;
                return (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => {
                      if (selectedLocationId !== location.id) {
                        hasUserChangedSelectionRef.current = true;
                        setSelectedLocationId(location.id);
                        triggerHaptic('select');
                      }
                    }}
                    className="relative overflow-hidden rounded-xl p-3 text-left transition-all duration-200"
                    style={{
                      backgroundColor: isSelected ? `color-mix(in srgb, ${themeVars.primary} 15%, white)` : 'white',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: isSelected ? themeVars.primary : themeVars.cardBorder,
                      boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.04)',
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-neutral-900">{location.name}</span>
                          {location.isPrimary && (
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: `color-mix(in srgb, ${themeVars.accent} 15%, white)`, color: themeVars.accent }}
                            >
                              Primary
                            </span>
                          )}
                        </div>
                        {location.address && (
                          <div className="mt-0.5 text-sm text-neutral-500">
                            {location.address}
                            {location.city && `, ${location.city}`}
                            {location.state && ` ${location.state}`}
                          </div>
                        )}
                      </div>
                      <div
                        className="flex size-6 shrink-0 items-center justify-center rounded-full transition-all"
                        style={{
                          backgroundColor: isSelected ? themeVars.primary : 'transparent',
                          borderWidth: isSelected ? 0 : '2px',
                          borderStyle: 'solid',
                          borderColor: isSelected ? 'transparent' : '#d4d4d4',
                        }}
                      >
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                            <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {selectedService && shouldPreviewAutoSkipTech && soleCompatiblePreviewTechnician && (
          <div
            data-testid="service-auto-technician-preview"
            className="mb-4 flex items-center gap-3 rounded-full border bg-white/90 px-3 py-2 shadow-[0_4px_18px_rgba(0,0,0,0.05)] backdrop-blur-sm"
            style={{
              borderColor: `color-mix(in srgb, ${themeVars.primary} 20%, ${themeVars.cardBorder})`,
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 130ms, transform 300ms ease-out 130ms',
            }}
          >
            <TechnicianAvatar
              name={soleCompatiblePreviewTechnician.name}
              imageUrl={soleCompatiblePreviewTechnician.imageUrl}
              className="size-10 shrink-0"
              sizes="40px"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                Your artist
              </div>
              <div className="truncate text-sm font-semibold text-neutral-900">
                {soleCompatiblePreviewTechnician.name}
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-neutral-500">
              {soleCompatiblePreviewRating?.kind === 'rated'
                ? (
                    <>
                      <div className="font-semibold text-neutral-800">
                        {soleCompatiblePreviewRating.ratingText}
                        {' '}
                        ★
                      </div>
                      <div>
                        {soleCompatiblePreviewRating.reviewCountText}
                        {' '}
                        reviews
                      </div>
                    </>
                  )
                : 'New artist'}
            </div>
          </div>
        )}

        {services.length === 0
          ? (
              <StateCard
                className="shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                contentClassName="py-8"
                icon="🗓️"
                title="Online booking is not ready yet"
                description={(
                  <>
                    This salon does not have any active services available to book right now.
                    {' '}
                    Please contact the salon directly to make an appointment.
                  </>
                )}
              />
            )
          : (
              <>
                <div
                  className="scrollbar-hide -mx-4 mb-2.5 w-[calc(100%+2rem)] overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:w-full sm:overflow-visible sm:px-0"
                  style={{
                    opacity: mounted ? 1 : 0,
                    transition: 'opacity 300ms ease-out 150ms',
                  }}
                  data-testid="featured-services-scroll"
                >
                  {featuredServices.length > 0 && (
                    <div className="mb-2.5">
                      <div className="mb-1 px-4 sm:px-0">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                          Featured services
                        </div>
                        <div className="mt-0.5 text-[13px] font-semibold text-neutral-900">
                          Popular premium sets and combo appointments
                        </div>
                      </div>
                      <div
                        className="scrollbar-hide -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0"
                        role="region"
                        aria-label="Featured services"
                      >
                        <div className="flex min-w-max gap-2">
                          {featuredServices.map((service, featuredIndex) => {
                            const isSelected = selectedBaseServiceId === service.id;
                            return (
                              <button
                                key={`featured-${service.id}`}
                                type="button"
                                disabled={!isHydrated}
                                onClick={() => handleServiceSelection(service)}
                                data-testid={`featured-service-card-${service.id}`}
                                aria-pressed={isSelected}
                                aria-label={`${service.name}, ${formatDuration(service.durationMinutes)}, ${service.priceDisplayText || formatMoney(service.priceCents, currency)}`}
                                className={`relative w-[min(272px,calc(100vw-4rem))] shrink-0 overflow-hidden rounded-2xl text-left transition-all duration-200 ${
                                  service.bookingCategory === 'combo' ? 'sm:w-[320px]' : 'sm:w-[280px]'
                                }`}
                                style={{
                                  background: isSelected
                                    ? `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 24%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 12%, transparent))`
                                    : 'white',
                                  boxShadow: isSelected
                                    ? '0 14px 28px rgba(0,0,0,0.14)'
                                    : '0 4px 20px rgba(0,0,0,0.06)',
                                  borderWidth: '1px',
                                  borderStyle: 'solid',
                                  borderColor: isSelected ? themeVars.primary : themeVars.cardBorder,
                                }}
                              >
                                <div className="relative h-[80px] overflow-hidden sm:h-[96px]">
                                  <ServiceCardImage
                                    src={service.imageUrl}
                                    alt={service.name}
                                    imageTestId={`featured-service-card-image-${service.id}`}
                                    className="object-cover transition-transform duration-300"
                                  />
                                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent sm:h-20" />
                                  <div className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-800 shadow-sm">
                                    {/* "Best value" only on the lead card — a badge on every card means nothing */}
                                    {featuredIndex === 0 && service.bookingCategory === 'combo'
                                      ? 'Best value'
                                      : BOOKING_CATEGORY_META[service.bookingCategory].label}
                                  </div>
                                </div>
                                <div className="p-2">
                                  <div className="line-clamp-2 break-words text-[13px] font-bold leading-tight text-neutral-900 sm:text-[14px]">
                                    {service.name}
                                  </div>
                                  <div className="mt-0.5 line-clamp-1 text-[10px] leading-[1.35] text-neutral-500 sm:line-clamp-2">
                                    {service.descriptionItems[0] ?? service.description ?? 'Bookable base service'}
                                  </div>
                                  <div className="mt-0.5 flex items-center justify-between gap-3 sm:mt-1">
                                    <span className="text-[12px] text-neutral-500">
                                      {formatDuration(service.durationMinutes)}
                                    </span>
                                    <span className="text-[15px] font-bold" style={{ color: themeVars.accent }}>
                                      {service.priceDisplayText || formatMoney(service.priceCents, currency)}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="scrollbar-hide -mx-4 mb-5 w-[calc(100%+2rem)] overflow-x-auto overflow-y-hidden px-4 md:mx-0 md:w-full md:overflow-visible md:px-0"
                  style={{
                    opacity: mounted ? 1 : 0,
                    transition: 'opacity 300ms ease-out 150ms',
                  }}
                  data-testid="service-category-scroll"
                >
                  <div
                    className="flex min-w-max flex-nowrap gap-1.5 md:min-w-0 md:flex-wrap md:justify-center md:gap-2"
                    data-testid="service-category-track"
                  >
                    {BOOKING_CATEGORIES.map((category) => {
                      const active = category === selectedCategory;
                      const meta = BOOKING_CATEGORY_META[category];
                      return (
                        <button
                          key={category}
                          type="button"
                          disabled={!isHydrated}
                          aria-pressed={active}
                          onClick={() => {
                            if (category !== selectedCategory) {
                              setSelectedCategory(category);
                              triggerHaptic('select');
                            }
                          }}
                          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 md:gap-2 md:px-5"
                          style={{
                            backgroundColor: active ? themeVars.accent : 'white',
                            color: active ? 'white' : '#525252',
                            borderWidth: active ? 0 : '1px',
                            borderStyle: 'solid',
                            borderColor: active ? 'transparent' : themeVars.cardBorder,
                            boxShadow: active ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                          }}
                        >
                          <span className="shrink-0">{meta.icon}</span>
                          <span className="shrink-0 whitespace-nowrap">{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  {!searchQuery && filteredServices.length === 0 && (
                    <div
                      data-testid="service-category-empty"
                      className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-neutral-500"
                      style={{ borderColor: themeVars.cardBorder }}
                    >
                      No
                      {' '}
                      {selectedCategory}
                      {' '}
                      services available yet.
                    </div>
                  )}
                  {serviceRows.map((row, rowIndex) => {
                    const rowContainsSelectedService = row.some(service => service.id === selectedBaseServiceId);

                    return (
                      <div key={`service-row-${row.map(service => service.id).join('-')}`} className="space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          {row.map((service, serviceIndex) => {
                            const isSelected = selectedBaseServiceId === service.id;
                            const previewDescription = service.descriptionItems[0] ?? service.description ?? 'Bookable base service';
                            const animationIndex = rowIndex * 2 + serviceIndex;

                            return (
                              <button
                                key={service.id}
                                type="button"
                                disabled={!isHydrated}
                                onClick={() => handleServiceSelection(service)}
                                data-testid={`service-card-${service.id}`}
                                data-selected={isSelected ? 'true' : 'false'}
                                aria-pressed={isSelected}
                                className={`relative flex h-full flex-col overflow-hidden rounded-2xl text-left transition-all duration-200 ${
                                  service.bookingCategory === 'combo' ? 'col-span-full' : ''
                                }`}
                                style={{
                                  transform: mounted ? 'translateY(0)' : 'translateY(15px)',
                                  opacity: mounted ? 1 : 0,
                                  background: isSelected
                                    ? '#fdf8f1'
                                    : 'white',
                                  boxShadow: isSelected
                                    ? '0 10px 22px rgba(0,0,0,0.08)'
                                    : '0 4px 20px rgba(0,0,0,0.06)',
                                  borderWidth: '1px',
                                  borderStyle: 'solid',
                                  borderColor: isSelected ? themeVars.primary : themeVars.cardBorder,
                                  transition: `opacity 300ms ease-out ${200 + animationIndex * 50}ms, transform 300ms ease-out ${200 + animationIndex * 50}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                                }}
                              >
                                <div
                                  data-testid={`service-card-image-${service.id}`}
                                  className={`relative overflow-hidden ${service.bookingCategory === 'combo' ? 'h-[96px]' : 'h-[68px]'}`}
                                  style={{
                                    background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                                  }}
                                >
                                  <ServiceCardImage
                                    src={service.imageUrl}
                                    alt={service.name}
                                    imageTestId={`service-card-image-element-${service.id}`}
                                    placeholderTestId={`service-card-image-placeholder-${service.id}`}
                                    className={`object-cover transition-transform duration-300 ${isSelected ? 'scale-105' : ''}`}
                                  />
                                  {service.resolvedIntroPriceLabel && (
                                    <div className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-800 shadow-sm">
                                      {service.resolvedIntroPriceLabel}
                                    </div>
                                  )}
                                </div>

                                <div
                                  data-testid={`service-card-content-${service.id}`}
                                  className={`flex flex-1 flex-col ${service.bookingCategory === 'combo' ? 'p-2.5' : 'min-h-[104px] p-2.5'}`}
                                >
                                  <div className="break-words text-[14px] font-bold leading-tight text-neutral-900">
                                    {service.name}
                                  </div>
                                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-[1.35] text-neutral-500">
                                    {previewDescription}
                                  </div>
                                  {isSelected && hasVisibleAddOns && (
                                    <div
                                      data-testid={`service-card-addon-cue-${service.id}`}
                                      className="mt-1 inline-flex items-center text-[8px] font-medium tracking-[0.01em]"
                                      style={{
                                        color: `color-mix(in srgb, ${themeVars.primaryDark} 62%, #9b7a35)`,
                                      }}
                                    >
                                      Add-ons available
                                    </div>
                                  )}
                                  <div
                                    data-testid={`service-card-meta-row-${service.id}`}
                                    className="mt-auto flex items-end justify-between gap-3 pt-2.5"
                                  >
                                    <span className="text-[11px] leading-none text-neutral-500">
                                      {formatDuration(service.durationMinutes)}
                                    </span>
                                    <span
                                      data-testid={`service-card-price-${service.id}`}
                                      className="shrink-0 text-right text-lg font-bold leading-none"
                                      style={{ color: themeVars.accent }}
                                    >
                                      {service.priceDisplayText || formatMoney(service.priceCents, currency)}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {rowContainsSelectedService && hasVisibleAddOns && selectedService && (
                          <div
                            data-testid="service-inline-addons-panel"
                            className="w-full rounded-[24px] bg-white px-3.5 py-3 shadow-[0_8px_22px_rgba(0,0,0,0.04)] sm:px-4 sm:py-3.5"
                            style={{
                              borderWidth: '1px',
                              borderStyle: 'solid',
                              borderColor: themeVars.cardBorder,
                            }}
                          >
                            <div className="mb-2">
                              <div className="text-[15px] font-semibold text-neutral-900">
                                Customize your service
                              </div>
                              <div className="mt-0.5 text-[11px] leading-4 text-neutral-500">
                                Optional add-ons for
                                {' '}
                                {selectedService.name}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              {allowedAddOns.map((item) => {
                                if (!item) {
                                  return null;
                                }

                                const { addOn, rule, quantity } = item;
                                const isSelected = quantity > 0;
                                const isRequired = rule.selectionMode === 'required';
                                const maxQuantity = rule.maxQuantityOverride ?? addOn.maxQuantity ?? 10;
                                const lineTotalCents = addOn.priceCents * Math.max(quantity, 1);
                                const lineDurationMinutes = addOn.durationMinutes * Math.max(quantity, 1);

                                return (
                                  <div
                                    key={addOn.id}
                                    data-testid={`service-addon-row-${addOn.id}`}
                                    className="rounded-[18px] border px-3 py-2 sm:px-3.5 sm:py-2.5"
                                    style={{
                                      borderColor: isSelected ? themeVars.primary : themeVars.cardBorder,
                                      backgroundColor: isSelected
                                        ? `color-mix(in srgb, ${themeVars.primary} 5%, white)`
                                        : 'white',
                                    }}
                                  >
                                    <div className="flex items-center justify-between gap-2.5">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                          <div className="text-sm font-semibold text-neutral-900">{addOn.name}</div>
                                          {isRequired && (
                                            <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                                              Required
                                            </span>
                                          )}
                                        </div>
                                        {addOn.descriptionItems[0] && (
                                          <div className="mt-0.5 text-[12px] leading-4 text-neutral-500">
                                            {addOn.descriptionItems[0]}
                                          </div>
                                        )}
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                                          <span>{addOn.priceDisplayText || formatMoney(addOn.priceCents, currency)}</span>
                                          <span>{formatDuration(addOn.durationMinutes)}</span>
                                          {isSelected && (
                                            <span>
                                              Selected:
                                              {' '}
                                              {formatMoney(lineTotalCents, currency)}
                                              {' '}
                                              ·
                                              {' '}
                                              {formatDuration(lineDurationMinutes)}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {addOn.pricingType === 'per_unit'
                                        ? (
                                            <div className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                onClick={() => handleAddOnToggle(addOn.id, isRequired ? Math.max(1, quantity - 1) : Math.max(0, quantity - 1))}
                                                disabled={isRequired ? quantity <= 1 : quantity <= 0}
                                                className="flex size-7 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                                              >
                                                -
                                              </button>
                                              <div className="min-w-6 text-center text-sm font-semibold text-neutral-900">
                                                {quantity}
                                              </div>
                                              <button
                                                type="button"
                                                onClick={() => handleAddOnToggle(addOn.id, Math.min(maxQuantity, Math.max(quantity, 0) + 1))}
                                                disabled={quantity >= maxQuantity}
                                                className="flex size-7 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                                              >
                                                +
                                              </button>
                                            </div>
                                          )
                                        : (
                                            <button
                                              type="button"
                                              onClick={() => handleAddOnToggle(addOn.id)}
                                              disabled={isRequired}
                                              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed"
                                              style={{
                                                backgroundColor: isSelected || isRequired ? themeVars.primary : '#f5f5f5',
                                                color: isSelected || isRequired ? '#171717' : '#404040',
                                              }}
                                            >
                                              {isRequired ? 'Included' : isSelected ? 'Added' : 'Add'}
                                            </button>
                                          )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

        {selectedService && (
          <div
            data-testid="service-sticky-spacer"
            aria-hidden="true"
            style={{ height: STICKY_FOOTER_CLEARANCE }}
          />
        )}
      </div>

      {selectedService && (
        <div
          data-testid="service-sticky-bar"
          className="supports-[backdrop-filter]:bg-white/82 fixed inset-x-0 bottom-0 z-[60] border-t border-white/40 bg-white/85 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-lg"
          style={{
            animation: 'slideUp 0.3s ease-out',
            bottom: 'var(--ios-chrome-viewport-bottom, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <style jsx>
            {`
              @keyframes slideUp {
                from {
                  transform: translateY(100%);
                }
                to {
                  transform: translateY(0);
                }
              }
            `}
          </style>
          <div className="mx-auto flex max-w-[430px] flex-nowrap items-center justify-between gap-3 px-4 py-1.5 sm:py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="truncate text-[11px] leading-none text-neutral-500">
                {selectedAddOnsState.length > 0
                  ? `1 service + ${selectedAddOnsState.length} add-on${selectedAddOnsState.length === 1 ? '' : 's'}`
                  : '1 service'}
              </div>
              {hasVisibleAddOns && (
                <div
                  data-testid="service-sticky-addon-note"
                  className="truncate text-[9px] font-medium leading-none"
                  style={{ color: themeVars.accent }}
                >
                  Optional add-ons available
                </div>
              )}
              <div className="flex items-baseline gap-2 pt-0.5">
                <div className="text-[17px] font-bold leading-none text-neutral-900">
                  {formatMoney(totalPriceCents, currency)}
                </div>
                <div className="text-[11px] leading-none text-neutral-500">
                  {formatDuration(totalDurationMinutes)}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              data-testid="service-continue-button"
              className="flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-bold text-neutral-900 shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98] sm:gap-2 sm:px-5 sm:py-2.5 sm:text-[15px]"
              style={{
                background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
              }}
            >
              Continue
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

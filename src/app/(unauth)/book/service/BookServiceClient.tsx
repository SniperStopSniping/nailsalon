'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BlockingLoginModal } from '@/components/BlockingLoginModal';
import { BookingStepHeader } from '@/components/booking/BookingStepHeader';
import { BookingFloatingDock } from '@/components/booking/BookingFloatingDock';
import { BookingPhoneLogin } from '@/components/booking/BookingPhoneLogin';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StateCard } from '@/components/ui/state-card';
import { useClientSession } from '@/hooks/useClientSession';
import { useBookingState } from '@/hooks/useBookingState';
import { buildBookingUrl, parseSelectedAddOnsParam, type SelectedAddOnParam } from '@/libs/bookingParams';
import { type BookingStep, getFirstStep, getNextStep, getPrevStep } from '@/libs/bookingFlow';
import { triggerHaptic } from '@/libs/haptics';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

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
  imageUrl: string;
  resolvedIntroPriceLabel: string | null;
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

type BookServiceClientProps = {
  services: ServiceData[];
  addOns?: AddOnData[];
  serviceAddOnRules?: ServiceAddOnRule[];
  bookingFlow: BookingStep[];
  locations: LocationData[];
  currency?: string;
};

const CATEGORY_META: Record<ServiceCategory, { label: string; icon: string }> = {
  manicure: { label: 'Manicure', icon: '💅' },
  builder_gel: { label: 'Builder Gel', icon: '✨' },
  extensions: { label: 'Extensions', icon: '💎' },
  pedicure: { label: 'Pedicure', icon: '🦶' },
  hands: { label: 'Hands', icon: '💅' },
  feet: { label: 'Feet', icon: '🦶' },
  combo: { label: 'Combo', icon: '✨' },
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
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

export function BookServiceClient({
  services,
  addOns = [],
  serviceAddOnRules = [],
  bookingFlow,
  locations,
  currency = 'CAD',
}: BookServiceClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName, salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const routeSalonSlug = typeof params?.slug === 'string' ? params.slug : null;

  const isFirstStep = getFirstStep(bookingFlow) === 'service';
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const urlLocationId = searchParams.get('locationId') || '';
  const urlBaseServiceId = searchParams.get('baseServiceId');
  const urlSelectedAddOns = parseSelectedAddOnsParam(searchParams.get('selectedAddOns'));
  const legacyServiceIds = searchParams.get('serviceIds')?.split(',').filter(Boolean) ?? [];

  const { isLoggedIn, isCheckingSession, handleLoginSuccess } = useClientSession();
  const {
    technicianId = null,
    baseServiceId: storedBaseServiceId = null,
    selectedAddOns: storedSelectedAddOns = [],
    setBaseServiceId = () => {},
    setSelectedAddOns = () => {},
    setServiceIds = () => {},
    syncFromUrl = () => {},
  } = useBookingState();

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

  const initialCategory = services[0]?.category ?? 'manicure';
  const initialBaseServiceId = urlBaseServiceId
    ?? legacyServiceIds[0]
    ?? storedBaseServiceId
    ?? services[0]?.id
    ?? null;

  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory>(initialCategory);
  const [selectedBaseServiceId, setSelectedBaseServiceIdState] = useState<string | null>(initialBaseServiceId);
  const [selectedAddOnsState, setSelectedAddOnsState] = useState<SelectedAddOnParam[]>(
    urlSelectedAddOns.length > 0 ? urlSelectedAddOns : (storedSelectedAddOns ?? []),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    baseServiceId: string;
    selectedAddOns: SelectedAddOnParam[];
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (hadInvalidLocation && primaryLocation?.id) {
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.set('locationId', primaryLocation.id);
      window.history.replaceState(null, '', `?${newParams.toString()}`);
    }
  }, [hadInvalidLocation, primaryLocation?.id, searchParams]);

  useEffect(() => {
    if (urlBaseServiceId || legacyServiceIds[0]) {
      syncFromUrl({
        baseServiceId: urlBaseServiceId ?? legacyServiceIds[0] ?? null,
        selectedAddOns: urlSelectedAddOns,
        serviceIds: legacyServiceIds,
        locationId: selectedLocationId,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
  }, [selectedBaseServiceId, selectedAddOnsState, serviceAddOnRules, addOns, setBaseServiceId, setSelectedAddOns, setServiceIds]);

  const availableCategories = Array.from(new Set(services.map(service => service.category)));

  const filteredServices = services.filter((service) => {
    if (searchQuery) {
      return service.name.toLowerCase().includes(searchQuery.toLowerCase());
    }

    return service.category === selectedCategory;
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

  const goToNextStep = (baseServiceIdValue: string, selectedAddOnsValue: SelectedAddOnParam[]) => {
    const nextStep = getNextStep('service', bookingFlow);
    if (!nextStep) {
      return;
    }

    router.push(buildBookingUrl(`/${locale}/book/${nextStep}`, {
      salonSlug,
      baseServiceId: baseServiceIdValue,
      selectedAddOns: selectedAddOnsValue,
      techId: technicianId,
      originalAppointmentId,
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

    if (isLoggedIn) {
      goToNextStep(selectedBaseServiceId, selectedAddOnsState);
      return;
    }

    setPendingSelection({
      baseServiceId: selectedBaseServiceId,
      selectedAddOns: selectedAddOnsState,
    });
    setIsLoginModalOpen(true);
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

    setSelectedAddOnsState(normalized);
    setSelectedAddOns(normalized);
    triggerHaptic('select');
  };

  const handleBottomLoginSuccess = (verifiedPhone: string) => {
    handleLoginSuccess(verifiedPhone);
  };

  const handleModalLoginSuccess = (verifiedPhone: string) => {
    handleLoginSuccess(verifiedPhone);
    setIsLoginModalOpen(false);
    if (pendingSelection) {
      goToNextStep(pendingSelection.baseServiceId, pendingSelection.selectedAddOns);
      setPendingSelection(null);
    }
  };

  const handleCloseLoginModal = () => {
    setIsLoginModalOpen(false);
    setPendingSelection(null);
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        <BookingStepHeader
          salonName={salonName}
          mounted={mounted}
          title="Choose Your Service"
          description="Pick your main service, then add optional extras."
          bookingFlow={bookingFlow}
          currentStep="service"
          isFirstStep={isFirstStep}
          onBack={handleBack}
          className="-mb-1"
        />

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
              className="h-auto flex-1 border-0 bg-transparent px-0 py-0 text-base text-neutral-800 shadow-none focus-visible:ring-0"
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
                  className="mb-5 flex items-center justify-center gap-2"
                  style={{
                    opacity: mounted ? 1 : 0,
                    transition: 'opacity 300ms ease-out 150ms',
                  }}
                >
                  {availableCategories.map((category) => {
                    const active = category === selectedCategory;
                    const meta = CATEGORY_META[category];
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => {
                          if (category !== selectedCategory) {
                            setSelectedCategory(category);
                            triggerHaptic('select');
                          }
                        }}
                        className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-200"
                        style={{
                          backgroundColor: active ? themeVars.accent : 'white',
                          color: active ? 'white' : '#525252',
                          borderWidth: active ? 0 : '1px',
                          borderStyle: 'solid',
                          borderColor: active ? 'transparent' : themeVars.cardBorder,
                          boxShadow: active ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                        }}
                      >
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {filteredServices.map((service, index) => {
                    const isSelected = selectedBaseServiceId === service.id;
                    const previewDescription = service.descriptionItems[0] ?? service.description ?? 'Bookable base service';
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => {
                          setSelectedBaseServiceIdState(service.id);
                          setSelectedCategory(service.category);
                          triggerHaptic('select');
                        }}
                        data-testid={`service-card-${service.id}`}
                        data-selected={isSelected ? 'true' : 'false'}
                        aria-pressed={isSelected}
                        className="relative overflow-hidden rounded-2xl text-left transition-all duration-200"
                        style={{
                          transform: mounted ? (isSelected ? 'scale(1.02)' : 'translateY(0)') : 'translateY(15px)',
                          opacity: mounted ? 1 : 0,
                          background: isSelected
                            ? `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 20%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 10%, transparent))`
                            : 'white',
                          boxShadow: isSelected
                            ? '0 10px 15px -3px rgb(0 0 0 / 0.1)'
                            : '0 4px 20px rgba(0,0,0,0.06)',
                          borderWidth: isSelected ? 0 : '1px',
                          borderStyle: 'solid',
                          borderColor: isSelected ? 'transparent' : themeVars.cardBorder,
                          outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
                          transition: `opacity 300ms ease-out ${200 + index * 50}ms, transform 300ms ease-out ${200 + index * 50}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                        }}
                      >
                        <div
                          className="relative h-[120px] overflow-hidden"
                          style={{
                            background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                          }}
                        >
                          <Image
                            src={service.imageUrl}
                            alt={service.name}
                            fill
                            className={`object-cover transition-transform duration-300 ${isSelected ? 'scale-105' : ''}`}
                          />
                          {service.resolvedIntroPriceLabel && (
                            <div className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-800 shadow-sm">
                              {service.resolvedIntroPriceLabel}
                            </div>
                          )}
                          {isSelected && (
                            <div
                              className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full shadow-lg"
                              style={{
                                background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                                <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          )}
                        </div>

                        <div className="p-3">
                          <div className="text-base font-bold leading-tight text-neutral-900">
                            {service.name}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                            {previewDescription}
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-sm text-neutral-500">
                              {formatDuration(service.durationMinutes)}
                            </span>
                            <span className="text-base font-bold" style={{ color: themeVars.accent }}>
                              {service.priceDisplayText || formatMoney(service.priceCents, currency)}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedService && (
                  <div
                    className="mt-6 rounded-3xl bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
                    style={{
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: themeVars.cardBorder,
                    }}
                  >
                    <div className="mb-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                        Customize
                      </div>
                      <div className="mt-1 text-lg font-bold text-neutral-900">
                        Optional add-ons for
                        {' '}
                        {selectedService.name}
                      </div>
                      <div className="text-sm text-neutral-500">
                        Add extra time or upgrades without changing your main service.
                      </div>
                    </div>

                    {allowedAddOns.length === 0
                      ? (
                          <div className="rounded-2xl border border-dashed border-neutral-200 px-4 py-5 text-sm text-neutral-500">
                            No add-ons available for this service yet.
                          </div>
                        )
                      : (
                          <div className="space-y-3">
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
                                  className="rounded-2xl border px-4 py-3"
                                  style={{
                                    borderColor: isSelected ? themeVars.primary : themeVars.cardBorder,
                                    backgroundColor: isSelected
                                      ? `color-mix(in srgb, ${themeVars.primary} 8%, white)`
                                      : 'white',
                                  }}
                                >
                                  <div className="flex items-start justify-between gap-4">
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
                                        <div className="mt-1 text-sm text-neutral-500">
                                          {addOn.descriptionItems[0]}
                                        </div>
                                      )}
                                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
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
                                          <div className="flex items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => handleAddOnToggle(addOn.id, isRequired ? Math.max(1, quantity - 1) : Math.max(0, quantity - 1))}
                                              disabled={isRequired ? quantity <= 1 : quantity <= 0}
                                              className="flex size-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                              -
                                            </button>
                                            <div className="min-w-[2rem] text-center text-sm font-semibold text-neutral-900">
                                              {quantity}
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => handleAddOnToggle(addOn.id, Math.min(maxQuantity, Math.max(quantity, 0) + 1))}
                                              disabled={quantity >= maxQuantity}
                                              className="flex size-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
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
                                            className="rounded-full px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed"
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
                        )}
                  </div>
                )}
              </>
            )}

        {selectedService && <div className="h-24" />}
        {!isCheckingSession && isLoggedIn && isFirstStep && <div className="h-16" />}

        {isFirstStep && !isCheckingSession && !isLoggedIn && (
          <BookingPhoneLogin onLoginSuccess={handleBottomLoginSuccess} />
        )}

        {!isCheckingSession && isLoggedIn && isFirstStep && <BookingFloatingDock />}

        <BlockingLoginModal
          isOpen={isLoginModalOpen}
          onClose={handleCloseLoginModal}
          onLoginSuccess={handleModalLoginSuccess}
        />
      </div>

      {selectedService && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.1)]"
          style={{
            borderTopWidth: '1px',
            borderTopStyle: 'solid',
            borderTopColor: themeVars.cardBorder,
            animation: 'slideUp 0.3s ease-out',
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
          <div className="mx-auto flex max-w-[430px] items-center justify-between p-4">
            <div>
              <div className="text-sm text-neutral-500">
                {selectedAddOnsState.length > 0
                  ? `1 service + ${selectedAddOnsState.length} add-on${selectedAddOnsState.length === 1 ? '' : 's'}`
                  : '1 service'}
              </div>
              <div className="text-xl font-bold text-neutral-900">
                {formatMoney(totalPriceCents, currency)}
              </div>
              <div className="text-sm text-neutral-500">
                {formatDuration(totalDurationMinutes)}
              </div>
            </div>
            <button
              type="button"
              onClick={handleContinue}
              data-testid="service-continue-button"
              className="flex items-center gap-2 rounded-full px-6 py-3 text-base font-bold text-neutral-900 shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
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
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}
    </div>
  );
}

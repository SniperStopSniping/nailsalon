export type ServiceMenuOwnerOverride = {
  durationMinutes?: number;
  priceCents?: number;
};

export type ServiceMenuSelectionDraft = {
  ownerOverridesByServiceId: Record<string, ServiceMenuOwnerOverride>;
  /** Optional so schema-v6 drafts created before this acknowledgement load losslessly. */
  reviewed?: boolean;
  /** Canonical Booking add-on IDs only; optional for lossless legacy draft migration. */
  selectedAddOnIds?: string[];
  selectedServiceIds: string[];
};

export type ServiceMenuItem = {
  categoryId: string;
  categoryLabel: string;
  durationLabel: string;
  id: string;
  imageAlt?: string;
  imageSrc?: string;
  itemKind: 'service' | 'add_on';
  name: string;
  popular: boolean;
  priceLabel: string;
};

export type ServiceMenuCategory = {
  id: string;
  label: string;
};

export type ServiceMenuPort = {
  readonly implementation: 'lab-only';
  createDefaultSelection: () => ServiceMenuSelectionDraft;
  getCategories: () => readonly ServiceMenuCategory[];
  getLibraryAddOns: () => readonly ServiceMenuItem[];
  getLibraryServices: () => readonly ServiceMenuItem[];
  getSelectedAddOns: (
    draft: ServiceMenuSelectionDraft,
  ) => readonly ServiceMenuItem[];
  getSelectedServices: (
    draft: ServiceMenuSelectionDraft,
  ) => readonly ServiceMenuItem[];
  normalizeSelection: (
    draft: ServiceMenuSelectionDraft,
  ) => ServiceMenuSelectionDraft;
  setServiceSelected: (
    draft: ServiceMenuSelectionDraft,
    serviceId: string,
    selected: boolean,
  ) => ServiceMenuSelectionDraft;
  setAddOnSelected: (
    draft: ServiceMenuSelectionDraft,
    addOnId: string,
    selected: boolean,
  ) => ServiceMenuSelectionDraft;
};

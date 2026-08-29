export type ServiceMenuOwnerOverride = {
  durationMinutes?: number;
  priceCents?: number;
};

export type ServiceMenuSelectionDraft = {
  ownerOverridesByServiceId: Record<string, ServiceMenuOwnerOverride>;
  /** Optional so schema-v6 drafts created before this acknowledgement load losslessly. */
  reviewed?: boolean;
  selectedServiceIds: string[];
};

export type ServiceMenuItem = {
  categoryId: string;
  categoryLabel: string;
  durationLabel: string;
  id: string;
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
  getLibraryServices: () => readonly ServiceMenuItem[];
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
};

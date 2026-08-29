export const MINIMUM_NOTICE_PRESET_MINUTES = [
  0,
  120,
  240,
  480,
  720,
  1_440,
  2_880,
  4_320,
] as const;

export const DEPOSIT_PRESET_CENTS = [
  1_000,
  1_500,
  2_000,
  2_500,
  3_000,
  4_000,
  5_000,
] as const;

export type MinimumNoticePresetMinutes =
  (typeof MINIMUM_NOTICE_PRESET_MINUTES)[number];

export type DepositPresetCents = (typeof DEPOSIT_PRESET_CENTS)[number];

export type MinimumNoticeUnit = 'hours' | 'days';

export type MinimumNoticeChoice =
  | `preset:${MinimumNoticePresetMinutes}`
  | 'custom';

export type DepositAmountChoice =
  | `preset:${DepositPresetCents}`
  | 'custom';

export type DepositMode = 'none' | 'fixed';

export type LegacyV5DepositArchive = {
  amount: string;
  amountType: 'fixed' | 'percentage' | 'service_defined' | null;
  mode: 'none' | 'generally_required' | 'depends_on_service' | null;
};

export type DepositDraft = {
  amountCents: number | null;
  legacyV5Archive?: LegacyV5DepositArchive;
  mode: DepositMode;
  refundable: boolean | null;
  transferable: boolean | null;
  wordingOverride: string;
};

export type BookableTimePreview = {
  readonly id: string;
  readonly label: string;
  readonly startsAt: string;
};

export type BookingAvailabilityPreview = {
  readonly bookableTimes: readonly BookableTimePreview[];
  readonly cutoffAt: string;
  readonly source: 'lab-seeded-candidate-times';
};

export type BookingPreferencesPort = {
  readonly depositAmountPresets: typeof DEPOSIT_PRESET_CENTS;
  readonly implementation: 'lab-only';
  readonly minimumNoticePresets: typeof MINIMUM_NOTICE_PRESET_MINUTES;
  getCustomMinimumNoticeInput: (
    minimumNoticeMinutes: number,
  ) => { amount: string; unit: MinimumNoticeUnit };
  getDepositAmountChoice: (
    amountCents: number | null,
  ) => DepositAmountChoice;
  getMinimumNoticeChoice: (
    minimumNoticeMinutes: number,
  ) => MinimumNoticeChoice;
  getAvailabilityPreview: (
    minimumNoticeMinutes: number,
    previewTimestamp: string,
  ) => BookingAvailabilityPreview;
  normalizeCustomDepositAmount: (amount: string) => number | null;
  normalizeCustomMinimumNotice: (
    amount: string,
    unit: MinimumNoticeUnit,
  ) => number | null;
  normalizeDepositDraft: (draft: DepositDraft) => DepositDraft;
  updateDepositDraft: (
    draft: DepositDraft,
    patch: Partial<Omit<DepositDraft, 'legacyV5Archive'>>,
  ) => DepositDraft;
};

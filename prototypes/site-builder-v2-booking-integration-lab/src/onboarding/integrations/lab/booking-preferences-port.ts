import {
  type BookingPreferencesPort,
  DEPOSIT_PRESET_CENTS,
  type DepositDraft,
  MINIMUM_NOTICE_PRESET_MINUTES,
} from '../contracts/booking-preferences';
import { createLabBookingAvailabilityPreview } from './booking-availability-preview';

const MAXIMUM_NOTICE_MINUTES = 365 * 24 * 60;
const MAXIMUM_DEPOSIT_CENTS = 100_000_00;

const finiteWholeNumber = (value: number): number => Number.isFinite(value)
  ? Math.max(0, Math.round(value))
  : 0;

const normalizeMinimumNoticeMinutes = (value: number): number => Math.min(
  finiteWholeNumber(value),
  MAXIMUM_NOTICE_MINUTES,
);

const normalizeAmountCents = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(finiteWholeNumber(value), MAXIMUM_DEPOSIT_CENTS);
};

const normalizeDepositDraft = (draft: DepositDraft): DepositDraft => ({
  amountCents: normalizeAmountCents(draft.amountCents),
  ...(draft.legacyV5Archive ? { legacyV5Archive: { ...draft.legacyV5Archive } } : {}),
  mode: draft.mode === 'fixed' ? 'fixed' : 'none',
  refundable: typeof draft.refundable === 'boolean' ? draft.refundable : null,
  transferable: typeof draft.transferable === 'boolean' ? draft.transferable : null,
  wordingOverride: draft.wordingOverride,
});

export const createLabBookingPreferencesPort = (): BookingPreferencesPort => ({
  depositAmountPresets: DEPOSIT_PRESET_CENTS,
  implementation: 'lab-only',
  minimumNoticePresets: MINIMUM_NOTICE_PRESET_MINUTES,
  getAvailabilityPreview: createLabBookingAvailabilityPreview,
  getCustomMinimumNoticeInput: (minimumNoticeMinutes) => {
    const normalized = normalizeMinimumNoticeMinutes(minimumNoticeMinutes);
    if (normalized >= 1_440) {
      return { amount: String(normalized / 1_440), unit: 'days' };
    }
    return { amount: normalized > 0 ? String(normalized / 60) : '', unit: 'hours' };
  },
  getDepositAmountChoice: amountCents => amountCents !== null
    && DEPOSIT_PRESET_CENTS.includes(amountCents as typeof DEPOSIT_PRESET_CENTS[number])
    ? `preset:${amountCents as typeof DEPOSIT_PRESET_CENTS[number]}`
    : 'custom',
  getMinimumNoticeChoice: (minimumNoticeMinutes) => {
    const normalized = normalizeMinimumNoticeMinutes(minimumNoticeMinutes);
    return MINIMUM_NOTICE_PRESET_MINUTES.includes(
      normalized as typeof MINIMUM_NOTICE_PRESET_MINUTES[number],
    )
      ? `preset:${normalized as typeof MINIMUM_NOTICE_PRESET_MINUTES[number]}`
      : 'custom';
  },
  normalizeCustomDepositAmount: (amount) => {
    const trimmed = amount.trim().replace(/^\$/u, '');
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0
      ? normalizeAmountCents(parsed * 100)
      : null;
  },
  normalizeCustomMinimumNotice: (amount, unit) => {
    const trimmed = amount.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    const multiplier = unit === 'days' ? 1_440 : 60;
    return normalizeMinimumNoticeMinutes(parsed * multiplier);
  },
  normalizeDepositDraft,
  updateDepositDraft: (draft, patch) => normalizeDepositDraft({
    ...draft,
    ...patch,
  }),
});

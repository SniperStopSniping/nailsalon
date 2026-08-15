import { z } from 'zod';

import {
  type CheckoutTotals,
  computeCheckoutTotals,
  computeInclusiveTaxCents,
  MAX_SUPPORTED_MINOR_UNIT_AMOUNT,
  type ResolvedTaxConfig,
} from '@/libs/checkoutTotals';
import { salonDepositSettingsSchema, storedDepositSettingsSchema } from '@/libs/depositPolicy';
import { getDateKeyInTimeZone, zonedTimeToUtc } from '@/libs/timeZone';
import type { SalonSettings } from '@/types/salonPolicy';

/**
 * Salon-level payments settings, stored under `salon.settings.payments`.
 *
 * Tax is OFF by default for every salon (existing and new) and is never
 * inferred from the salon address — an owner must explicitly enable it.
 * Changing these settings never recalculates completed appointments; the
 * completion write snapshots the resolved config onto the appointment row.
 */

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const normalized = new Date(Date.UTC(year!, month! - 1, day!));
  return normalized.getUTCFullYear() === year
    && normalized.getUTCMonth() === month! - 1
    && normalized.getUTCDate() === day;
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const scheduledTaxChangeSchema = z.object({
  rateBps: z.number().int().min(0).max(30000),
  name: z.string().trim().max(40).optional(),
  effectiveFrom: z.string().max(64).refine(value => Number.isFinite(Date.parse(value)), {
    message: 'effectiveFrom must be an ISO date',
  }),
  /** Server-derived salon-local calendar identity for new writes. */
  effectiveDate: z.string().refine(isValidCalendarDate, {
    message: 'effectiveDate must be a valid YYYY-MM-DD date',
  }).optional(),
  /** Server-derived IANA zone paired with effectiveDate. */
  effectiveTimeZone: z.string().trim().max(100).refine(isValidTimeZone, {
    message: 'effectiveTimeZone must be a valid IANA timezone',
  }).optional(),
}).superRefine((value, context) => {
  if ((value.effectiveDate === undefined) !== (value.effectiveTimeZone === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'effectiveDate and effectiveTimeZone must be stored together',
    });
    return;
  }
  if (value.effectiveDate && value.effectiveTimeZone) {
    const expected = zonedTimeToUtc({
      date: value.effectiveDate,
      time: '00:00',
      timeZone: value.effectiveTimeZone,
    });
    if (expected.getTime() !== Date.parse(value.effectiveFrom)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'effectiveFrom must be midnight on effectiveDate in effectiveTimeZone',
      });
    }
  }
});

export const salonTaxSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  /** Display name, e.g. "HST", "GST". */
  name: z.string().trim().max(40).optional(),
  /** Basis points: 13% = 1300. */
  rateBps: z.number().int().min(0).max(30000).optional(),
  /** true = listed prices include tax; false = tax added at checkout. */
  pricesIncludeTax: z.boolean().optional(),
  taxServicesByDefault: z.boolean().optional(),
  taxAddOnsByDefault: z.boolean().optional(),
  taxCustomByDefault: z.boolean().optional(),
  /** Explicit owner opt-in; missing/legacy values always resolve false. */
  forfeitureTaxEstimationEnabled: z.boolean().optional(),
  /** Salon-entered reporting metadata; Luster never infers legal treatment. */
  jurisdiction: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  region: z.string().trim().max(120).optional(),
  /** A future rate change; applies once `effectiveFrom` (ISO date) passes. */
  scheduledChange: scheduledTaxChangeSchema.nullable().optional(),
});

export const salonEtransferSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  /** Email address or mobile number that receives Interac e-Transfers. */
  recipient: z.string().trim().max(200).optional(),
  /** Name shown to clients ("payments go to ..."). */
  recipientName: z.string().trim().max(120).optional(),
  /** Informational only — we never verify or claim bank confirmation. */
  autodepositEnabled: z.boolean().optional(),
  instructions: z.string().trim().max(1000).optional(),
  requireReference: z.boolean().optional(),
  qrPageEnabled: z.boolean().optional(),
});

/**
 * STORED-READ shape. Deliberately permissive on `deposit`: privileged
 * whole-column `settings` writers never run the write validator below, so an
 * out-of-window stored amount must stay READABLE — and be rejected by the
 * deposit read-time gate — rather than collapsing the block.
 */
export const salonPaymentsSettingsSchema = z.object({
  tax: salonTaxSettingsSchema.optional(),
  etransfer: salonEtransferSettingsSchema.optional(),
  deposit: storedDepositSettingsSchema.optional(),
});

/**
 * WRITE shape for the admin PATCH. Distinct from the stored shape because the
 * deposit amount is bounded on both sides here; pointing the route's validator
 * at the stored schema would accept `amountCents: 0 / 49 / 99_999_999`.
 */
export const salonPaymentsSettingsWriteSchema = z.object({
  tax: salonTaxSettingsSchema.optional(),
  etransfer: salonEtransferSettingsSchema.optional(),
  deposit: salonDepositSettingsSchema.optional(),
});

export type SalonTaxSettings = z.infer<typeof salonTaxSettingsSchema>;
export type SalonEtransferSettings = z.infer<typeof salonEtransferSettingsSchema>;
export type SalonPaymentsSettings = z.infer<typeof salonPaymentsSettingsSchema>;
export type SalonPaymentsSettingsWrite = z.infer<typeof salonPaymentsSettingsWriteSchema>;

/**
 * Convert the owner-selected calendar date into an unambiguous instant at
 * midnight in the salon timezone. `effectiveDate` and `effectiveTimeZone` are
 * server-derived evidence: callers cannot make a UTC/browser-local timestamp
 * masquerade as the salon's intended date.
 */
export function normalizeTaxSettingsForTimeZone(
  update: SalonTaxSettings,
  timeZone: string,
): SalonTaxSettings {
  const scheduled = update.scheduledChange;
  if (!scheduled) {
    return update;
  }
  if (!isValidTimeZone(timeZone)) {
    throw new TypeError('Tax schedule timezone must be a valid IANA timezone');
  }

  const naiveCalendarDate = scheduled.effectiveFrom.match(
    /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?)?$/,
  )?.[1];
  const effectiveDate = scheduled.effectiveDate
    ?? naiveCalendarDate
    ?? getDateKeyInTimeZone(new Date(scheduled.effectiveFrom), timeZone);
  if (!isValidCalendarDate(effectiveDate)) {
    throw new TypeError('Tax schedule date must be a valid YYYY-MM-DD date');
  }

  const effectiveFrom = zonedTimeToUtc({
    date: effectiveDate,
    time: '00:00',
    timeZone,
  }).toISOString();

  return salonTaxSettingsSchema.parse({
    ...update,
    scheduledChange: {
      ...scheduled,
      effectiveFrom,
      effectiveDate,
      effectiveTimeZone: timeZone,
    },
  });
}

export const TAX_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const TAX_CONFIGURATION_IDENTITY_VERSION = 1 as const;

export type TaxConfigurationSnapshot = {
  enabled: boolean;
  label: string | null;
  rateBps: number;
  mode: 'included' | 'added';
  taxServicesByDefault: boolean;
  taxAddOnsByDefault: boolean;
  taxCustomByDefault: boolean;
  forfeitureTaxEstimationEnabled: boolean;
  configurationSource: ResolvedTaxConfig['configurationSource'];
  configurationEffectiveFrom: string | null;
  configurationEffectiveDate: string | null;
  configurationTimeZone: string | null;
  configurationIdentityVersion: typeof TAX_CONFIGURATION_IDENTITY_VERSION;
  configurationIdentity: string;
  jurisdiction: string | null;
  country: string | null;
  region: string | null;
};

type InvoiceTaxSnapshot = {
  schemaVersion: typeof TAX_SNAPSHOT_SCHEMA_VERSION;
  capturedAt: string;
  /** Uppercase ISO 4217 identity for every minor-unit amount in this snapshot. */
  currency: string;
  configuration: TaxConfigurationSnapshot;
  taxApplied: boolean;
  taxableSubtotalCents: number;
  taxAmountCents: number;
  /** Net-of-tax, post-discount service amount. Tips are deliberately excluded. */
  serviceSubtotalCents: number;
  /** Service subtotal plus tax. Deposit credit and tip are deliberately excluded. */
  invoiceTotalCents: number;
};

export type BookingTaxSnapshot = InvoiceTaxSnapshot & {
  kind: 'booking_estimate';
  classification: 'estimate';
};

/**
 * Which immutable appointment snapshot currently owns invoice money.
 *
 * The original booking estimate is permanent evidence and is never rewritten.
 * An in-place reschedule writes a separate latest estimate, while completion
 * always wins with the final actual snapshot.
 */
export type ActiveInvoiceTaxSnapshotSelection =
  | { source: 'final'; snapshot: FinalTaxSnapshot }
  | { source: 'reschedule'; snapshot: BookingTaxSnapshot }
  | { source: 'booking'; snapshot: BookingTaxSnapshot }
  | { source: 'historical'; snapshot: null };

export type FinalTaxSnapshot = InvoiceTaxSnapshot & {
  kind: 'final_actual';
  classification: 'actual';
  taxExempt: boolean;
  taxExemptReason: string | null;
};

export type ForfeitureTaxSnapshot = {
  schemaVersion: typeof TAX_SNAPSHOT_SCHEMA_VERSION;
  kind: 'forfeiture_estimate';
  classification: 'estimate';
  capturedAt: string;
  currency: string;
  configuration: TaxConfigurationSnapshot;
  grossForfeitedCents: number;
  taxEstimateApplied: boolean;
  estimatedTaxIncludedCents: number;
  estimatedNetCents: number;
};

export function selectActiveInvoiceTaxSnapshot(input: {
  finalTaxSnapshot: FinalTaxSnapshot | null;
  rescheduleTaxSnapshot: BookingTaxSnapshot | null;
  bookingTaxSnapshot: BookingTaxSnapshot | null;
}): ActiveInvoiceTaxSnapshotSelection {
  if (input.finalTaxSnapshot !== null) {
    return { source: 'final', snapshot: input.finalTaxSnapshot };
  }
  if (input.rescheduleTaxSnapshot !== null) {
    return { source: 'reschedule', snapshot: input.rescheduleTaxSnapshot };
  }
  if (input.bookingTaxSnapshot !== null) {
    return { source: 'booking', snapshot: input.bookingTaxSnapshot };
  }
  return { source: 'historical', snapshot: null };
}

/**
 * Read the stored payments settings for editing surfaces. Each sub-object is
 * parsed INDEPENDENTLY so one malformed block collapses only itself and never
 * its siblings — a legacy `tax` value must not be able to hide a stored
 * e-Transfer recipient or deposit amount.
 */
export function readStoredPaymentsSettings(
  settings: SalonSettings | null | undefined,
): SalonPaymentsSettings {
  const raw = (settings as { payments?: unknown } | null | undefined)?.payments;
  const container = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  const result: SalonPaymentsSettings = {};

  if (container.tax !== undefined) {
    const parsed = salonTaxSettingsSchema.safeParse(container.tax);
    if (parsed.success) {
      result.tax = parsed.data;
    }
  }
  if (container.etransfer !== undefined) {
    const parsed = salonEtransferSettingsSchema.safeParse(container.etransfer);
    if (parsed.success) {
      result.etransfer = parsed.data;
    }
  }
  if (container.deposit !== undefined) {
    const parsed = storedDepositSettingsSchema.safeParse(container.deposit);
    if (parsed.success) {
      result.deposit = parsed.data;
    }
  }

  return result;
}

/**
 * Merge a payments-settings update into the stored value. Each sub-object
 * (tax / etransfer / deposit) merges field-by-field so a partial save never
 * drops the other card's values; `scheduledChange: null` explicitly clears a
 * scheduled rate change.
 *
 * The `deposit` arm is NOT cosmetic. It is the only source of "the value this
 * request merged" that the settings route's `jsonb_set` chain writes, and
 * `jsonb_set` is STRICT: an `undefined` amount stringifies to `undefined`,
 * binds as NULL, and turns the whole `settings` column NULL with a 200.
 */
export function mergePaymentsSettings(
  current: SalonPaymentsSettings,
  update: SalonPaymentsSettingsWrite,
): SalonPaymentsSettings {
  return {
    tax: update.tax ? { ...current.tax, ...update.tax } : current.tax,
    etransfer: update.etransfer
      ? { ...current.etransfer, ...update.etransfer }
      : current.etransfer,
    deposit: update.deposit ? { ...current.deposit, ...update.deposit } : current.deposit,
  };
}

export const DISABLED_TAX_CONFIG: ResolvedTaxConfig = {
  enabled: false,
  name: null,
  rateBps: 0,
  pricesIncludeTax: false,
  taxServicesByDefault: true,
  taxAddOnsByDefault: true,
  taxCustomByDefault: true,
  forfeitureTaxEstimationEnabled: false,
  configurationSource: 'default',
  configurationEffectiveFrom: null,
  configurationEffectiveDate: null,
  configurationTimeZone: null,
  jurisdiction: null,
  country: null,
  region: null,
};

function normalizedMetadata(value: string | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Resolve the tax configuration effective at `at` (checkout time). Tolerates
 * missing/legacy settings shapes by treating them as tax-off.
 */
export function resolveTaxConfig(
  settings: SalonSettings | null | undefined,
  at: Date,
): ResolvedTaxConfig {
  const parsed = salonTaxSettingsSchema.safeParse(settings?.payments?.tax ?? {});
  if (!parsed.success) {
    return DISABLED_TAX_CONFIG;
  }
  const tax = parsed.data;
  if (!tax.enabled) {
    const hasStoredConfiguration = Object.keys(tax).length > 0;
    return {
      enabled: false,
      name: normalizedMetadata(tax.name),
      rateBps: tax.rateBps ?? 0,
      pricesIncludeTax: tax.pricesIncludeTax ?? false,
      taxServicesByDefault: tax.taxServicesByDefault ?? true,
      taxAddOnsByDefault: tax.taxAddOnsByDefault ?? true,
      taxCustomByDefault: tax.taxCustomByDefault ?? true,
      forfeitureTaxEstimationEnabled:
        tax.forfeitureTaxEstimationEnabled ?? false,
      configurationSource: hasStoredConfiguration ? 'base' : 'default',
      configurationEffectiveFrom: null,
      configurationEffectiveDate: null,
      configurationTimeZone: null,
      jurisdiction: normalizedMetadata(tax.jurisdiction),
      country: normalizedMetadata(tax.country),
      region: normalizedMetadata(tax.region),
    };
  }

  let rateBps = tax.rateBps ?? 0;
  let name = tax.name?.trim() || 'Tax';
  let configurationSource: ResolvedTaxConfig['configurationSource'] = 'base';
  let configurationEffectiveFrom: string | null = null;
  let configurationEffectiveDate: string | null = null;
  let configurationTimeZone: string | null = null;
  const scheduled = tax.scheduledChange;
  if (scheduled && at.getTime() >= Date.parse(scheduled.effectiveFrom)) {
    rateBps = scheduled.rateBps;
    configurationSource = 'scheduled_change';
    configurationEffectiveFrom = new Date(scheduled.effectiveFrom).toISOString();
    configurationEffectiveDate = scheduled.effectiveDate ?? null;
    configurationTimeZone = scheduled.effectiveTimeZone ?? null;
    if (scheduled.name?.trim()) {
      name = scheduled.name.trim();
    }
  }

  return {
    enabled: true,
    name,
    rateBps,
    pricesIncludeTax: tax.pricesIncludeTax ?? false,
    taxServicesByDefault: tax.taxServicesByDefault ?? true,
    taxAddOnsByDefault: tax.taxAddOnsByDefault ?? true,
    taxCustomByDefault: tax.taxCustomByDefault ?? true,
    forfeitureTaxEstimationEnabled:
      tax.forfeitureTaxEstimationEnabled ?? false,
    configurationSource,
    configurationEffectiveFrom,
    configurationEffectiveDate,
    configurationTimeZone,
    jurisdiction: normalizedMetadata(tax.jurisdiction),
    country: normalizedMetadata(tax.country),
    region: normalizedMetadata(tax.region),
  };
}

function assertMinorUnits(label: string, value: number): void {
  if (
    !Number.isSafeInteger(value)
    || value < 0
    || value > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
  ) {
    throw new TypeError(`${label} is outside the supported minor-unit range`);
  }
}

function snapshotTimestamp(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Tax snapshot timestamp must be a valid Date');
  }
  return value.toISOString();
}

function snapshotCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new TypeError('Tax snapshot currency must be a three-letter ISO code');
  }
  return normalized;
}

type TaxConfigurationIdentityFields = Omit<
  TaxConfigurationSnapshot,
  'configurationIdentityVersion' | 'configurationIdentity'
>;

/**
 * Collision-free semantic identity. This deliberately stores the canonical
 * field tuple rather than a short non-cryptographic hash: equal identities
 * mean every money-affecting configuration field is exactly equal.
 */
export function buildTaxConfigurationIdentity(
  configuration: TaxConfigurationIdentityFields,
): string {
  return `tax-config:v${TAX_CONFIGURATION_IDENTITY_VERSION}:${JSON.stringify([
    configuration.enabled,
    configuration.label,
    configuration.rateBps,
    configuration.mode,
    configuration.taxServicesByDefault,
    configuration.taxAddOnsByDefault,
    configuration.taxCustomByDefault,
    configuration.forfeitureTaxEstimationEnabled,
    configuration.configurationSource,
    configuration.configurationEffectiveFrom,
    configuration.configurationEffectiveDate,
    configuration.configurationTimeZone,
    configuration.jurisdiction,
    configuration.country,
    configuration.region,
  ])}`;
}

function configurationEffectiveIdentity(
  taxConfig: ResolvedTaxConfig,
): Pick<
    TaxConfigurationSnapshot,
  'configurationEffectiveFrom' | 'configurationEffectiveDate' | 'configurationTimeZone'
  > {
  const effectiveDate = taxConfig.configurationEffectiveDate ?? null;
  const timeZone = taxConfig.configurationTimeZone ?? null;
  if (taxConfig.configurationSource !== 'scheduled_change') {
    if (
      taxConfig.configurationEffectiveFrom !== null
      || effectiveDate !== null
      || timeZone !== null
    ) {
      throw new TypeError('Base/default tax configuration cannot claim a scheduled effective identity');
    }
    return {
      configurationEffectiveFrom: null,
      configurationEffectiveDate: null,
      configurationTimeZone: null,
    };
  }

  if (
    typeof taxConfig.configurationEffectiveFrom !== 'string'
    || !Number.isFinite(Date.parse(taxConfig.configurationEffectiveFrom))
  ) {
    throw new TypeError('Scheduled tax configuration requires a valid effective instant');
  }
  const effectiveFrom = new Date(taxConfig.configurationEffectiveFrom).toISOString();
  if ((effectiveDate === null) !== (timeZone === null)) {
    throw new TypeError('Scheduled tax effective date and timezone must be stored together');
  }
  if (effectiveDate !== null && timeZone !== null) {
    if (!isValidCalendarDate(effectiveDate) || !isValidTimeZone(timeZone)) {
      throw new TypeError('Scheduled tax effective identity is invalid');
    }
    if (zonedTimeToUtc({ date: effectiveDate, time: '00:00', timeZone }).toISOString() !== effectiveFrom) {
      throw new TypeError('Scheduled tax effective identity does not match its instant');
    }
  }
  return {
    configurationEffectiveFrom: effectiveFrom,
    configurationEffectiveDate: effectiveDate,
    configurationTimeZone: timeZone,
  };
}

export function buildTaxConfigurationSnapshot(
  taxConfig: ResolvedTaxConfig,
): TaxConfigurationSnapshot {
  const identity = configurationEffectiveIdentity(taxConfig);
  const fields: TaxConfigurationIdentityFields = {
    enabled: taxConfig.enabled,
    label: taxConfig.name,
    rateBps: taxConfig.rateBps,
    mode: taxConfig.pricesIncludeTax ? 'included' : 'added',
    taxServicesByDefault: taxConfig.taxServicesByDefault,
    taxAddOnsByDefault: taxConfig.taxAddOnsByDefault,
    taxCustomByDefault: taxConfig.taxCustomByDefault,
    forfeitureTaxEstimationEnabled:
      taxConfig.forfeitureTaxEstimationEnabled ?? false,
    configurationSource: taxConfig.configurationSource,
    ...identity,
    jurisdiction: taxConfig.jurisdiction,
    country: taxConfig.country,
    region: taxConfig.region,
  };
  const snapshot: TaxConfigurationSnapshot = {
    ...fields,
    configurationIdentityVersion: TAX_CONFIGURATION_IDENTITY_VERSION,
    configurationIdentity: buildTaxConfigurationIdentity(fields),
  };
  const validation = validateTaxConfigurationSnapshot(snapshot);
  if (!validation.ok) {
    throw new TypeError(`Invalid tax configuration snapshot: ${validation.detail}`);
  }
  return snapshot;
}

function canonicalJurisdictionToken(value: string | null): string {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * D6.1's reviewed forfeiture-estimate treatment is deliberately a small,
 * explicit registry. A tax rate, label, or enabled flag never implies a legal
 * jurisdiction. Unknown/free-text locations retain gross-only reporting.
 */
export function hasReviewedForfeitureTaxTreatment(
  taxConfig: Pick<ResolvedTaxConfig, 'country' | 'region'>,
): boolean {
  const country = canonicalJurisdictionToken(taxConfig.country);
  const region = canonicalJurisdictionToken(taxConfig.region);
  return (country === 'CA' || country === 'CAN' || country === 'CANADA')
    && (region === 'ON' || region === 'ONTARIO');
}

export const TAX_SNAPSHOT_VALIDATION_CODES = [
  'TAX_SNAPSHOT_INVALID_SHAPE',
  'TAX_SNAPSHOT_SCHEMA_UNSUPPORTED',
  'TAX_SNAPSHOT_KIND_MISMATCH',
  'TAX_SNAPSHOT_CLASSIFICATION_MISMATCH',
  'TAX_SNAPSHOT_TIMESTAMP_INVALID',
  'TAX_SNAPSHOT_CURRENCY_MISMATCH',
  'TAX_SNAPSHOT_CONFIGURATION_INVALID',
  'TAX_SNAPSHOT_CONFIGURATION_IDENTITY_MISMATCH',
  'TAX_SNAPSHOT_MONEY_INVALID',
  'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
] as const;

export type TaxSnapshotValidationCode
  = (typeof TAX_SNAPSHOT_VALIDATION_CODES)[number];

export type TaxSnapshotValidationFailure = {
  ok: false;
  code: TaxSnapshotValidationCode;
  detail: string;
};

export type TaxConfigurationSnapshotValidation =
  | { ok: true; configuration: TaxConfigurationSnapshot }
  | TaxSnapshotValidationFailure;

export type InvoiceTaxSnapshotValidation =
  | {
    ok: true;
    snapshot: BookingTaxSnapshot | FinalTaxSnapshot;
    /** Normalized inputs for the canonical invoice/deposit balance resolver. */
    invoiceMoney: {
      invoiceCurrency: string;
      finalPriceCents: number;
      taxAmountCents: number;
      taxableSubtotalCents: number;
      serviceInvoiceTotalCents: number;
    };
  }
  | TaxSnapshotValidationFailure;

export type ForfeitureTaxSnapshotValidation =
  | { ok: true; snapshot: ForfeitureTaxSnapshot }
  | TaxSnapshotValidationFailure;

export type ExpectedInvoiceTaxScalars = {
  /** appointment.final_price_cents */
  finalPriceCents?: number | null;
  /** appointment.taxable_subtotal_cents */
  taxableSubtotalCents?: number | null;
  /** appointment.tax_amount_cents */
  taxAmountCents?: number | null;
  /** appointment.tax_exempt */
  taxExempt?: boolean | null;
  /** appointment.tax_exempt_reason */
  taxExemptReason?: string | null;
  /** Optional independently persisted service+tax invoice total. */
  serviceInvoiceTotalCents?: number | null;
  /**
   * appointment.total_price at booking: net service subtotal in added mode,
   * gross service invoice (including decomposed tax) in included mode.
   */
  bookingTotalPriceCents?: number | null;
};

export type ValidateInvoiceTaxSnapshotOptions = {
  expectedKind?: BookingTaxSnapshot['kind'] | FinalTaxSnapshot['kind'];
  expectedCurrency?: string | null;
  expectedScalars?: ExpectedInvoiceTaxScalars;
};

function invalidSnapshot(
  code: TaxSnapshotValidationCode,
  detail: string,
): TaxSnapshotValidationFailure {
  return { ok: false, code, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  return new Date(value).toISOString() === value;
}

function isBoundedNullableString(
  value: unknown,
  maxLength: number,
): value is string | null {
  return value === null
    || (
      typeof value === 'string'
      && value.length <= maxLength
      && value.trim() === value
    );
}

/** Shared configuration validator used by every persisted tax-snapshot gate. */
export function validateTaxConfigurationSnapshot(
  input: unknown,
): TaxConfigurationSnapshotValidation {
  if (!isRecord(input)) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CONFIGURATION_INVALID',
      'Tax snapshot configuration must be an object.',
    );
  }
  const rateBps = input.rateBps;
  if (
    typeof input.enabled !== 'boolean'
    || !isBoundedNullableString(input.label, 40)
    || !Number.isSafeInteger(rateBps)
    || (rateBps as number) < 0
    || (rateBps as number) > 30_000
    || (input.mode !== 'included' && input.mode !== 'added')
    || typeof input.taxServicesByDefault !== 'boolean'
    || typeof input.taxAddOnsByDefault !== 'boolean'
    || typeof input.taxCustomByDefault !== 'boolean'
    || typeof input.forfeitureTaxEstimationEnabled !== 'boolean'
    || !['default', 'base', 'scheduled_change'].includes(
      input.configurationSource as string,
    )
    || !isBoundedNullableString(input.jurisdiction, 120)
    || !isBoundedNullableString(input.country, 120)
    || !isBoundedNullableString(input.region, 120)
  ) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CONFIGURATION_INVALID',
      'Tax snapshot configuration fields are invalid.',
    );
  }

  const effectiveFrom = input.configurationEffectiveFrom;
  const effectiveDate = input.configurationEffectiveDate;
  const timeZone = input.configurationTimeZone;
  if (input.configurationSource === 'scheduled_change') {
    if (!isCanonicalIsoTimestamp(effectiveFrom)) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_CONFIGURATION_INVALID',
        'Scheduled tax configuration requires a canonical effective instant.',
      );
    }
    const hasEffectiveDate = effectiveDate !== null;
    const hasTimeZone = timeZone !== null;
    if (hasEffectiveDate !== hasTimeZone) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_CONFIGURATION_INVALID',
        'Scheduled tax effective date and timezone must be stored together.',
      );
    }
    if (hasEffectiveDate) {
      if (
        typeof effectiveDate !== 'string'
        || !isValidCalendarDate(effectiveDate)
        || typeof timeZone !== 'string'
        || !isValidTimeZone(timeZone)
        || zonedTimeToUtc({ date: effectiveDate, time: '00:00', timeZone }).toISOString()
        !== effectiveFrom
      ) {
        return invalidSnapshot(
          'TAX_SNAPSHOT_CONFIGURATION_INVALID',
          'Scheduled tax effective identity does not match its salon-local instant.',
        );
      }
    }
  } else if (effectiveFrom !== null || effectiveDate !== null || timeZone !== null) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CONFIGURATION_INVALID',
      'Base/default tax configuration cannot claim a scheduled effective identity.',
    );
  }

  if (
    input.configurationIdentityVersion !== TAX_CONFIGURATION_IDENTITY_VERSION
    || typeof input.configurationIdentity !== 'string'
  ) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CONFIGURATION_IDENTITY_MISMATCH',
      'Tax configuration identity version is missing or unsupported.',
    );
  }

  const fields: TaxConfigurationIdentityFields = {
    enabled: input.enabled,
    label: input.label,
    rateBps: rateBps as number,
    mode: input.mode,
    taxServicesByDefault: input.taxServicesByDefault,
    taxAddOnsByDefault: input.taxAddOnsByDefault,
    taxCustomByDefault: input.taxCustomByDefault,
    forfeitureTaxEstimationEnabled: input.forfeitureTaxEstimationEnabled,
    configurationSource: input.configurationSource as ResolvedTaxConfig['configurationSource'],
    configurationEffectiveFrom: effectiveFrom as string | null,
    configurationEffectiveDate: effectiveDate as string | null,
    configurationTimeZone: timeZone as string | null,
    jurisdiction: input.jurisdiction,
    country: input.country,
    region: input.region,
  };
  if (input.configurationIdentity !== buildTaxConfigurationIdentity(fields)) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CONFIGURATION_IDENTITY_MISMATCH',
      'Tax configuration identity does not match its persisted fields.',
    );
  }

  return { ok: true, configuration: input as unknown as TaxConfigurationSnapshot };
}

/**
 * Canonical runtime gate for booking-estimate and final-actual snapshots.
 * Money consumers use this before trusting persisted JSONB amounts.
 */
export function validateInvoiceTaxSnapshot(
  input: unknown,
  options: ValidateInvoiceTaxSnapshotOptions = {},
): InvoiceTaxSnapshotValidation {
  if (!isRecord(input)) {
    return invalidSnapshot('TAX_SNAPSHOT_INVALID_SHAPE', 'Tax snapshot must be an object.');
  }
  if (input.schemaVersion !== TAX_SNAPSHOT_SCHEMA_VERSION) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_SCHEMA_UNSUPPORTED',
      'Tax snapshot schema version is missing or unsupported.',
    );
  }
  if (input.kind !== 'booking_estimate' && input.kind !== 'final_actual') {
    return invalidSnapshot('TAX_SNAPSHOT_KIND_MISMATCH', 'Tax snapshot kind is invalid.');
  }
  if (options.expectedKind && input.kind !== options.expectedKind) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_KIND_MISMATCH',
      `Expected ${options.expectedKind}, received ${input.kind}.`,
    );
  }
  const expectedClassification = input.kind === 'booking_estimate' ? 'estimate' : 'actual';
  if (input.classification !== expectedClassification) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CLASSIFICATION_MISMATCH',
      'Tax snapshot classification does not match its kind.',
    );
  }
  if (!isCanonicalIsoTimestamp(input.capturedAt)) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_TIMESTAMP_INVALID',
      'Tax snapshot timestamp must be a canonical ISO instant.',
    );
  }
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CURRENCY_MISMATCH',
      'Tax snapshot currency must be an uppercase three-letter ISO code.',
    );
  }
  if (options.expectedCurrency !== undefined && options.expectedCurrency !== null) {
    const expectedCurrency = options.expectedCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(expectedCurrency) || input.currency !== expectedCurrency) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_CURRENCY_MISMATCH',
        'Tax snapshot currency does not match the frozen invoice currency.',
      );
    }
  }

  const configuration = validateTaxConfigurationSnapshot(input.configuration);
  if (!configuration.ok) {
    return configuration;
  }

  if (
    typeof input.taxApplied !== 'boolean'
    || !Number.isSafeInteger(input.taxableSubtotalCents)
    || (input.taxableSubtotalCents as number) < 0
    || (input.taxableSubtotalCents as number) > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    || !Number.isSafeInteger(input.taxAmountCents)
    || (input.taxAmountCents as number) < 0
    || (input.taxAmountCents as number) > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    || !Number.isSafeInteger(input.serviceSubtotalCents)
    || (input.serviceSubtotalCents as number) < 0
    || (input.serviceSubtotalCents as number) > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    || !Number.isSafeInteger(input.invoiceTotalCents)
    || (input.invoiceTotalCents as number) < 0
    || (input.invoiceTotalCents as number) > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
  ) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_MONEY_INVALID',
      'Tax snapshot money fields must be non-negative safe integers.',
    );
  }

  let taxExempt = false;
  if (input.kind === 'final_actual') {
    if (
      typeof input.taxExempt !== 'boolean'
      || !isBoundedNullableString(input.taxExemptReason, 1000)
      || (!input.taxExempt && input.taxExemptReason !== null)
    ) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_INVALID_SHAPE',
        'Final tax exemption fields are invalid.',
      );
    }
    taxExempt = input.taxExempt;
  }

  const expectedScalars = options.expectedScalars;
  if (expectedScalars) {
    const scalarPairs: Array<[string, unknown, unknown]> = [
      ['final price', expectedScalars.finalPriceCents, input.serviceSubtotalCents],
      ['taxable subtotal', expectedScalars.taxableSubtotalCents, input.taxableSubtotalCents],
      ['tax amount', expectedScalars.taxAmountCents, input.taxAmountCents],
      ['service invoice total', expectedScalars.serviceInvoiceTotalCents, input.invoiceTotalCents],
    ];
    for (const [label, expected, actual] of scalarPairs) {
      if (expected !== undefined && expected !== actual) {
        return invalidSnapshot(
          'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
          `Persisted ${label} does not match the tax snapshot.`,
        );
      }
    }
    if (
      expectedScalars.taxExempt !== undefined
      && expectedScalars.taxExempt !== (input.kind === 'final_actual' ? input.taxExempt : false)
    ) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
        'Persisted tax-exempt state does not match the tax snapshot.',
      );
    }
    if (
      expectedScalars.taxExemptReason !== undefined
      && expectedScalars.taxExemptReason
      !== (input.kind === 'final_actual' ? input.taxExemptReason : null)
    ) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
        'Persisted tax-exempt reason does not match the tax snapshot.',
      );
    }
  }

  const config = configuration.configuration;
  const expectedTaxApplied = config.enabled && config.rateBps > 0 && !taxExempt;
  if (input.taxApplied !== expectedTaxApplied) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Tax-applied state does not match the frozen configuration and exemption.',
    );
  }

  if (expectedScalars?.bookingTotalPriceCents !== undefined) {
    const bookingComparable = config.mode === 'included'
      ? input.invoiceTotalCents
      : input.serviceSubtotalCents;
    if (expectedScalars.bookingTotalPriceCents !== bookingComparable) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
        'Frozen booked total does not match the booking tax snapshot semantics.',
      );
    }
  }

  const serviceSubtotalCents = input.serviceSubtotalCents as number;
  const taxAmountCents = input.taxAmountCents as number;
  const invoiceTotalCents = serviceSubtotalCents + taxAmountCents;
  if (!Number.isSafeInteger(invoiceTotalCents) || invoiceTotalCents !== input.invoiceTotalCents) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Invoice total does not equal service subtotal plus tax.',
    );
  }
  const taxableSubtotalCents = input.taxableSubtotalCents as number;
  const maximumTaxablePoolCents = config.mode === 'included'
    ? invoiceTotalCents
    : serviceSubtotalCents;
  if (taxableSubtotalCents > maximumTaxablePoolCents) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Taxable subtotal exceeds the displayed service amount for the frozen tax mode.',
    );
  }

  const taxConfig: ResolvedTaxConfig = {
    enabled: config.enabled,
    name: config.label,
    rateBps: config.rateBps,
    pricesIncludeTax: config.mode === 'included',
    taxServicesByDefault: config.taxServicesByDefault,
    taxAddOnsByDefault: config.taxAddOnsByDefault,
    taxCustomByDefault: config.taxCustomByDefault,
    forfeitureTaxEstimationEnabled: config.forfeitureTaxEstimationEnabled,
    configurationSource: config.configurationSource,
    configurationEffectiveFrom: config.configurationEffectiveFrom,
    configurationEffectiveDate: config.configurationEffectiveDate,
    configurationTimeZone: config.configurationTimeZone,
    jurisdiction: config.jurisdiction,
    country: config.country,
    region: config.region,
  };
  let expectedTaxAmountCents: number;
  try {
    const recomputed = computeCheckoutTotals({
      items: [{
        lineTotalCents: taxableSubtotalCents,
        taxable: true,
      }],
      taxConfig,
      taxExempt,
    });
    expectedTaxAmountCents = recomputed.taxAmountCents;
  } catch {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Tax arithmetic exceeds supported integer precision.',
    );
  }
  if (
    taxAmountCents !== expectedTaxAmountCents
    || (!input.taxApplied && taxableSubtotalCents !== 0)
  ) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Tax amount does not match the canonical taxable-subtotal calculation.',
    );
  }

  return {
    ok: true,
    snapshot: input as unknown as BookingTaxSnapshot | FinalTaxSnapshot,
    invoiceMoney: {
      invoiceCurrency: input.currency,
      finalPriceCents: serviceSubtotalCents,
      taxAmountCents,
      taxableSubtotalCents,
      serviceInvoiceTotalCents: invoiceTotalCents,
    },
  };
}

/** Canonical runtime gate for immutable retained-deposit tax evidence. */
export function validateForfeitureTaxSnapshot(
  input: unknown,
  options: {
    expectedCurrency?: string | null;
    expectedGrossForfeitedCents?: number;
    expectedCapturedAt?: Date | null;
  } = {},
): ForfeitureTaxSnapshotValidation {
  if (!isRecord(input)) {
    return invalidSnapshot('TAX_SNAPSHOT_INVALID_SHAPE', 'Forfeiture snapshot must be an object.');
  }
  if (input.schemaVersion !== TAX_SNAPSHOT_SCHEMA_VERSION) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_SCHEMA_UNSUPPORTED',
      'Forfeiture snapshot schema version is missing or unsupported.',
    );
  }
  if (input.kind !== 'forfeiture_estimate') {
    return invalidSnapshot(
      'TAX_SNAPSHOT_KIND_MISMATCH',
      'Forfeiture snapshot kind is invalid.',
    );
  }
  if (input.classification !== 'estimate') {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CLASSIFICATION_MISMATCH',
      'Forfeiture snapshot must be classified as an estimate.',
    );
  }
  if (!isCanonicalIsoTimestamp(input.capturedAt)) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_TIMESTAMP_INVALID',
      'Forfeiture snapshot timestamp must be a canonical ISO instant.',
    );
  }
  if (
    options.expectedCapturedAt !== undefined
    && (
      !(options.expectedCapturedAt instanceof Date)
      || !Number.isFinite(options.expectedCapturedAt.getTime())
      || options.expectedCapturedAt.toISOString() !== input.capturedAt
    )
  ) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_TIMESTAMP_INVALID',
      'Forfeiture snapshot timestamp does not match the retained-deposit event.',
    );
  }
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency)) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_CURRENCY_MISMATCH',
      'Forfeiture snapshot currency must be an uppercase three-letter ISO code.',
    );
  }
  if (options.expectedCurrency !== undefined && options.expectedCurrency !== null) {
    const expectedCurrency = options.expectedCurrency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(expectedCurrency) || input.currency !== expectedCurrency) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_CURRENCY_MISMATCH',
        'Forfeiture snapshot currency does not match its deposit/invoice identity.',
      );
    }
  }

  const configuration = validateTaxConfigurationSnapshot(input.configuration);
  if (!configuration.ok) {
    return configuration;
  }
  if (
    typeof input.taxEstimateApplied !== 'boolean'
    || !Number.isSafeInteger(input.grossForfeitedCents)
    || (input.grossForfeitedCents as number) < 0
    || (input.grossForfeitedCents as number) > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    || !Number.isSafeInteger(input.estimatedTaxIncludedCents)
    || (input.estimatedTaxIncludedCents as number) < 0
    || (input.estimatedTaxIncludedCents as number) > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
    || !Number.isSafeInteger(input.estimatedNetCents)
    || (input.estimatedNetCents as number) < 0
    || (input.estimatedNetCents as number) > MAX_SUPPORTED_MINOR_UNIT_AMOUNT
  ) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_MONEY_INVALID',
      'Forfeiture money fields must be non-negative safe integers.',
    );
  }
  if (
    options.expectedGrossForfeitedCents !== undefined
    && input.grossForfeitedCents !== options.expectedGrossForfeitedCents
  ) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Forfeiture gross does not match the collected deposit.',
    );
  }

  const gross = input.grossForfeitedCents as number;
  const estimatedTax = input.estimatedTaxIncludedCents as number;
  const estimatedNet = input.estimatedNetCents as number;
  const recomposedGross = estimatedTax + estimatedNet;
  if (!Number.isSafeInteger(recomposedGross) || recomposedGross !== gross) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Forfeiture gross does not equal estimated tax plus estimated net.',
    );
  }

  const config = configuration.configuration;
  const expectedTaxEstimateApplied = config.enabled
    && config.rateBps > 0
    && config.forfeitureTaxEstimationEnabled
    && hasReviewedForfeitureTaxTreatment(config);
  if (input.taxEstimateApplied !== expectedTaxEstimateApplied) {
    return invalidSnapshot(
      'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
      'Forfeiture estimate state does not match the opt-in and reviewed jurisdiction.',
    );
  }
  if (!expectedTaxEstimateApplied) {
    if (estimatedTax !== 0 || estimatedNet !== gross) {
      return invalidSnapshot(
        'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
        'Gross-only forfeiture snapshot contains an unauthorized tax estimate.',
      );
    }
  } else {
    try {
      if (estimatedTax !== computeInclusiveTaxCents(gross, config.rateBps)) {
        return invalidSnapshot(
          'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
          'Forfeiture tax estimate does not match canonical inclusive rounding.',
        );
      }
    } catch {
      return invalidSnapshot(
        'TAX_SNAPSHOT_ARITHMETIC_MISMATCH',
        'Forfeiture tax estimate exceeds supported integer precision.',
      );
    }
  }

  return { ok: true, snapshot: input as unknown as ForfeitureTaxSnapshot };
}

type InvoiceTaxSnapshotInput = {
  taxConfig: ResolvedTaxConfig;
  totals: Pick<CheckoutTotals, 'taxApplied' | 'taxableSubtotalCents' | 'taxAmountCents' | 'finalPriceCents'>;
  capturedAt: Date;
  currency: string;
};

function invoiceTaxSnapshotValues(input: InvoiceTaxSnapshotInput): InvoiceTaxSnapshot {
  assertMinorUnits('Taxable subtotal', input.totals.taxableSubtotalCents);
  assertMinorUnits('Tax amount', input.totals.taxAmountCents);
  assertMinorUnits('Service subtotal', input.totals.finalPriceCents);
  const invoiceTotalCents = input.totals.finalPriceCents + input.totals.taxAmountCents;
  assertMinorUnits('Invoice total', invoiceTotalCents);

  return {
    schemaVersion: TAX_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: snapshotTimestamp(input.capturedAt),
    currency: snapshotCurrency(input.currency),
    configuration: buildTaxConfigurationSnapshot(input.taxConfig),
    taxApplied: input.totals.taxApplied,
    taxableSubtotalCents: input.totals.taxableSubtotalCents,
    taxAmountCents: input.totals.taxAmountCents,
    serviceSubtotalCents: input.totals.finalPriceCents,
    invoiceTotalCents,
  };
}

export function buildBookingTaxSnapshot(
  input: InvoiceTaxSnapshotInput,
): BookingTaxSnapshot {
  const snapshot: BookingTaxSnapshot = {
    ...invoiceTaxSnapshotValues(input),
    kind: 'booking_estimate',
    classification: 'estimate',
  };
  const validation = validateInvoiceTaxSnapshot(snapshot, {
    expectedKind: 'booking_estimate',
    expectedCurrency: snapshot.currency,
  });
  if (!validation.ok) {
    throw new TypeError(`Invalid booking tax snapshot: ${validation.detail}`);
  }
  return snapshot;
}

/**
 * Build the latest estimate for an in-place appointment reschedule/price
 * mutation. This deliberately returns the same validated estimate shape as a
 * booking disclosure; its separate column preserves both original and latest
 * history without adding a second money formula.
 */
export function buildRescheduleTaxSnapshot(input: {
  settings: SalonSettings | null | undefined;
  capturedAt: Date;
  currency: string;
  serviceLineTotalCents: number;
  addOnLineTotalCents: number;
  discountCents: number;
}): BookingTaxSnapshot {
  const taxConfig = resolveTaxConfig(input.settings, input.capturedAt);
  return buildBookingTaxSnapshot({
    taxConfig,
    totals: computeCheckoutTotals({
      items: [
        {
          lineTotalCents: input.serviceLineTotalCents,
          taxable: taxConfig.taxServicesByDefault,
        },
        {
          lineTotalCents: input.addOnLineTotalCents,
          taxable: taxConfig.taxAddOnsByDefault,
        },
      ],
      discountCents: input.discountCents,
      taxConfig,
      tipCents: 0,
    }),
    capturedAt: input.capturedAt,
    currency: input.currency,
  });
}

export function buildFinalTaxSnapshot(
  input: InvoiceTaxSnapshotInput & { taxExempt?: boolean; taxExemptReason?: string | null },
): FinalTaxSnapshot {
  const taxExempt = input.taxExempt ?? false;
  const snapshot: FinalTaxSnapshot = {
    ...invoiceTaxSnapshotValues(input),
    kind: 'final_actual',
    classification: 'actual',
    taxExempt,
    taxExemptReason: taxExempt ? input.taxExemptReason?.trim() || null : null,
  };
  const validation = validateInvoiceTaxSnapshot(snapshot, {
    expectedKind: 'final_actual',
    expectedCurrency: snapshot.currency,
  });
  if (!validation.ok) {
    throw new TypeError(`Invalid final tax snapshot: ${validation.detail}`);
  }
  return snapshot;
}

export function buildForfeitureTaxSnapshot(input: {
  taxConfig: ResolvedTaxConfig;
  grossForfeitedCents: number;
  capturedAt: Date;
  currency: string;
  /**
   * Legacy call-site hint retained for source compatibility. The persisted
   * salon opt-in plus reviewed jurisdiction are the only authoritative gates.
   */
  estimateTaxIncluded?: boolean;
}): ForfeitureTaxSnapshot {
  assertMinorUnits('Gross forfeited amount', input.grossForfeitedCents);
  const taxEstimateApplied = input.taxConfig.forfeitureTaxEstimationEnabled === true
    && hasReviewedForfeitureTaxTreatment(input.taxConfig)
    && input.taxConfig.enabled
    && input.taxConfig.rateBps > 0;
  const estimatedTaxIncludedCents = taxEstimateApplied
    ? computeInclusiveTaxCents(input.grossForfeitedCents, input.taxConfig.rateBps)
    : 0;

  const snapshot: ForfeitureTaxSnapshot = {
    schemaVersion: TAX_SNAPSHOT_SCHEMA_VERSION,
    kind: 'forfeiture_estimate',
    classification: 'estimate',
    capturedAt: snapshotTimestamp(input.capturedAt),
    currency: snapshotCurrency(input.currency),
    configuration: buildTaxConfigurationSnapshot(input.taxConfig),
    grossForfeitedCents: input.grossForfeitedCents,
    taxEstimateApplied,
    estimatedTaxIncludedCents,
    estimatedNetCents: input.grossForfeitedCents - estimatedTaxIncludedCents,
  };
  const validation = validateForfeitureTaxSnapshot(snapshot, {
    expectedCurrency: snapshot.currency,
    expectedGrossForfeitedCents: input.grossForfeitedCents,
    expectedCapturedAt: input.capturedAt,
  });
  if (!validation.ok) {
    throw new TypeError(`Invalid forfeiture tax snapshot: ${validation.detail}`);
  }
  return snapshot;
}

export type ResolvedEtransferSettings = {
  enabled: boolean;
  recipient: string | null;
  recipientName: string | null;
  autodepositEnabled: boolean;
  instructions: string | null;
  requireReference: boolean;
  qrPageEnabled: boolean;
};

export function resolveEtransferSettings(
  settings: SalonSettings | null | undefined,
): ResolvedEtransferSettings {
  const parsed = salonEtransferSettingsSchema.safeParse(settings?.payments?.etransfer ?? {});
  const etransfer = parsed.success ? parsed.data : {};
  const recipient = etransfer.recipient?.trim() || null;
  return {
    // e-Transfer is only usable once a recipient is configured.
    enabled: Boolean(etransfer.enabled) && recipient !== null,
    recipient,
    recipientName: etransfer.recipientName?.trim() || null,
    autodepositEnabled: etransfer.autodepositEnabled ?? false,
    instructions: etransfer.instructions?.trim() || null,
    requireReference: etransfer.requireReference ?? true,
    qrPageEnabled: etransfer.qrPageEnabled ?? false,
  };
}

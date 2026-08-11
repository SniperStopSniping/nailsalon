import { z } from 'zod';

import type { ResolvedTaxConfig } from '@/libs/checkoutTotals';
import { salonDepositSettingsSchema, storedDepositSettingsSchema } from '@/libs/depositPolicy';
import type { SalonSettings } from '@/types/salonPolicy';

/**
 * Salon-level payments settings, stored under `salon.settings.payments`.
 *
 * Tax is OFF by default for every salon (existing and new) and is never
 * inferred from the salon address — an owner must explicitly enable it.
 * Changing these settings never recalculates completed appointments; the
 * completion write snapshots the resolved config onto the appointment row.
 */

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
  /** A future rate change; applies once `effectiveFrom` (ISO date) passes. */
  scheduledChange: z
    .object({
      rateBps: z.number().int().min(0).max(30000),
      name: z.string().trim().max(40).optional(),
      effectiveFrom: z.string().refine(value => !Number.isNaN(Date.parse(value)), {
        message: 'effectiveFrom must be an ISO date',
      }),
    })
    .nullable()
    .optional(),
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
};

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
    return DISABLED_TAX_CONFIG;
  }

  let rateBps = tax.rateBps ?? 0;
  let name = tax.name?.trim() || 'Tax';
  const scheduled = tax.scheduledChange;
  if (scheduled && at.getTime() >= Date.parse(scheduled.effectiveFrom)) {
    rateBps = scheduled.rateBps;
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
  };
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

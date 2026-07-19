import { safeTimeZone } from '@/libs/clientSmsComposer';
import { formatDateInTimeZone } from '@/libs/timeZone';
import type { RetentionPromotionSettings } from '@/types/retention';

/**
 * Win-back promotion message rendering — shared by the per-client outreach
 * surface and the Marketing follow-ups so both produce identical, fully
 * resolved copy. Raw {placeholders} never reach the composer; everything is
 * interpolated before the technician sees it.
 */

export function formatPromotionOffer(promotion: RetentionPromotionSettings): string {
  if (promotion.discountType === 'percent') {
    return `${promotion.value}% off`;
  }

  return `${new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(promotion.value / 100)} off`;
}

export function firstNameForMessage(fullName: string | null): string {
  return fullName?.trim().split(/\s+/)[0] || 'there';
}

export function renderPromotionMessage(args: {
  promotion: RetentionPromotionSettings;
  firstName: string;
  salonName: string;
  bookingUrl: string;
  expiresAt: string;
  timeZone: string | null;
}): string {
  // The expiry is a UTC instant; render it in the salon's timezone, not the
  // staff device's, so the client is never told a day-early/day-late date.
  const expiry = formatDateInTimeZone(
    args.expiresAt,
    { month: 'long', day: 'numeric', year: 'numeric' },
    safeTimeZone(args.timeZone),
  );
  const replacements: Record<string, string> = {
    '{firstName}': args.firstName,
    '{salonName}': args.salonName,
    '{offer}': formatPromotionOffer(args.promotion),
    '{expiry}': expiry,
    '{bookingLink}': args.bookingUrl,
  };

  let message = args.promotion.messageTemplate;
  for (const [placeholder, value] of Object.entries(replacements)) {
    message = message.split(placeholder).join(value);
  }

  if (args.promotion.code && !message.includes(args.promotion.code)) {
    message = `${message}\nUse code ${args.promotion.code}.`;
  }
  return message;
}

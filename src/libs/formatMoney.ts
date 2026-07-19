const LOCALE_BY_CURRENCY: Record<string, string> = {
  CAD: 'en-CA',
  USD: 'en-US',
};

/**
 * Format integer cents in the salon's currency. Defaults to CAD (the platform
 * default in `bookingConfig.ts`) — replaces scattered hardcoded-USD and naive
 * `$x.xx` formatters.
 */
export function formatMoney(
  cents: number,
  currency: string = 'CAD',
  locale?: string,
): string {
  const resolvedLocale = locale ?? LOCALE_BY_CURRENCY[currency] ?? 'en-CA';
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency,
  }).format(cents / 100);
}

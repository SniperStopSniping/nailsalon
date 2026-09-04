import { themeVars } from '@/theme';

import type { QuickBookProfileView } from './quickBookProfile';

type QuickBookLocationMapProps = {
  /** Already resolved by the shared public visibility/address-privacy projection. */
  location: QuickBookProfileView['location'];
};

export function QuickBookLocationMap({ location }: QuickBookLocationMapProps) {
  const query = [location?.addressLine, location?.localityLine]
    .map(value => value?.trim())
    .filter(Boolean)
    .join(', ');

  if (!query) {
    return null;
  }

  return (
    <section
      data-public-surface="hoursLocation"
      data-testid="quick-book-location-map"
      aria-label="Location map"
      className="mt-6 overflow-hidden rounded-2xl border bg-white"
      style={{ borderColor: themeVars.cardBorder }}
    >
      <iframe
        title={`Map of ${query}`}
        src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`}
        className="block h-60 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
      />
    </section>
  );
}

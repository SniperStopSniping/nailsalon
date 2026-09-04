export type AddressSuggestion = {
  address: string;
  city: string;
  label: string;
};

const text = (value: unknown): string => typeof value === 'string' ? value.trim().slice(0, 180) : '';

/** Keep provider metadata/coordinates out of the canonical owner profile. */
export function parseAddressSuggestions(payload: unknown): AddressSuggestion[] {
  if (!payload || typeof payload !== 'object' || !('features' in payload) || !Array.isArray(payload.features)) {
    return [];
  }
  const suggestions = new Map<string, AddressSuggestion>();
  for (const feature of payload.features.slice(0, 10)) {
    const properties = feature?.properties;
    if (!properties || typeof properties !== 'object') {
      continue;
    }
    const street = text(properties.street);
    const city = text(properties.city) || text(properties.town) || text(properties.village);
    const houseNumber = text(properties.housenumber);
    // Do not replace an exact address with a city or an incomplete street.
    if (!street || !city || !houseNumber) {
      continue;
    }
    const address = [
      `${houseNumber} ${street}`,
      city,
      [text(properties.state), text(properties.postcode)].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ');
    suggestions.set(address, { address, city, label: address });
  }
  return [...suggestions.values()].slice(0, 5);
}

/** Photon permits reasonable-volume search-as-you-type. Never send app cookies or referrers. */
export async function searchAddresses(query: string, city: string, signal: AbortSignal): Promise<AddressSuggestion[]> {
  const input = query.trim().slice(0, 180);
  if (input.length < 4) {
    return [];
  }
  const area = city.trim().slice(0, 100);
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', area && !input.toLowerCase().includes(area.toLowerCase()) ? `${input}, ${area}` : input);
  url.searchParams.set('limit', '5');
  url.searchParams.set('lang', 'en');
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) {
    throw new Error('Address search is unavailable');
  }
  return parseAddressSuggestions(await response.json());
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseAddressSuggestions, searchAddresses } from './address-search';

const properties = { housenumber: '100', street: 'Queen Street West', city: 'Toronto', state: 'Ontario', postcode: 'M5H 2N2' };

describe('address search adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps only complete addresses and removes duplicate/provider-only metadata', () => {
    expect(parseAddressSuggestions({ features: [
      { properties: { ...properties, osm_id: 12 }, geometry: { coordinates: [-79, 43] } },
      { properties },
      { properties: { street: 'Queen Street West', city: 'Toronto' } },
      { properties: { city: 'Toronto' } },
      null,
    ] })).toEqual([{ address: '100 Queen Street West, Toronto, Ontario M5H 2N2', city: 'Toronto', label: '100 Queen Street West, Toronto, Ontario M5H 2N2' }]);
    expect(parseAddressSuggestions(null)).toEqual([]);
    expect(parseAddressSuggestions({ features: 'invalid' })).toEqual([]);
  });

  it('sends a bounded, city-aware search without credentials or referrer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ properties }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await searchAddresses('100 Queen', 'Toronto', signal);
    const [url, options] = fetchMock.mock.calls[0]!;

    expect(url.origin).toBe('https://photon.komoot.io');
    expect(url.searchParams.get('q')).toBe('100 Queen, Toronto');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(options).toEqual({ signal, credentials: 'omit', referrerPolicy: 'no-referrer' });

    await searchAddresses('10', 'Toronto', signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed lookup without returning invented suggestions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await expect(searchAddresses('100 Queen', 'Toronto', new AbortController().signal)).rejects.toThrow('unavailable');
  });
});

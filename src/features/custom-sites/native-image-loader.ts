import type { CustomSitePayload } from './contracts';

const MAX_BYTES = 3_750_000;
const MAX_CACHE_CHARACTERS = 8_000_000;

async function imageData(response: Response) {
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/webp' || Number(response.headers.get('content-length') ?? 0) > MAX_BYTES || !response.body) {
    throw new Error('Photo unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      length += next.value.byteLength;
      if (length > MAX_BYTES) {
        throw new Error('Photo too large');
      }
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  if (!length) {
    throw new Error('Photo unavailable');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Promise<string>((resolve, reject) => {
    const file = new FileReader();
    file.onload = () => typeof file.result === 'string' ? resolve(file.result) : reject(new Error('Photo unavailable'));
    file.onerror = () => reject(new Error('Photo unavailable'));
    file.readAsDataURL(new Blob([bytes], { type: 'image/webp' }));
  });
}

/** Trusted parent only. A frame can request known photos, never URLs or credentials. */
export function nativeImageLoader(media: NonNullable<CustomSitePayload['nativeMedia']>, ready: (id: string, data: string | null) => void, activity?: (pending: number) => void) {
  const allowed = new Set(media.mediaIds.slice(0, 61));
  const cache = new Map<string, string>();
  const failures = new Map<string, number>();
  const pending = new Map<string, AbortController>();
  const queued = new Set<string>();
  let disposed = false;
  async function load(id: string) {
    const controller = new AbortController();
    pending.set(id, controller);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/custom-sites/media', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId: media.artifactId, mediaId: id, ...(media.shareToken ? { shareToken: media.shareToken } : {}) }), signal: controller.signal });
      const data = await imageData(response);
      if (!disposed) {
        failures.delete(id);
        cache.delete(id);
        cache.set(id, data);
        while (cache.size > 8 || [...cache.values()].reduce((size, value) => size + value.length, 0) > MAX_CACHE_CHARACTERS) {
          cache.delete(cache.keys().next().value!);
        }
        ready(id, data);
      }
    } catch {
      if (!disposed) {
        failures.set(id, (failures.get(id) ?? 0) + 1);
        ready(id, null);
      }
    } finally {
      window.clearTimeout(timer);
      pending.delete(id);
      pump();
    }
  }
  function pump() {
    if (disposed) {
      return;
    }
    while (pending.size < 2 && queued.size) {
      const id = queued.values().next().value!;
      queued.delete(id);
      void load(id);
    }
    activity?.(pending.size + queued.size);
  }
  return {
    request(id: unknown) {
      if (disposed || typeof id !== 'string' || !allowed.has(id) || pending.has(id)) {
        return;
      }
      const cached = cache.get(id);
      if (cached) {
        cache.delete(id);
        cache.set(id, cached);
        ready(id, cached);
      } else if ((failures.get(id) ?? 0) < 3) {
        queued.add(id);
        pump();
      } else {
        ready(id, null);
      }
    },
    dispose() {
      disposed = true;
      queued.clear();
      cache.clear();
      for (const controller of pending.values()) {
        controller.abort();
      }
    },
  };
}

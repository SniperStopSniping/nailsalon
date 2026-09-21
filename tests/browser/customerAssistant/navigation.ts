import { useSyncExternalStore } from 'react';

const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
};

export function useParams(): { locale?: string; slug?: string } {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return { locale: segments[0], slug: segments[1] };
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/');
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return new URLSearchParams(search);
}

const router = {
  push: (href: string) => {
    window.history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  replace: (href: string) => {
    window.history.replaceState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  back: () => window.history.back(),
  refresh: () => window.dispatchEvent(new PopStateEvent('popstate')),
};

/** Match Next's stable router identity so effects do not restart on every render. */
export function useRouter() {
  return router;
}

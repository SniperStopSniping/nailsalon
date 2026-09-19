import { useSyncExternalStore } from 'react';

const subscribe = (callback: () => void) => {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
};

export function useParams(): { locale?: string; slug?: string } {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return { locale: segments[0], slug: segments[1] };
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return new URLSearchParams(search);
}

export function useRouter(): { push: (href: string) => void; replace: (href: string) => void; back: () => void; refresh: () => void } {
  return {
    push: (href) => {
      window.history.pushState(null, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    replace: (href) => {
      window.history.replaceState(null, '', href);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    back: () => window.history.back(),
    refresh: () => window.dispatchEvent(new PopStateEvent('popstate')),
  };
}

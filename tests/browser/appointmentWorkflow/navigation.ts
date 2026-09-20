import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

export function useRouter() {
  return {
    push: (href: string) => {
      window.history.pushState({}, '', href);
      listeners.forEach(listener => listener());
    },
    replace: (href: string) => {
      window.history.replaceState({}, '', href);
      listeners.forEach(listener => listener());
    },
    back: () => window.history.back(),
    refresh: () => listeners.forEach(listener => listener()),
  };
}

export function useSearchParams() {
  const search = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => window.location.search,
    () => '',
  );
  return new URLSearchParams(search);
}

export function useParams() {
  return { locale: 'en' };
}

/* eslint-disable style/max-statements-per-line */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
}
function navigate(href: string, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', href);
  notify();
}
export function useRouter() {
  return { push: (href: string) => navigate(href), replace: (href: string) => navigate(href, true), back: () => window.history.back(), refresh: notify };
}
export function useSearchParams() {
  const search = useSyncExternalStore((listener) => {
    listeners.add(listener); return () => listeners.delete(listener);
  }, () => window.location.search, () => '');
  return new URLSearchParams(search);
}
export function useParams() {
  return { locale: 'en' };
}

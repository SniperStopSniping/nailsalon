import { useSyncExternalStore } from 'react';

// Harness-only navigation: preserve Settings' URL-backed views without Next.
const navigationEvent = 'luster:sms-fixture-navigation';
const params = { locale: 'en' };
const router = {
  push(href: string) {
    window.history.pushState({}, '', href);
    window.dispatchEvent(new Event(navigationEvent));
  },
  replace(href: string) {
    window.history.replaceState({}, '', href);
    window.dispatchEvent(new Event(navigationEvent));
  },
  back() {
    window.history.back();
  },
  refresh() {},
};

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(navigationEvent, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(navigationEvent, listener);
  };
}

export const useRouter = () => router;
export const useParams = () => params;
export const useSearchParams = () => {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return new URLSearchParams(search);
};

import { useSyncExternalStore } from 'react';

const eventName = 'luster:marketing-fixture-navigation';

function notify() {
  window.dispatchEvent(new Event(eventName));
}

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(eventName, listener);
  };
}

export function useRouter() {
  return {
    push: (href: string) => {
      window.history.pushState({}, '', href);
      notify();
    },
    replace: (href: string) => {
      window.history.replaceState({}, '', href);
      notify();
    },
    back: () => window.history.back(),
    refresh: () => notify(),
  };
}

export function useParams() {
  return { locale: 'en' };
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return new URLSearchParams(search);
}

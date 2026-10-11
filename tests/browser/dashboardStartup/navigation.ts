export { useParams, useSearchParams } from '../ownerNavigation/navigation';

function navigate(href: string, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const router = {
  push: (href: string) => navigate(href),
  replace: (href: string) => navigate(href, true),
  back: () => window.history.back(),
  refresh() {},
};
export const useRouter = () => router;

export function usePathname() {
  return window.location.pathname;
}

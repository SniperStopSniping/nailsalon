export { useParams, useRouter, useSearchParams } from '../ownerNavigation/navigation';

export function usePathname() {
  return window.location.pathname;
}

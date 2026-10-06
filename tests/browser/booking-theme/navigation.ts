const router = {
  push: (url: string) => {
    document.documentElement.dataset.navigation = url;
  },
  replace: (url: string) => {
    document.documentElement.dataset.navigation = url;
  },
  back: () => {},
  refresh: () => {},
};
const params = { locale: 'en', slug: new URLSearchParams(window.location.search).has('isla') ? 'isla-nail-studio' : 'theme-fixture' };
export const useRouter = () => router;
export const useParams = () => params;
export const usePathname = () => '/en/theme-fixture/book/time';
export const useSearchParams = () => new URLSearchParams(new URLSearchParams(window.location.search).has('isla') ? '' : 'serviceIds=service-fixture&techId=tech-fixture');

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
const params = { locale: 'en', slug: 'theme-fixture' };
export const useRouter = () => router;
export const useParams = () => params;
export const usePathname = () => '/en/theme-fixture/book/time';
export const useSearchParams = () => new URLSearchParams('serviceIds=service-fixture&techId=tech-fixture');

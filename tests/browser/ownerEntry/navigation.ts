// This fixture never navigates to production or creates an authenticated session.
export function useParams() {
  return { locale: new URLSearchParams(location.search).get('locale') || 'en' };
}

export function useRouter() {
  return {
    replace: (url: string) => location.assign(url),
    refresh: () => {},
  };
}

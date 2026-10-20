import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const nextNavigation = vi.hoisted(() => ({
  pathname: '/billing',
  router: {
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  permanentRedirect: vi.fn(),
  redirect: vi.fn(),
  usePathname: () => nextNavigation.pathname,
  useRouter: () => nextNavigation.router,
}));

function withLocale(locale: 'en' | 'fr') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={{}}>
        {children}
      </NextIntlClientProvider>
    );
  };
}

describe('locale-aware navigation', () => {
  it('initializes the real navigation API and preserves as-needed paths and query strings', async () => {
    // Keep the real next-intl factory in this test: its config validation is the
    // regression under test. Only Next.js client hooks are substituted.
    const { usePathname, useRouter } = await import('./i18nNavigation');

    nextNavigation.pathname = '/billing';
    const english = renderHook(() => useRouter(), { wrapper: withLocale('en') });
    act(() => english.result.current.push('/billing?tab=plans'));

    expect(nextNavigation.router.push).toHaveBeenLastCalledWith('/billing?tab=plans');

    english.unmount();

    nextNavigation.pathname = '/fr/billing';
    const french = renderHook(() => ({ pathname: usePathname(), router: useRouter() }), {
      wrapper: withLocale('fr'),
    });

    expect(french.result.current.pathname).toBe('/billing');

    act(() => french.result.current.router.push('/billing?tab=plans'));

    expect(nextNavigation.router.push).toHaveBeenLastCalledWith('/fr/billing?tab=plans');

    act(() => french.result.current.router.push('/billing?tab=plans', { locale: 'en' }));

    expect(nextNavigation.router.push).toHaveBeenLastCalledWith('/en/billing?tab=plans');
  });
});

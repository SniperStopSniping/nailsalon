import { PublicSalonPageShell } from '@/components/PublicSalonPageShell';
import { getPublicPageContext } from '@/libs/tenant';

import PaymentMethodsContent from './PaymentMethodsContent';

/**
 * Payment Methods Page (Server Component)
 *
 * Allows clients to manage saved cards for deposits, no-show fees,
 * and fast checkout. Fetches page appearance settings and conditionally
 * wraps the content with ThemeProvider if theme mode is enabled.
 */
export default async function PaymentMethodsPage({
  searchParams,
  params,
}: {
  searchParams: { salonSlug?: string };
  params?: { locale?: string; slug?: string };
}) {
  const context = await getPublicPageContext('payment-methods', searchParams, params);

  return (
    <PublicSalonPageShell
      appearance={context.appearance}
      pageName="payment-methods"
      salon={context.salon}
    >
      <PaymentMethodsContent salonSlug={context.salon.slug} />
    </PublicSalonPageShell>
  );
}

import { PageThemeWrapper } from '@/components/PageThemeWrapper';
import { getPageAppearance } from '@/libs/pageAppearance';

import PaymentMethodsContent from './PaymentMethodsContent';

// Demo salon ID - in production, this would come from auth context or subdomain
const DEMO_SALON_ID = 'salon_nail-salon-no5';

/**
 * Payment Methods Page (Server Component)
 *
 * Allows clients to manage saved cards for deposits, no-show fees,
 * and fast checkout. Fetches page appearance settings and conditionally
 * wraps the content with ThemeProvider if theme mode is enabled.
 */
export default async function PaymentMethodsPage() {
  const { mode, themeKey } = await getPageAppearance(DEMO_SALON_ID, 'payment-methods');

  return (
    <PageThemeWrapper mode={mode} themeKey={themeKey} pageName="payment-methods">
      <PaymentMethodsContent />
    </PageThemeWrapper>
  );
}

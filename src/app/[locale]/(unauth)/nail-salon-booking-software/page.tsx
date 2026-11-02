import { MarketingProductPage } from '@/components/marketing/MarketingProductPage';
import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { getMarketingLocale, marketingPages } from '@/libs/marketingContent';
import { buildMarketingMetadata } from '@/libs/marketingSeo';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const page = marketingPages[getMarketingLocale(locale)].salon;
  return buildMarketingMetadata(page.path, locale, page);
}

export default async function ProductPage({ params }: Props) {
  const { locale } = await params;
  return <MarketingProductPage locale={locale} pageKey="salon" websiteSetupEnabled={isOnboardingV1IntegrationEnabled()} />;
}

import { LusterLegalPage } from '@/components/legal/LusterLegalPage';
import { termsEnglish, termsFrench } from '@/libs/lusterLegalContent';
import { getMarketingLocale } from '@/libs/marketingContent';
import { buildMarketingMetadata } from '@/libs/marketingSeo';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const locale = getMarketingLocale((await params).locale);
  const content = locale === 'fr' ? termsFrench : termsEnglish;
  return buildMarketingMetadata('/terms', locale, {
    title: `${content.title} | Luster`,
    description: locale === 'fr' ? 'Conditions d’utilisation des outils de réservation et de gestion de salon Luster.' : 'Terms for using Luster free booking and salon tools.',
  });
}

export default async function LegalPage({ params }: Props) {
  const locale = getMarketingLocale((await params).locale);
  const content = locale === 'fr' ? termsFrench : termsEnglish;
  return <LusterLegalPage {...content} locale={locale} />;
}

import { LusterLegalPage } from '@/components/legal/LusterLegalPage';
import { privacyEnglish, privacyFrench } from '@/libs/lusterLegalContent';
import { getMarketingLocale } from '@/libs/marketingContent';
import { buildMarketingMetadata } from '@/libs/marketingSeo';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const locale = getMarketingLocale((await params).locale);
  const content = locale === 'fr' ? privacyFrench : privacyEnglish;
  return buildMarketingMetadata('/privacy', locale, {
    title: `${content.title} | Luster`,
    description: locale === 'fr' ? 'Comment Luster protège les données des salons, des clients et de Google Agenda.' : 'How Luster protects salon, customer, and Google Calendar data.',
  });
}

export default async function LegalPage({ params }: Props) {
  const locale = getMarketingLocale((await params).locale);
  const content = locale === 'fr' ? privacyFrench : privacyEnglish;
  return <LusterLegalPage {...content} locale={locale} />;
}

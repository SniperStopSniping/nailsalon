import { redirect } from 'next/navigation';

import { AppConfig } from '@/utils/AppConfig';

export default function IndexPage(props: { params: { locale: string } }) {
  const locale = props.params.locale;
  const target = locale === AppConfig.defaultLocale ? '/book' : `/${locale}/book`;

  redirect(target);
}

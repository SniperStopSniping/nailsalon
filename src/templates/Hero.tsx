import { CalendarDays, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { badgeVariants } from '@/components/ui/badgeVariants';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { CenteredHero } from '@/features/landing/CenteredHero';
import { Section } from '@/features/landing/Section';

export const Hero = () => {
  const t = useTranslations('Hero');

  return (
    <Section className="py-36">
      <CenteredHero
        banner={(
          <span className={badgeVariants()}>
            <Sparkles className="mr-1 size-4 text-rose-700" />
            {' '}
            {t('follow_twitter')}
          </span>
        )}
        title={t.rich('title', {
          important: chunks => (
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              {chunks}
            </span>
          ),
        })}
        description={t('description')}
        buttons={(
          <>
            <Link
              className={buttonVariants({ size: 'lg', className: 'bg-rose-700 hover:bg-rose-800' })}
              href="/owner"
            >
              {t('primary_button')}
            </Link>

            <Link
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
              href="/book"
            >
              <CalendarDays className="mr-2 size-5" />
              {t('secondary_button')}
            </Link>
          </>
        )}
      />
    </Section>
  );
};

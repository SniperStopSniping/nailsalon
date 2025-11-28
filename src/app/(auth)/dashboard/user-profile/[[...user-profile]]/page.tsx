'use client';

import { UserProfile } from '@clerk/nextjs';
import { useTranslations } from '@/providers/I18nProvider';

import { TitleBar } from '@/features/dashboard/TitleBar';
import { getI18nPath } from '@/utils/Helpers';

const UserProfilePage = (props: { params: { locale: string } }) => {
  const t = useTranslations('UserProfile');

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <UserProfile
        routing="path"
        path={getI18nPath('/dashboard/user-profile', props.params.locale)}
        appearance={{
          elements: {
            rootBox: 'w-full',
            cardBox: 'w-full flex',
          },
        }}
      />
    </>
  );
};

export default UserProfilePage;

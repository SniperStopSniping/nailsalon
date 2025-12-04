'use client';

import { OrganizationProfile } from '@clerk/nextjs';

import { TitleBar } from '@/features/dashboard/TitleBar';
import { getI18nPath } from '@/utils/Helpers';

const OrganizationProfilePage = (props: { params: { locale: string } }) => {
  return (
    <>
      <TitleBar
        title="Organization Profile"
        description="Manage your organization settings"
      />

      <OrganizationProfile
        routing="path"
        path={getI18nPath(
          '/dashboard/organization-profile',
          props.params.locale,
        )}
        afterLeaveOrganizationUrl="/onboarding/organization-selection"
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

export default OrganizationProfilePage;

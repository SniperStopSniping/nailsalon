'use client';

import { OrganizationList } from '@clerk/nextjs';

const OrganizationSelectionPage = () => (
  <div className="flex min-h-screen items-center justify-center">
    <OrganizationList
      afterSelectOrganizationUrl="/admin"
      afterCreateOrganizationUrl="/admin"
      hidePersonal
      skipInvitationScreen
    />
  </div>
);

export const dynamic = 'force-dynamic';

export default OrganizationSelectionPage;

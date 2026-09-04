import { LusterSetupWizard } from './LusterSetupWizard';

export default async function LusterOnboardingPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ invite?: string }>;
  },
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return <LusterSetupWizard inviteToken={searchParams.invite || ''} locale={params.locale} />;
}

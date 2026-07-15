import { LusterSetupWizard } from './LusterSetupWizard';

export default function LusterOnboardingPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { invite?: string };
}) {
  return <LusterSetupWizard inviteToken={searchParams.invite || ''} locale={params.locale} />;
}

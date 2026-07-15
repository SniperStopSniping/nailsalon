import { getSuperAdminPasswordConfig } from '@/libs/authConfig.server';

import { SuperAdminPasswordLoginForm } from './SuperAdminPasswordLoginForm';

export default function SuperAdminLoginPage() {
  const config = getSuperAdminPasswordConfig();

  return (
    <SuperAdminPasswordLoginForm
      passwordLoginEnabled={config.enabled}
      legacyModeSelected={config.mode === 'twilio'}
    />
  );
}

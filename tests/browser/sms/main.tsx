import '@/styles/global.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { LusterClientSms } from '@/components/admin/LusterClientSms';
import { SettingsModal } from '@/components/admin/SettingsModal';

export function SmsBrowserFixture() {
  const [open, setOpen] = useState(true);
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50 p-3">
      <h1 className="text-xl font-semibold">SMS Test Client</h1>
      <LusterClientSms
        salonSlug="sms-fixture"
        salonName="SMS Test Studio"
        clientId="test-client"
        appointmentId="test-appointment"
        composerOpen={open}
        onClose={() => setOpen(false)}
      />
    </main>
  );
}

function SettingsBrowserFixture() {
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-3xl bg-stone-50">
      <SettingsModal salonSlug="sms-fixture" isFreeSolo userName="Test Owner" onClose={() => {}} />
    </main>
  );
}

const settingsFixture = new URLSearchParams(window.location.search).get('fixture') === 'settings';
createRoot(document.getElementById('root')!).render(settingsFixture ? <SettingsBrowserFixture /> : <SmsBrowserFixture />);

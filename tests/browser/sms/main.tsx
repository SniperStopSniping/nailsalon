import '@/styles/global.css';

import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AppGrid } from '@/components/admin/AppGrid';
import { LusterClientSms } from '@/components/admin/LusterClientSms';
import { SettingsModal } from '@/components/admin/SettingsModal';
import { UsageBillingModal } from '@/components/admin/UsageBillingModal';
import { AddSmsCreditsControl } from '@/components/super-admin/AddSmsCreditsControl';

export function SmsBrowserFixture() {
  const [open, setOpen] = useState(true);
  const purpose = new URLSearchParams(window.location.search).get('purpose') === 'google_review'
    ? 'google_review'
    : undefined;
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50 p-3">
      <h1 className="text-xl font-semibold">SMS Test Client</h1>
      <LusterClientSms
        salonSlug="sms-fixture"
        salonName="SMS Test Studio"
        clientId="test-client"
        appointmentId="test-appointment"
        purpose={purpose}
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

function SuperAdminCreditsBrowserFixture() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-stone-50 p-3">
      <h1 className="text-xl font-semibold">Super admin SMS credits</h1>
      <AddSmsCreditsControl salonId="super-admin-fixture" salonName="Fixture Nail Studio" />
    </main>
  );
}

function UsageBillingBrowserFixture() {
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50 p-3">
      <UsageBillingModal salonSlug="sms-fixture" onClose={() => {}} />
    </main>
  );
}

function MoreUsageFixture() {
  const [open, setOpen] = useState(false);
  return (
    <main className="owner-workspace-theme mx-auto min-h-screen max-w-md bg-stone-50 p-3">
      <NextIntlClientProvider locale="en" messages={{ NoShowRecords: { tile_name: 'No-show records', tile_description: 'View records' } }}>
        <AppGrid
          textBalance={8}
          onAppTap={(id) => {
            if (id === 'plan-usage') {
              setOpen(true);
            }
          }}
        />
      </NextIntlClientProvider>
      {open && <UsageBillingModal salonSlug="sms-fixture" onClose={() => setOpen(false)} />}
    </main>
  );
}

const fixture = new URLSearchParams(window.location.search).get('fixture');
createRoot(document.getElementById('root')!).render(
  fixture === 'more-usage'
    ? <MoreUsageFixture />
    : fixture === 'settings'
      ? <SettingsBrowserFixture />
      : fixture === 'super-admin-credits'
        ? <SuperAdminCreditsBrowserFixture />
        : fixture === 'usage-billing'
          ? <UsageBillingBrowserFixture />
          : <SmsBrowserFixture />,
);

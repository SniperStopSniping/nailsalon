import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import OwnerAssistantLauncher from '@/components/admin/ownerAssistant/OwnerAssistantLauncher';

createRoot(document.getElementById('root')!).render(
  <main className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] p-6 text-[var(--owner-ink)]">
    <h1 className="text-xl font-semibold">Isolated owner assistant fixture</h1>
    <p>Real UI with synthetic admission and answers. No production account or provider.</p>
    <OwnerAssistantLauncher locale="en" salonSlug="synthetic-assistant-salon" placement="standalone" />
  </main>,
);

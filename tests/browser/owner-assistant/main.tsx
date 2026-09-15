import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { OwnerMenuAssistant } from '@/components/admin/ownerAssistant/OwnerMenuAssistant';

function OwnerAssistantFixture() {
  return (
    <main className="owner-workspace-theme min-h-screen bg-[var(--owner-ground)] p-4 pb-32">
      <h1 className="owner-title text-2xl font-semibold">Owner assistant test salon</h1>
      <p className="mt-2 text-[var(--owner-muted)]">A synthetic browser fixture for menu ordering.</p>
      <OwnerMenuAssistant salonSlug="assistant-fixture" />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<OwnerAssistantFixture />);

export { OwnerAssistantFixture };

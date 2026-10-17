import '@/styles/global.css';
import '@/features/business-setup/setup.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { AiCreditsMenu } from '@/features/ai-credits/AiCreditsMenu';

export function Review() {
  const [redirect, setRedirect] = useState('');
  return (
    <main className="luster-setup setup-chat-first" style={{ minHeight: '100vh', padding: 20 }}>
      <p style={{ fontSize: 12, textAlign: 'center' }}>Isolated interface test · synthetic balance · no real payment</p>
      <header className="setup-heading">
        <div className="setup-topbar">
          <div className="setup-brand">
            <span className="setup-wordmark">✦ LUSTER</span>
            <span className="setup-save-status">Saved as draft</span>
          </div>
          <nav className="setup-tools" aria-label="Website tools">
            <button type="button">Preview</button>
            <button type="button">Details</button>
            <button type="button">Review</button>
          </nav>
        </div>
      </header>
      <aside className="setup-credit-strip" aria-label="AI credit balance"><AiCreditsMenu salonSlug="synthetic" locale="en" onNavigate={setRedirect} /></aside>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 32, marginTop: 80, textAlign: 'center' }}>What are we creating today?</h1>
      <p style={{ textAlign: 'center' }}>Upload your design, or describe your idea.</p>
      {redirect && (
        <p role="status">
          Verified Stripe checkout redirect:
          {redirect}
        </p>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Review />);

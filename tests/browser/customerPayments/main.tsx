import '../../../src/styles/global.css';
import './preview.css';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CustomerPaymentDraftSettings } from '../../../src/components/customerPayments/CustomerPaymentDraftSettings';
import { CustomerPaymentQuotePreview } from '../../../src/components/customerPayments/CustomerPaymentQuotePreview';
import { CustomerPaymentsRehearsal } from '../../../src/components/customerPayments/CustomerPaymentsRehearsal';

function QuoteFixture() {
  const [shown, setShown] = useState(true);
  return (
    <main>
      <h1>Mock appointment quote fixture</h1>
      <p>Transport is intercepted by tests. No real capability, database or payment provider is used.</p>
      <button type="button" onClick={() => setShown(false)}>Remove preview fixture</button>
      {shown && <CustomerPaymentQuotePreview token="synthetic_test_capability_not_a_real_token" />}
    </main>
  );
}

const quoteFixture = new URLSearchParams(window.location.search).get('view') === 'quote';
const draftFixture = new URLSearchParams(window.location.search).get('view') === 'draft';

createRoot(document.getElementById('root')!).render(quoteFixture
  ? <QuoteFixture />
  : draftFixture
    ? (
        <main>
          <h1>Mock owner draft fixture</h1>
          <p>Browser test only. GET/PATCH are intercepted by the test. No real authentication, database or payment provider is used.</p>
          <CustomerPaymentDraftSettings salonSlug="synthetic-draft-salon" />
        </main>
      )
    : <CustomerPaymentsRehearsal />);

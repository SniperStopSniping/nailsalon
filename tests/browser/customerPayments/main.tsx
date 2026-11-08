import '../../../src/styles/global.css';
import './preview.css';

import { createRoot } from 'react-dom/client';

import { CustomerPaymentDraftSettings } from '../../../src/components/customerPayments/CustomerPaymentDraftSettings';
import { CustomerPaymentsRehearsal } from '../../../src/components/customerPayments/CustomerPaymentsRehearsal';

const draftFixture = new URLSearchParams(window.location.search).get('view') === 'draft';

createRoot(document.getElementById('root')!).render(draftFixture
  ? (
      <main>
        <h1>Mock owner draft fixture</h1>
        <p>Browser test only. GET/PATCH are intercepted by the test. No real authentication, database or payment provider is used.</p>
        <CustomerPaymentDraftSettings salonSlug="synthetic-draft-salon" />
      </main>
    )
  : <CustomerPaymentsRehearsal />);

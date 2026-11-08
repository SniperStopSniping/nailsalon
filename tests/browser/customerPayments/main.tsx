import '../../../src/styles/global.css';
import './preview.css';

import { createRoot } from 'react-dom/client';

import { CustomerPaymentsRehearsal } from '../../../src/components/customerPayments/CustomerPaymentsRehearsal';

createRoot(document.getElementById('root')!).render(<CustomerPaymentsRehearsal />);

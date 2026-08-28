import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './ui/App';
import './styles.css';
import './ui/final-hybrid.css';
import './onboarding/onboarding.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Luster Onboarding V1 UX Lab root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

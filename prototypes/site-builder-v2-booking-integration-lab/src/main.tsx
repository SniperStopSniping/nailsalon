import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './ui/App';
import './styles.css';
import './ui/final-hybrid.css';
import './onboarding/onboarding.css';
import './onboarding/daniela-basics-booking.css';
import './onboarding/gallery-policy-polish.css';
import './onboarding/daniela-about-style.css';
import './onboarding/section-library.css';
import './onboarding/palette.css';
import './onboarding/style-colours-save.css';
import './onboarding/screen-seven-booking.css';
import './onboarding/screen-eight-about.css';
import './onboarding/feedback/feedback.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Luster Onboarding V1 UX Lab root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

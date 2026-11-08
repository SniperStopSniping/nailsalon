import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { LusterHome } from '@/components/LusterHome';

const query = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(<LusterHome locale={query.get('locale') ?? 'en'} websiteSetupEnabled={!query.has('disabled')} />);

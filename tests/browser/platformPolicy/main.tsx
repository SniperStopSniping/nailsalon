import '@/styles/global.css';

import { createRoot } from 'react-dom/client';

import { SuperAdminPoliciesClient } from '@/app/[locale]/super-admin/policies/client';

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error('External requests are disabled in this review.');
  }
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: { message: 'Synthetic policy save refused. No policy changed.' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  return nativeFetch(input, init);
};

const locale = new URLSearchParams(window.location.search).get('locale') === 'fr' ? 'fr' : 'en';
createRoot(document.getElementById('root')!).render(
  <SuperAdminPoliciesClient locale={locale} initialPolicy={{ requireBeforePhotoToStart: null, requireAfterPhotoToFinish: null, requireAfterPhotoToPay: null, autoPostEnabled: null, autoPostAiCaptionEnabled: null }} metaStatus={{ hasSystemUserToken: false, hasFacebookPageId: false, hasInstagramAccountId: false, graphVersion: 'v25.0' }} latestFailure={null} />,
);

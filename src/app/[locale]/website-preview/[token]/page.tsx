import { notFound } from 'next/navigation';

import { CustomWebsiteFrame } from '@/features/custom-sites/CustomWebsiteFrame';
import { customSiteRendererOrigin } from '@/features/custom-sites/payload.server';
import { sharedCustomPreview } from '@/features/custom-sites/share.server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Website preview · Luster', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };
export default async function SharedWebsitePreview(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const payload = await sharedCustomPreview(token);
  const origin = customSiteRendererOrigin();
  if (!payload || !origin) {
    notFound();
  }
  return (
    <main>
      <p style={{ padding: 10, textAlign: 'center', background: '#fcf7f4', fontSize: 13 }}>Website preview · Booking is disabled · Suggested details may change</p>
      <CustomWebsiteFrame payload={payload} rendererOrigin={origin} />
    </main>
  );
}

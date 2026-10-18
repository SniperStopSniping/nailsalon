import { notFound } from 'next/navigation';

import { requireSetupOwner } from '@/features/business-setup/access.server';
import { AddOnBookingSummary } from '@/features/business-setup/AddOnBookingSummary';
import { loadSetupHead, lockSetupSalon, readSetupSnapshot } from '@/features/business-setup/drafts.server';
import { CustomWebsiteFrame } from '@/features/custom-sites/CustomWebsiteFrame';
import { customSiteRendererOrigin, setupCustomSitePayload } from '@/features/custom-sites/payload.server';
import { db } from '@/libs/DB';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function CustomBusinessSetupPreviewPage(props: {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    revision?: string;
  }>;
}) {
  const { slug } = await props.params;
  const query = await props.searchParams;
  const access = await requireSetupOwner(slug);
  if (access.response || !/^\d+$/u.test(query.revision ?? '')) {
    notFound();
  }
  const head = await db.transaction(async (tx) => {
    const salon = await lockSetupSalon(tx, access.actor);
    const draft = await loadSetupHead(tx, access.actor.salonId);
    return { ...draft, snapshot: await readSetupSnapshot(tx, salon) };
  });
  if (head.workspace.status === 'editing' && head.workspace.baselineHash !== head.snapshot.hash) {
    return <p>Your business changed elsewhere. Reload your setup before previewing.</p>;
  }
  if (head.revision.revision !== Number(query.revision)) {
    return <p>Your saved changes have moved on. Refresh the preview to see the latest version.</p>;
  }
  const custom = await setupCustomSitePayload(access.actor.salonId, head.revision.document);
  if (custom) {
    const rendererOrigin = customSiteRendererOrigin();
    return (
      <main>
        <p style={{ padding: 12, textAlign: 'center', background: '#fcf7f4' }}>
          Private draft preview · Booking is disabled.
          {' '}
          <a href={`/admin/business-setup?salon=${encodeURIComponent(slug)}`}>Return to your builder</a>
        </p>
        <AddOnBookingSummary document={head.revision.document} />
        {rendererOrigin ? <CustomWebsiteFrame payload={custom} rendererOrigin={rendererOrigin} /> : <p>The isolated preview is unavailable. Your saved design is safe.</p>}
      </main>
    );
  }
  notFound();
}

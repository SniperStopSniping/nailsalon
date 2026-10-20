import { notFound } from 'next/navigation';

import { requireSetupOwner } from '@/features/business-setup/access.server';
import { loadSetupHead, lockSetupSalon, readSetupSnapshot } from '@/features/business-setup/drafts.server';
import { SetupPreview } from '@/features/business-setup/SetupPreview';
import { db } from '@/libs/DB';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function BusinessSetupPreviewPage(props: {
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
  return <SetupPreview published={head.workspace.status === 'published'} salon={access.salon} document={head.revision.document} snapshot={head.snapshot} />;
}

import type { ReactNode } from 'react';

import { WorkspacePageHeader } from '@/components/ui/workspace-page-header';

export function OwnerWorkspaceHeader({ title, subtitle, actions }: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="owner-workspace-header">
      <WorkspacePageHeader
        title={title}
        subtitle={subtitle}
        titleClassName="owner-title owner-workspace-header__title text-[var(--owner-ink)]"
        subtitleClassName="owner-workspace-header__subtitle"
        actions={actions}
      />
    </header>
  );
}

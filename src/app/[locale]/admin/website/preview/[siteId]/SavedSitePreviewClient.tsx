'use client';

import { ArrowLeft, Monitor, MonitorSmartphone, Settings2, Smartphone, Tablet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { loadOnboardingIntegrationRecoveryRecord } from '@/features/onboarding-v1-integration/flow-storage';
import type { SavedSitePreviewModel } from '@/features/onboarding-v1-integration/saved-preview';
import { SavedPreviewAssetRepository } from '@/features/onboarding-v1-integration/saved-preview-assets';

import { CustomDesignAssetProvider } from '../../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/custom-design/integration/CustomDesignAssetProvider';
import {
  type OnboardingPreviewDevice,
  OnboardingSitePreview,
} from '../../../../../../../prototypes/site-builder-v2-booking-integration-lab/src/onboarding/preview/OnboardingSitePreview';

const DEVICES: ReadonlyArray<{
  icon: typeof Smartphone;
  id: OnboardingPreviewDevice;
  label: string;
}> = [
  { icon: Smartphone, id: 'phone', label: 'Phone' },
  { icon: Tablet, id: 'tablet', label: 'Tablet' },
  { icon: Monitor, id: 'desktop', label: 'Desktop' },
];

export function SavedSitePreviewClient({
  embedded,
  locale,
  model,
  revision,
  salonSlug,
  siteId,
  setupUrl,
  showAuditRevision,
}: {
  embedded: boolean;
  locale: string;
  model: SavedSitePreviewModel;
  revision: number;
  salonSlug: string;
  siteId: string;
  setupUrl: string;
  showAuditRevision: boolean;
}) {
  const [device, setDevice] = useState<OnboardingPreviewDevice>('phone');
  const [canChangeSetup, setCanChangeSetup] = useState(false);
  useEffect(() => {
    const recovery = loadOnboardingIntegrationRecoveryRecord();
    setCanChangeSetup(
      recovery?.siteId === siteId
      && recovery.verifiedRevision === revision,
    );
  }, [revision, siteId]);
  const repository = useMemo(
    () => new SavedPreviewAssetRepository(model.media),
    [model.media],
  );
  const reachableAssetIds = useMemo(() => () => new Set(
    model.document.pages.flatMap(page => page.sections.flatMap(section => (
      section.sectionType === 'custom_design'
        ? section.settings.images.map(image => image.assetId)
        : []
    ))),
  ), [model.document.pages]);
  const preview = (
    <div className="saved-site-preview-stage" data-theme-scope="site">
      <OnboardingSitePreview
        device={embedded ? 'phone' : device}
        document={model.document}
        fitAvailable
        interactionMode={embedded ? 'inline' : 'interactive'}
        label={embedded ? 'Saved customer website' : 'Interactive saved customer website'}
        state={model.state}
      />
    </div>
  );

  return (
    <CustomDesignAssetProvider
      getReachableAssetIds={reachableAssetIds}
      repository={repository}
    >
      {embedded
        ? (
            <main className="owner-workspace-theme saved-site-preview-embed" data-theme-scope="owner">
              {preview}
            </main>
          )
        : (
            <main className="owner-workspace-theme saved-site-preview-shell" data-theme-scope="owner">
              <header className="saved-site-preview-header px-4 pb-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] sm:px-6">
                <a
                  className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold text-[var(--owner-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                  href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}`}
                >
                  <ArrowLeft aria-hidden="true" size={18} />
                  Back to Workspace
                </a>
                <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--owner-accent)]">Saved to your account</p>
                    <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--owner-ink)]">Preview your website</h1>
                    <p className="mt-2 max-w-2xl text-[15px] leading-6 text-[var(--owner-muted)]">
                      This is the website saved from Final Review. Customer colours stay inside the Preview.
                    </p>
                    {showAuditRevision
                      ? (
                          <p className="mt-2 font-mono text-xs text-[var(--owner-muted)]">
                            Saved revision
                            {' '}
                            {revision}
                          </p>
                        )
                      : null}
                  </div>
                  <div aria-label="Preview device" className="flex rounded-full border border-[var(--owner-line)] bg-white p-1" role="group">
                    {DEVICES.map(({ icon: Icon, id, label }) => (
                      <button
                        key={id}
                        aria-pressed={device === id}
                        className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${
                          device === id
                            ? 'bg-[var(--owner-accent)] text-white'
                            : 'text-[var(--owner-muted)] hover:bg-[var(--owner-ground)]'
                        }`}
                        onClick={() => setDevice(id)}
                        type="button"
                      >
                        <Icon aria-hidden="true" size={17} />
                        <span className="hidden min-[390px]:inline">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </header>

              <div className="saved-site-preview-content px-3 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] sm:px-6">
                {preview}
                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  {canChangeSetup
                    ? (
                        <a
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--owner-line-strong)] bg-white px-5 text-sm font-semibold text-[var(--owner-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)]"
                          href={setupUrl}
                        >
                          <Settings2 aria-hidden="true" size={18} />
                          Change website setup
                        </a>
                      )
                    : null}
                  <a
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--owner-accent)] px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] focus-visible:ring-offset-2"
                    href={`/${locale}/admin?salon=${encodeURIComponent(salonSlug)}`}
                  >
                    <MonitorSmartphone aria-hidden="true" size={18} />
                    Return to Workspace
                  </a>
                </div>
              </div>
            </main>
          )}
    </CustomDesignAssetProvider>
  );
}

import { Check, ChevronDown, Circle, Monitor, Smartphone, Tablet, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useCustomDesignAssetMap } from '../../custom-design/integration/CustomDesignAssetProvider';
import type { SiteBuilderDocument } from '../../model/types';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { SCREEN_METADATA } from '../copy';
import { SITE_PALETTE_BY_ID } from '../model/palettes';
import { getSiteStyleLabel } from '../model/site-styles';
import type { OnboardingLabState, OnboardingScreenId } from '../model/types';
import { OnboardingSitePreview, type OnboardingPreviewDevice } from '../preview/OnboardingSitePreview';
import {
  getBuilderPrimaryLabel,
  getNeedsAttentionItems,
  getReadinessItems,
  type CustomDesignAssetReadiness,
  type ReadinessStatus,
} from '../progress/readiness';

const STATUS_LABELS: Record<ReadinessStatus, string> = {
  needs_attention: 'Needs attention',
  optional: 'Optional',
  ready: 'Ready',
  recommended: 'Recommended',
};

const STATUS_ICONS = {
  needs_attention: TriangleAlert,
  optional: Circle,
  ready: Check,
  recommended: Circle,
} as const;

export const BUILDER_HANDOFF_TRIGGER_ID = 'onboarding-open-builder';

type FinalReviewScreenProps = {
  document: SiteBuilderDocument | null;
  onBack: () => void;
  onEdit: (screen: OnboardingScreenId) => void;
  onEditCanva: () => void;
  onOpenBuilder: () => void;
  onOpenPreview: () => void;
  primaryActionLabel?: string;
  primarySupportingCopy?: string;
  state: OnboardingLabState;
};

export function FinalReviewScreen({
  document,
  onBack,
  onEdit,
  onEditCanva,
  onOpenBuilder,
  onOpenPreview,
  primaryActionLabel,
  primarySupportingCopy,
  state,
}: FinalReviewScreenProps) {
  const readinessContentId = useId();
  const [device, setDevice] = useState<OnboardingPreviewDevice>('phone');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compactReadiness, setCompactReadiness] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 919px)').matches
  ));
  const readinessContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 919px)');
    const update = () => setCompactReadiness(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!readinessContentRef.current) return;
    readinessContentRef.current.inert = compactReadiness && !drawerOpen;
  }, [compactReadiness, drawerOpen]);
  const customDesignImages = useMemo(() => document?.pages.flatMap((page) =>
    page.sections.flatMap((section) => section.sectionType === 'custom_design'
      ? section.settings.images
      : [])) ?? [], [document]);
  const customDesignAssetIds = useMemo(
    () => customDesignImages.map((image) => image.assetId),
    [customDesignImages],
  );
  const customDesignAssetMap = useCustomDesignAssetMap(customDesignAssetIds);
  const customDesignAssetIssues = useMemo<CustomDesignAssetReadiness[]>(() =>
    customDesignImages.flatMap((image) => {
      const status = customDesignAssetMap.get(image.assetId)?.original.status ?? 'loading';
      return status === 'ready'
        ? []
        : [{
            assetId: image.assetId,
            fileName: image.fileName,
            status: status === 'unavailable' ? 'error' as const : status,
          }];
    }), [customDesignAssetMap, customDesignImages]);
  const readiness = useMemo(
    () => getReadinessItems(state, document, customDesignAssetIssues),
    [customDesignAssetIssues, document, state],
  );
  const needsAttention = useMemo(
    () => getNeedsAttentionItems(state, document, customDesignAssetIssues),
    [customDesignAssetIssues, document, state],
  );
  const primaryLabelFromReadiness = getBuilderPrimaryLabel(
    state,
    document,
    customDesignAssetIssues,
  );
  const optionalImprovementCount = readiness.filter(
    ({ status }) => status === 'optional' || status === 'recommended',
  ).length;
  const mobileReadinessHeading = needsAttention.length === 0
    ? 'Ready to go'
    : 'Needs attention';
  const mobileReadinessSummary = needsAttention.length > 0
    ? `${needsAttention.length} ${needsAttention.length === 1 ? 'item' : 'items'} to review`
    : optionalImprovementCount > 0
      ? `${optionalImprovementCount} optional ${optionalImprovementCount === 1 ? 'improvement' : 'improvements'}`
      : 'Your website is ready';
  const readinessGroups = [
    {
      items: readiness.filter(({ status }) => status === 'needs_attention'),
      label: 'Needs attention',
    },
    {
      items: readiness.filter(({ status }) => status === 'ready'),
      label: 'Ready',
    },
    {
      items: readiness.filter(({ status }) => status === 'optional' || status === 'recommended'),
      label: 'Optional improvements',
    },
  ].filter(({ items }) => items.length > 0);
  const finalPrimaryLabel = needsAttention.length > 0
    ? primaryLabelFromReadiness
    : primaryActionLabel ?? primaryLabelFromReadiness;
  const handlePrimary = () => {
    const first = needsAttention.find((item) => item.screen);
    if (first?.screen) {
      onEdit(first.screen);
      return;
    }
    onOpenBuilder();
  };

  return (
    <div className="onboarding-screen onboarding-screen--review" data-screen="final_preview">
      <header className="onboarding-screen-heading">
        <h1>{SCREEN_METADATA.final_preview.heading}</h1>
        <p>{primarySupportingCopy ?? SCREEN_METADATA.final_preview.supportingCopy}</p>
      </header>
      <div aria-label="Customer preview device size" className="onboarding-device-switcher" role="group">
        <button aria-pressed={device === 'phone'} type="button" onClick={() => setDevice('phone')}><Smartphone aria-hidden="true" size={17} /> Phone</button>
        <button aria-pressed={device === 'tablet'} type="button" onClick={() => setDevice('tablet')}><Tablet aria-hidden="true" size={17} /> Tablet</button>
        <button aria-pressed={device === 'desktop'} type="button" onClick={() => setDevice('desktop')}><Monitor aria-hidden="true" size={17} /> Desktop</button>
      </div>
      <div className="onboarding-review-layout">
        <div className="onboarding-review-preview">
          <OnboardingSitePreview
            device={device}
            document={document}
            label={`Final ${device} customer preview`}
            state={state}
          />
          <button className="onboarding-full-preview-button" type="button" onClick={onOpenPreview}>
            Open interactive preview
          </button>
          <dl aria-label="Selected website design" className="onboarding-review-theme-summary">
            <div><dt>Website style</dt><dd>{getSiteStyleLabel(state.recipe.stylePreset)}</dd></div>
            <div><dt>Colours</dt><dd>{SITE_PALETTE_BY_ID[state.recipe.palettePreset].label}</dd></div>
          </dl>
        </div>
        <aside className={`onboarding-readiness${drawerOpen ? ' is-open' : ''}`} aria-label="Site readiness">
          <button
            aria-controls={readinessContentId}
            aria-expanded={drawerOpen}
            aria-label={`Site readiness. ${mobileReadinessHeading}. ${mobileReadinessSummary}. ${drawerOpen ? 'Hide checklist' : 'View checklist'}`}
            className="onboarding-readiness__mobile-trigger"
            type="button"
            onClick={() => setDrawerOpen((current) => !current)}
          >
            <span className="onboarding-readiness__mobile-copy">
              <strong>{mobileReadinessHeading}</strong>
              <small>{mobileReadinessSummary}</small>
            </span>
            <span className="onboarding-readiness__mobile-action">
              {drawerOpen ? 'Hide checklist' : 'View checklist'}
              <ChevronDown aria-hidden="true" size={18} />
            </span>
          </button>
          <div
            ref={readinessContentRef}
            aria-hidden={compactReadiness && !drawerOpen ? 'true' : undefined}
            className="onboarding-readiness__content"
            id={readinessContentId}
          >
            <h2>Site readiness</h2>
            <p>
              {primaryActionLabel === 'Save my site'
                ? 'Your website is ready to save to your Luster account.'
                : 'Your website is saved. You can edit it anytime from your dashboard.'}
            </p>
            {readinessGroups.map((group) => (
              <section className="onboarding-readiness__group" key={group.label}>
                <h3>{group.label}</h3>
                <ul>
              {group.items.map((item) => {
                const Icon = STATUS_ICONS[item.status];
                const editScreen = item.screen
                  ?? (item.id === 'booking-path' ? 'booking_preferences'
                    : item.id === 'business-name' ? 'business'
                      : item.id === 'contact' ? 'location_contact'
                        : item.id === 'mobile' ? 'site_style'
                          : null);
                return (
                  <li data-status={item.status} key={item.id}>
                    <Icon aria-hidden="true" size={16} />
                    <div><small>{STATUS_LABELS[item.status]}</small><strong>{item.label}</strong>{item.detail ? <p>{item.detail}</p> : null}</div>
                    {editScreen ? (
                      <button
                        aria-label={`${item.actionLabel ?? 'Edit'} ${item.label}`}
                        type="button"
                        onClick={() => {
                          if (item.id.startsWith('canva-asset-')) {
                            onEditCanva();
                            return;
                          }
                          onEdit(editScreen);
                        }}
                      >
                        {item.actionLabel ?? 'Edit'}
                      </button>
                    ) : null}
                  </li>
                );
              })}
                </ul>
              </section>
            ))}
          </div>
        </aside>
      </div>
      <StickyOnboardingActions
        backLabel="Back"
        primaryId={BUILDER_HANDOFF_TRIGGER_ID}
        primaryLabel={finalPrimaryLabel}
        skipLabel={SCREEN_METADATA.final_preview.secondaryAction}
        onBack={onBack}
        onPrimary={handlePrimary}
        onSkip={() => onEdit(needsAttention.find((item) => item.screen)?.screen ?? 'business')}
      />
    </div>
  );
}

import {
  type ComponentType,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  getSectionRegistryEntry,
  type SiteLibraryContext,
} from '../../model/section-library/registry';
import {
  getSectionContentPlacementSuppressions,
  getSectionPlanExclusion,
  type SectionPlanExclusion,
  type SitePlanOptionalToggles,
} from '../../model/site-plan';
import type {
  LibrarySectionInstance,
  LibrarySectionSettings,
  SiteBuilderDocument,
  UpdateSiteContentInput,
} from '../../model/types';
import type { BusinessProfileDraft } from '../../onboarding/model/types';
import { Dialog } from '../Dialog';
import { ChoiceField } from './fields';
import { LIBRARY_SECTION_EDITORS } from './index';
import type { LibrarySectionEditorProps } from './types';

type LibrarySectionSettingsDialogProps = {
  context: SiteLibraryContext;
  document: SiteBuilderDocument;
  onClose: () => void;
  onGoToSection: (sectionId: string) => void;
  onHideSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string) => void;
  onSave: (settings: LibrarySectionSettings) => void;
  onSiteContent: (input: UpdateSiteContentInput) => boolean;
  profile: BusinessProfileDraft;
  section: LibrarySectionInstance | null;
  toggles: SitePlanOptionalToggles;
};

/**
 * Why the customer is not seeing this section. Readiness answers for the
 * section's own content; the plan answers for the reasons a single section
 * cannot see, and both have to be sayable or the editor implies a section is
 * live when it is not.
 */
const EXCLUSION_MESSAGES: Record<SectionPlanExclusion, string | null> = {
  content_owned_elsewhere: 'This section’s shared content is already shown elsewhere.',
  dropped: 'Not on your site right now.',
  // The Builder already marks hidden sections; repeating it here would nag.
  hidden: null,
  not_enough_navigation_targets:
    'An anchor menu appears once at least two sections on this page have '
    + 'something to show.',
  // Readiness has a specific message of its own; it is preferred below.
  not_ready: null,
  page_dropped: 'This page has nothing to publish yet, so it is not on your site.',
};

const PRESET_LABELS: Record<string, string> = {
  about_before_you_book: 'Before you book',
  action_row: 'Action row',
  booking_first: 'Booking first',
  cards: 'Cards',
  carousel: 'Carousel',
  columns: 'Columns',
  compact: 'Compact',
  compact_info: 'Compact info',
  editorial: 'Editorial',
  editorial_cta: 'Editorial',
  editorial_portrait: 'Editorial portrait',
  editorial_quote: 'One big quote',
  editorial_split: 'Editorial split',
  editorial_team: 'Editorial',
  editorial_visit: 'Editorial',
  full: 'Full week',
  full_bleed: 'Full bleed',
  grid: 'Grid',
  image_cta: 'With image',
  image_right: 'Image right',
  map_details: 'Details + hours',
  photo_right: 'Photo right',
  profile_grid: 'Profile grid',
  profile_quick_facts: 'Quick facts',
  simple_banner: 'Simple banner',
  single_banner: 'Single banner',
  swipeable: 'Swipeable',
  testimonial_cards: 'Testimonial cards',
};

export function LibrarySectionSettingsDialog({
  context,
  document,
  onClose,
  onGoToSection,
  onHideSection,
  onMoveSection,
  onSave,
  onSiteContent,
  profile,
  section,
  toggles,
}: LibrarySectionSettingsDialogProps) {
  const [draft, setDraft] = useState<LibrarySectionSettings | null>(null);
  const initializedSectionId = useRef<string | null>(null);

  useEffect(() => {
    if (!section) {
      initializedSectionId.current = null;
      setDraft(null);
    } else if (initializedSectionId.current !== section.id) {
      setDraft(section.settings);
      initializedSectionId.current = section.id;
    }
  }, [section]);

  if (!section || !draft) {
    return (
      <Dialog description="" onClose={onClose} open={false} title="Edit section" variant="context-panel">
        {null}
      </Dialog>
    );
  }

  const entry = getSectionRegistryEntry(section.sectionType);
  // The registry guarantees each entry matches its key's settings type; the
  // dialog erases that correlation to render the union member.
  const Editor = LIBRARY_SECTION_EDITORS[section.sectionType] as
    ComponentType<LibrarySectionEditorProps> | undefined;
  const readiness = entry.readiness(draft as never, context);
  // The saved document, not the draft: the reasons the plan knows about are
  // about the page this section sits on, which unsaved settings cannot change.
  const exclusion = getSectionPlanExclusion(document, section.id, { context, toggles });
  const planMessage = exclusion ? EXCLUSION_MESSAGES[exclusion] : null;
  const suppressionNotices = [...new Map(
    getSectionContentPlacementSuppressions(document, section.id, { context, toggles })
      .map(notice => [`${notice.reason}:${notice.ownerSectionId ?? ''}`, notice]),
  ).values()];
  const hasPresetChoice = entry.presetIds.length > 1 && 'preset' in draft;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(draft);
  };

  return (
    <Dialog
      description={entry.description}
      onClose={onClose}
      open
      title={`Edit ${entry.label}`}
      variant="context-panel"
    >
      <form className="library-section-editor" onSubmit={submit}>
        {hasPresetChoice
          ? (
              <ChoiceField
                label="Design"
                onChange={preset => setDraft({ ...draft, preset } as LibrarySectionSettings)}
                options={entry.presetIds.map(presetId => ({
                  label: PRESET_LABELS[presetId] ?? presetId.replaceAll('_', ' '),
                  value: presetId,
                }))}
                value={(draft as { preset: string }).preset}
              />
            )
          : null}
        {Editor
          ? (
              <Editor
                context={context}
                document={document}
                onChange={next => setDraft(next)}
                onSiteContent={onSiteContent}
                profile={profile}
                sectionId={section.id}
                settings={draft as never}
              />
            )
          : (
              <p className="form-hint">
                {entry.label}
                {' '}
                shows your shared studio details automatically —
                there is nothing extra to configure here yet. You can still move,
                hide, or remove the section, and pick its design above.
              </p>
            )}
        {suppressionNotices.length > 0
          ? (
              <div aria-label="Shared content placement" className="library-editor-readiness" role="status">
                {suppressionNotices.map(notice => (
                  <div data-content-suppression={notice.contentKey} key={`${notice.contentKey}-${notice.reason}`}>
                    <p className="form-hint">{notice.reason}</p>
                    {notice.ownerSectionId && notice.actionLabel
                      ? (
                          <button
                            className="secondary-button"
                            onClick={() => onGoToSection(notice.ownerSectionId as string)}
                            type="button"
                          >
                            {notice.actionLabel}
                          </button>
                        )
                      : null}
                    {section.sectionType === 'featured_services'
                    && notice.suppressEntireSection
                      ? (
                          <div className="library-editor-placement-actions">
                            <button
                              className="secondary-button"
                              onClick={() => onMoveSection(section.id)}
                              type="button"
                            >
                              Move Featured Services to another page
                            </button>
                            {typeof notice.ownerSectionId === 'string'
                              ? (
                                  <button
                                    className="secondary-button"
                                    onClick={() => onHideSection(notice.ownerSectionId as string)}
                                    type="button"
                                  >
                                    Hide Services &amp; Booking and show Featured Services
                                  </button>
                                )
                              : null}
                          </div>
                        )
                      : null}
                  </div>
                ))}
              </div>
            )
          : null}
        {readiness.level === 'empty' && readiness.issues[0]
          ? (
              <p className="form-hint library-editor-readiness" role="status">
                Not on your site yet:
                {' '}
                {readiness.issues[0].message}
              </p>
            )
          : planMessage && suppressionNotices.length === 0
            ? (
                <p className="form-hint library-editor-readiness" role="status">
                  Not on your site yet:
                  {' '}
                  {planMessage}
                </p>
              )
            : null}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" type="submit">Save section</button>
        </div>
      </form>
    </Dialog>
  );
}

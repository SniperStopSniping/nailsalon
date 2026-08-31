import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  getSectionRegistryEntry,
  type SiteLibraryContext,
} from '../../model/section-library/registry';
import type {
  LibrarySectionInstance,
  LibrarySectionSettings,
  SiteBuilderDocument,
  UpdateSiteContentInput,
} from '../../model/types';
import type { BusinessProfileDraft } from '../../onboarding/model/types';
import type { ComponentType } from 'react';

import { Dialog } from '../Dialog';
import { ChoiceField } from './fields';
import { LIBRARY_SECTION_EDITORS } from './index';
import type { LibrarySectionEditorProps } from './types';

type LibrarySectionSettingsDialogProps = {
  context: SiteLibraryContext;
  document: SiteBuilderDocument;
  onClose: () => void;
  onSave: (settings: LibrarySectionSettings) => void;
  onSiteContent: (input: UpdateSiteContentInput) => boolean;
  profile: BusinessProfileDraft;
  section: LibrarySectionInstance | null;
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
  onSave,
  onSiteContent,
  profile,
  section,
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
        {hasPresetChoice ? (
          <ChoiceField
            label="Design"
            onChange={preset => setDraft({ ...draft, preset } as LibrarySectionSettings)}
            options={entry.presetIds.map(presetId => ({
              label: PRESET_LABELS[presetId] ?? presetId.replaceAll('_', ' '),
              value: presetId,
            }))}
            value={(draft as { preset: string }).preset}
          />
        ) : null}
        {Editor ? (
          <Editor
            context={context}
            document={document}
            onChange={next => setDraft(next)}
            onSiteContent={onSiteContent}
            profile={profile}
            settings={draft as never}
          />
        ) : (
          <p className="form-hint">
            {entry.label} shows your shared studio details automatically —
            there is nothing extra to configure here yet. You can still move,
            hide, or remove the section, and pick its design above.
          </p>
        )}
        {readiness.level === 'empty' && readiness.issues[0] ? (
          <p className="form-hint library-editor-readiness" role="status">
            Not on your site yet: {readiness.issues[0].message}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" type="submit">Save section</button>
        </div>
      </form>
    </Dialog>
  );
}

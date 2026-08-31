import type { ComponentType } from 'react';

import type { SiteLibraryContext } from '../../model/section-library/registry';
import type {
  LibrarySectionSettingsByType,
  LibrarySectionType,
  SiteBuilderDocument,
  UpdateSiteContentInput,
} from '../../model/types';
import type { BusinessProfileDraft } from '../../onboarding/model/types';

/**
 * Contract for one library section's owner editor body.
 *
 * Settings edit as a local draft the dialog saves through
 * `update_library_section_settings` (one undo step). Shared `siteContent`
 * records (staff, reviews, offers, FAQ) are NOT draft-local: record edits
 * dispatch `update_site_content` immediately, because those records are a
 * shared authority other sections may bind to.
 */
export type LibrarySectionEditorProps<
  T extends LibrarySectionType = LibrarySectionType,
> = {
  settings: LibrarySectionSettingsByType[T];
  onChange: (settings: LibrarySectionSettingsByType[T]) => void;
  context: SiteLibraryContext;
  document: SiteBuilderDocument;
  /** The shared owner profile, for showing live shared values beside overrides. */
  profile: BusinessProfileDraft;
  onSiteContent: (input: UpdateSiteContentInput) => boolean;
};

export type LibrarySectionEditor<T extends LibrarySectionType> =
  ComponentType<LibrarySectionEditorProps<T>>;

/** Each key's editor takes exactly its own settings type. */
export type LibrarySectionEditorRegistry = {
  [T in LibrarySectionType]?: LibrarySectionEditor<T>;
};

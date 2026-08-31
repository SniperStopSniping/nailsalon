import { NAVIGABLE_SECTION_TYPES } from '../../model/section-library/registry';
import type { SectionNavigationSettings } from '../../model/section-library/settings';
import type { PageDocument, SiteBuilderDocument } from '../../model/types';
import { TextField, ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/** The page this exact menu sits on — renames are keyed by section id. */
const resolveOwningPage = (
  document: SiteBuilderDocument,
  sectionId: string,
): PageDocument | null =>
  document.pages.find(page =>
    page.sections.some(section => section.id === sectionId)) ?? null;

export function SectionNavigationEditor({
  document,
  onChange,
  sectionId: menuSectionId,
  settings,
}: LibrarySectionEditorProps<'section_navigation'>) {
  const owningPage = resolveOwningPage(document, menuSectionId);
  const targets = owningPage
    ? [...owningPage.sections]
        .filter(section =>
          section.visible && NAVIGABLE_SECTION_TYPES.has(section.sectionType))
        .sort((left, right) => left.order - right.order)
    : [];

  const renameTarget = (sectionId: string, label: string) => {
    const labelOverrides = { ...settings.labelOverrides };
    if (label.trim()) {
      labelOverrides[sectionId] = label;
    } else {
      delete labelOverrides[sectionId];
    }
    onChange({ ...settings, labelOverrides } satisfies SectionNavigationSettings);
  };

  return (
    <>
      <ToggleField
        hint="The menu follows visitors as they scroll down the page."
        label="Keep the menu visible while scrolling"
        onChange={sticky => onChange({ ...settings, sticky } satisfies SectionNavigationSettings)}
        value={settings.sticky}
      />
      <p className="form-hint">
        The menu builds itself from this page’s sections, in page order, and
        appears once at least two of them have something to show.
      </p>
      {targets.length > 0 ? (
        <div className="form-field">
          <span>Menu names</span>
          {targets.map(section => (
            <TextField
              key={section.id}
              label={section.label}
              maxLength={40}
              onChange={label => renameTarget(section.id, label)}
              placeholder={section.label}
              value={settings.labelOverrides[section.id] ?? ''}
            />
          ))}
          <small className="form-hint">
            Leave a name blank to use the section’s own name. Renaming here
            only changes this menu.
          </small>
        </div>
      ) : (
        <p className="form-hint">
          This page has no sections the menu can link to yet.
        </p>
      )}
    </>
  );
}

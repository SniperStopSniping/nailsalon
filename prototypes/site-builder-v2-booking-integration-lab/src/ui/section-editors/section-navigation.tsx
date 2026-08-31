import type { SectionNavigationSettings } from '../../model/section-library/settings';
import type { PageDocument, SiteBuilderDocument } from '../../model/types';
import { TextField, ToggleField } from './fields';
import type { LibrarySectionEditorProps } from './types';

/**
 * Mirrors the anchor targets the customer renderer accepts (NAVIGABLE_TYPES
 * in `onboarding/preview/section-renderers.tsx`). Anything outside this set
 * never becomes a menu entry, so offering to rename it would be a control
 * that does nothing. Keep the two lists in step.
 */
const NAVIGABLE_SECTION_TYPES: ReadonlySet<string> = new Set([
  'about',
  'booking',
  'contact',
  'deposits_cancellations',
  'faq',
  'featured_services',
  'gallery',
  'hours',
  'offers',
  'policies',
  'reviews',
  'team',
  'visit_us',
]);

const countMenus = (page: PageDocument): number =>
  page.sections.filter(section => section.sectionType === 'section_navigation').length;

/**
 * The editor is handed settings, not its own section id, so the page a menu
 * sits on is only knowable when the document holds exactly one menu. Renames
 * are keyed by section id, so a guess would silently rename the wrong page's
 * entries.
 */
const resolveOwningPage = (document: SiteBuilderDocument): PageDocument | null => {
  const pagesWithMenu = document.pages.filter(page => countMenus(page) > 0);
  const onlyPage = pagesWithMenu.length === 1 ? pagesWithMenu[0] : undefined;
  return onlyPage && countMenus(onlyPage) === 1 ? onlyPage : null;
};

export function SectionNavigationEditor({
  document,
  onChange,
  settings,
}: LibrarySectionEditorProps<'section_navigation'>) {
  const owningPage = resolveOwningPage(document);
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
          {owningPage
            ? 'This page has no sections the menu can link to yet.'
            : 'Every entry uses its section’s own name. Rename fields appear here when your site has just one on-page menu.'}
        </p>
      )}
    </>
  );
}

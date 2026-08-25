import {
  Eye,
  EyeOff,
  FilePlus2,
  Menu,
  MoreHorizontal,
  Settings2,
} from 'lucide-react';

import type {
  PageDocument,
  SectionInstance,
  SiteBuilderDocument,
} from '../model';

type ConceptStructureTreeProps = {
  activePageId: string;
  document: SiteBuilderDocument;
  onAddPage: () => void;
  onEditPage: (page: PageDocument) => void;
  onOpenNavigation: () => void;
  onOpenRecovery: () => void;
  onSelectPage: (pageId: string) => void;
  onSelectSection: (pageId: string, section: SectionInstance) => void;
  selectedSectionId: string | null;
};

export function ConceptStructureTree({
  activePageId,
  document,
  onAddPage,
  onEditPage,
  onOpenNavigation,
  onOpenRecovery,
  onSelectPage,
  onSelectSection,
  selectedSectionId,
}: ConceptStructureTreeProps) {
  const pages = [...document.pages].sort((left, right) => left.order - right.order);

  return (
    <div className="structure-tree" data-testid="structure-tree">
      <div className="structure-tree__heading">
        <div>
          <span>Site structure</span>
          <strong>{document.siteName}</strong>
        </div>
        <button aria-label="Add page" className="icon-button" type="button" onClick={onAddPage}>
          <FilePlus2 aria-hidden="true" size={18} />
        </button>
      </div>

      <ol aria-label="Site structure pages" className="structure-tree__pages">
        {pages.map((page, pageIndex) => {
          const sections = [...page.sections].sort((left, right) => left.order - right.order);
          const active = page.id === activePageId;
          return (
            <li className={active ? 'is-active' : undefined} key={page.id}>
              <div className="structure-tree__page-row">
                <button
                  aria-current={active ? 'page' : undefined}
                  className="structure-tree__page-button"
                  type="button"
                  onClick={() => onSelectPage(page.id)}
                >
                  <span>{pageIndex + 1}</span>
                  <strong>{page.name}</strong>
                  {page.visible ? <Eye aria-label="Visible" size={15} /> : <EyeOff aria-label="Hidden" size={15} />}
                </button>
                <button aria-label={`Edit ${page.name} page`} className="structure-tree__mini-action" type="button" onClick={() => onEditPage(page)}>
                  <Settings2 aria-hidden="true" size={15} />
                </button>
              </div>

              <ol aria-label={`Sections on ${page.name}`} className="structure-tree__sections">
                {sections.map((section, sectionIndex) => {
                  const selected = section.id === selectedSectionId;
                  const protectedSection = section.sectionType === 'booking_access';
                  return (
                    <li key={section.id}>
                      <button
                        aria-current={selected ? 'true' : undefined}
                        className={selected ? 'is-selected' : undefined}
                        type="button"
                        onClick={() => onSelectSection(page.id, section)}
                      >
                        <span>{protectedSection ? 'BA' : String(sectionIndex + 1).padStart(2, '0')}</span>
                        <span><strong>{section.label}</strong><small>{section.size}{section.visible ? '' : ' · hidden'}</small></span>
                      </button>
                    </li>
                  );
                })}
                {sections.length === 0 ? <li className="structure-tree__empty">No sections yet</li> : null}
              </ol>
            </li>
          );
        })}
      </ol>

      <div className="structure-tree__footer">
        <button type="button" onClick={onOpenNavigation}><Menu aria-hidden="true" size={17} /> Navigation</button>
        <button type="button" onClick={onOpenRecovery}><MoreHorizontal aria-hidden="true" size={17} /> Pages &amp; recovery</button>
      </div>
    </div>
  );
}

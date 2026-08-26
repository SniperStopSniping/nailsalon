import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  EyeOff,
  FilePlus2,
  GripVertical,
  Menu,
  Pencil,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type {
  PageDocument,
  PlaceholderSectionInstance,
  SectionInstance,
  SiteBuilderDocument,
} from '../model';

type StructureView = 'overview' | 'navigation' | 'removed-pages' | 'removed-sections';

type FinalStructurePanelProps = {
  activePageId: string;
  document: SiteBuilderDocument;
  onAddPage: () => void;
  onEditPage: (page: PageDocument) => void;
  onEnterReorder: () => void;
  onMoveNavigationItem: (pageId: string, position: number) => void;
  onMovePage: (page: PageDocument, position: number) => void;
  onRemovePage: (page: PageDocument) => void;
  onRenameNavigationItem: (pageId: string, label: string) => void;
  onRestorePage: (pageId: string) => void;
  onRestoreSection: (section: PlaceholderSectionInstance) => void;
  onSelectPage: (pageId: string) => void;
  onSelectSection: (pageId: string, section: SectionInstance) => void;
  onToggleNavigation: () => void;
  open: boolean;
  selectedSectionId: string | null;
};

export function FinalStructurePanel({
  activePageId,
  document,
  onAddPage,
  onEditPage,
  onEnterReorder,
  onMoveNavigationItem,
  onMovePage,
  onRemovePage,
  onRenameNavigationItem,
  onRestorePage,
  onRestoreSection,
  onSelectPage,
  onSelectSection,
  onToggleNavigation,
  open,
  selectedSectionId,
}: FinalStructurePanelProps) {
  const [view, setView] = useState<StructureView>('overview');
  const pages = [...document.pages].sort((left, right) => left.order - right.order);
  const navigationItems = [...document.navigation.items].sort((left, right) => left.order - right.order);

  useEffect(() => {
    if (!open) {
      setView('overview');
    }
  }, [open]);

  if (view === 'navigation') {
    return (
      <div className="final-structure final-structure--subview">
        <button className="final-structure__back" type="button" onClick={() => setView('overview')}>
          <ArrowLeft aria-hidden="true" size={18} /> Pages &amp; Structure
        </button>
        <div className="final-structure__section-heading">
          <div><span>Client menu</span><strong>Menu</strong></div>
          <button
            aria-checked={document.navigation.enabled}
            aria-label="Show navigation menu"
            className="switch"
            role="switch"
            type="button"
            onClick={onToggleNavigation}
          />
        </div>
        <p className="final-structure__hint">
          {document.navigation.enabled
            ? 'Clients can use this menu to move between visible pages.'
            : 'The menu is off. Your pages remain available in the editor.'}
        </p>
        {document.navigation.enabled ? (
          <ol aria-label="Menu order" className="final-structure__menu-list">
            {navigationItems.map((item, index) => {
              const page = document.pages.find((candidate) => candidate.id === item.pageId);
              return (
                <li key={item.id}>
                  <label>
                    <span>{page?.name ?? 'Page'}{page?.visibleInNavigation ? '' : ' · hidden from menu'}</span>
                    <input
                      aria-label={`Menu label for ${page?.name ?? 'page'}`}
                      defaultValue={item.label}
                      key={`${item.id}-${item.label}`}
                      onBlur={(event) => {
                        const label = event.target.value.trim();
                        if (label && label !== item.label) {
                          onRenameNavigationItem(item.pageId, label);
                        }
                      }}
                    />
                  </label>
                  <div className="final-structure__row-actions">
                    <button aria-label={`Move ${item.label} up in menu`} disabled={index === 0} type="button" onClick={() => onMoveNavigationItem(item.pageId, index)}><ArrowUp aria-hidden="true" size={18} /></button>
                    <button aria-label={`Move ${item.label} down in menu`} disabled={index === navigationItems.length - 1} type="button" onClick={() => onMoveNavigationItem(item.pageId, index + 2)}><ArrowDown aria-hidden="true" size={18} /></button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    );
  }

  if (view === 'removed-sections') {
    return (
      <div className="final-structure final-structure--subview">
        <button className="final-structure__back" type="button" onClick={() => setView('overview')}><ArrowLeft aria-hidden="true" size={18} /> Pages &amp; Structure</button>
        <div className="final-structure__section-heading"><div><span>Recoverable content</span><strong>Removed sections</strong></div><b>{document.unusedSections.length}</b></div>
        {document.unusedSections.length > 0 ? (
          <ul aria-label="Removed sections" className="final-structure__recovery-list">
            {document.unusedSections.map((section) => (
              <li data-section-id={section.id} key={section.id}>
                <span><strong>{section.label}</strong><small>{section.size} · settings retained</small></span>
                <button aria-label={`Restore ${section.label} to the current page`} type="button" onClick={() => onRestoreSection(section)}><RotateCcw aria-hidden="true" size={17} /> Restore to current page</button>
              </li>
            ))}
          </ul>
        ) : <p className="final-structure__empty">Sections you remove will wait here safely.</p>}
      </div>
    );
  }

  if (view === 'removed-pages') {
    return (
      <div className="final-structure final-structure--subview">
        <button className="final-structure__back" type="button" onClick={() => setView('overview')}><ArrowLeft aria-hidden="true" size={18} /> Pages &amp; Structure</button>
        <div className="final-structure__section-heading"><div><span>Recoverable content</span><strong>Removed pages</strong></div><b>{document.removedPages.length}</b></div>
        {document.removedPages.length > 0 ? (
          <ul aria-label="Removed pages" className="final-structure__recovery-list">
            {document.removedPages.map((record) => (
              <li data-page-id={record.page.id} key={record.page.id}>
                <span><strong>{record.page.name}</strong><small>{record.sectionIds.length} section{record.sectionIds.length === 1 ? '' : 's'} retained</small></span>
                <button aria-label={`Restore ${record.page.name} page`} type="button" onClick={() => onRestorePage(record.page.id)}><RotateCcw aria-hidden="true" size={17} /> Restore page</button>
              </li>
            ))}
          </ul>
        ) : <p className="final-structure__empty">Pages you remove will wait here safely.</p>}
      </div>
    );
  }

  return (
    <div className="final-structure" data-final-panel="pages-structure" data-testid="structure-tree">
      <div className="final-structure__summary">
        <div><span>Your website</span><strong>{document.siteName}</strong><small>{pages.length} page{pages.length === 1 ? '' : 's'}</small></div>
        <button type="button" onClick={onAddPage}><FilePlus2 aria-hidden="true" size={18} /> Add page</button>
      </div>

      <ol aria-label="Site pages" className="final-structure__pages">
        {pages.map((page, pageIndex) => {
          const active = page.id === activePageId;
          const sections = [...page.sections].sort((left, right) => left.order - right.order);
          return (
            <li className={active ? 'is-active' : undefined} key={page.id}>
              <div className="final-structure__page-row">
                <button
                  aria-current={active ? 'page' : undefined}
                  className="final-structure__page-select"
                  type="button"
                  onClick={() => onSelectPage(page.id)}
                >
                  <span>{pageIndex + 1}</span>
                  <span><strong>{page.name}</strong><small>{page.visible ? `${sections.length} section${sections.length === 1 ? '' : 's'}` : 'Page hidden'}</small></span>
                  {page.visible ? <Eye aria-label="Visible" size={16} /> : <EyeOff aria-label="Hidden" size={16} />}
                </button>
                <button aria-label={`Page settings for ${page.name}`} className="final-structure__icon-button" type="button" onClick={() => onEditPage(page)}><Settings2 aria-hidden="true" size={17} /></button>
              </div>

              {active ? (
                <div className="final-structure__active-page">
                  <ol aria-label={`Sections on ${page.name}`} className="final-structure__sections">
                    {sections.map((section, sectionIndex) => {
                      const selected = section.id === selectedSectionId;
                      const booking = section.sectionType === 'booking';
                      const sectionLabel = booking ? 'Booking' : section.label;
                      const sectionDescription = booking
                        ? `Client booking menu · always available${section.visible ? '' : ' · hidden'}`
                        : `${section.size}${section.visible ? '' : ' · hidden'}`;
                      return (
                        <li key={section.id}>
                          <button
                            aria-pressed={selected}
                            className={selected ? 'is-selected' : undefined}
                            type="button"
                            onClick={() => onSelectSection(page.id, section)}
                          >
                            <span>{booking ? 'BK' : String(sectionIndex + 1).padStart(2, '0')}</span>
                            <span><strong>{sectionLabel}</strong><small>{sectionDescription}</small></span>
                          </button>
                        </li>
                      );
                    })}
                    {sections.length === 0 ? <li className="final-structure__empty">This page is empty. Add a section to start building it.</li> : null}
                  </ol>

                  <div className="final-structure__page-actions">
                    {sections.length > 1 ? <button type="button" onClick={onEnterReorder}><GripVertical aria-hidden="true" size={17} /> Arrange sections</button> : null}
                    <button aria-label={`Move ${page.name} page up`} disabled={pageIndex === 0} type="button" onClick={() => onMovePage(page, pageIndex)}><ArrowUp aria-hidden="true" size={17} /></button>
                    <button aria-label={`Move ${page.name} page down`} disabled={pageIndex === pages.length - 1} type="button" onClick={() => onMovePage(page, pageIndex + 2)}><ArrowDown aria-hidden="true" size={17} /></button>
                    {!page.isHome ? <button aria-label={`Remove ${page.name} page`} className="is-danger" type="button" onClick={() => onRemovePage(page)}><Trash2 aria-hidden="true" size={17} /></button> : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="final-structure__secondary">
        <button type="button" onClick={() => setView('navigation')}><Menu aria-hidden="true" size={18} /><span><strong>Menu</strong><small>{document.navigation.enabled ? 'On' : 'Off'}</small></span><Pencil aria-hidden="true" size={16} /></button>
        {document.unusedSections.length > 0 ? <button type="button" onClick={() => setView('removed-sections')}><RotateCcw aria-hidden="true" size={18} /><span><strong>Removed sections</strong><small>{document.unusedSections.length} ready to restore</small></span><b>{document.unusedSections.length}</b></button> : null}
        {document.removedPages.length > 0 ? <button type="button" onClick={() => setView('removed-pages')}><RotateCcw aria-hidden="true" size={18} /><span><strong>Removed pages</strong><small>{document.removedPages.length} ready to restore</small></span><b>{document.removedPages.length}</b></button> : null}
      </div>
    </div>
  );
}

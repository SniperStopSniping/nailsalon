import { ArrowDown, ArrowUp, Eye, EyeOff, Menu, Pencil, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';

import type { PageDocument, SectionInstance, SiteBuilderDocument } from '../model';

type PagesPanelProps = {
  activePageId: string;
  document: SiteBuilderDocument;
  onAddPage: () => void;
  onEditNavigation: () => void;
  onEditPage: (page: PageDocument) => void;
  onMovePage: (page: PageDocument, position: number) => void;
  onRemovePage: (page: PageDocument) => void;
  onRestorePage: (pageId: string) => void;
  onRestoreSection: (section: SectionInstance) => void;
  onSelectPage: (pageId: string) => void;
  onToggleNavigation: () => void;
};

export function PagesPanel({
  activePageId,
  document,
  onAddPage,
  onEditNavigation,
  onEditPage,
  onMovePage,
  onRemovePage,
  onRestorePage,
  onRestoreSection,
  onSelectPage,
  onToggleNavigation,
}: PagesPanelProps) {
  const pages = [...document.pages].sort((left, right) => left.order - right.order);

  return (
    <div aria-label="Site pages and navigation">
      <section className="panel-section">
        <div className="panel-heading"><h2>Pages</h2><span className="panel-count">{pages.length}</span></div>
        <ol className="page-list" aria-label="Site pages">
          {pages.map((page, index) => (
            <li className={`page-list-item${page.id === activePageId ? ' is-active' : ''}`} data-page-id={page.id} key={page.id}>
              <button aria-current={page.id === activePageId ? 'page' : undefined} className="page-list-button" type="button" onClick={() => onSelectPage(page.id)}>
                <span className="page-list-button__number">{index + 1}</span>
                <span className="page-list-button__copy"><strong>{page.name}</strong><span>{page.isHome ? 'Home' : `/${page.slug}`}{page.visible ? '' : ' · hidden'}</span></span>
                {page.visible ? <Eye aria-label="Visible" size={15} /> : <EyeOff aria-label="Hidden" size={15} />}
              </button>
              <div className="page-list-actions" aria-label={`Page actions for ${page.name}`}>
                <button aria-label={`Move ${page.name} up`} disabled={index === 0} type="button" onClick={() => onMovePage(page, index)}><ArrowUp aria-hidden="true" size={16} /></button>
                <button aria-label={`Move ${page.name} down`} disabled={index === pages.length - 1} type="button" onClick={() => onMovePage(page, index + 2)}><ArrowDown aria-hidden="true" size={16} /></button>
                <button aria-label={`Edit ${page.name} page`} type="button" onClick={() => onEditPage(page)}><Pencil aria-hidden="true" size={16} /></button>
                <button aria-label={`Remove ${page.name} page`} disabled={page.isHome} type="button" onClick={() => onRemovePage(page)}><Trash2 aria-hidden="true" size={16} /></button>
              </div>
            </li>
          ))}
        </ol>
        <button className="secondary-button panel-full-button" type="button" onClick={onAddPage}><Plus aria-hidden="true" size={17} /> Add page</button>
      </section>

      <section className="panel-section">
        <div className="panel-heading"><h2>Navigation</h2><button className="icon-button" aria-label="Open navigation settings" type="button" onClick={onEditNavigation}><Settings2 aria-hidden="true" size={17} /></button></div>
        <div className="switch-row">
          <span className="switch-row__copy"><strong>Navigation menu</strong><span>{document.navigation.enabled ? 'Visible in Preview' : 'Off — simple page header'}</span></span>
          <button aria-checked={document.navigation.enabled} aria-label="Navigation menu" className="switch" role="switch" type="button" onClick={onToggleNavigation} />
        </div>
        {document.navigation.enabled ? (
          <ul className="nav-item-list" aria-label="Navigation order">
            {[...document.navigation.items].sort((left, right) => left.order - right.order).map((item) => {
              const page = document.pages.find((candidate) => candidate.id === item.pageId);
              return (
                <li className="nav-item-row" key={item.id}>
                  <div className="nav-item-row__copy"><strong>{item.label}</strong><span>{page?.visibleInNavigation ? 'Shown' : 'Hidden from menu'}</span></div>
                  <Menu aria-hidden="true" size={17} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="panel-section">
        <div className="panel-heading"><h2>Unused sections</h2><span className="panel-count">{document.unusedSections.length}</span></div>
        {document.unusedSections.length > 0 ? (
          <ul className="recover-list" aria-label="Unused sections">
            {document.unusedSections.map((section) => (
              <li className="recover-row" data-section-id={section.id} key={section.id}>
                <div className="recover-row__copy"><strong>{section.label}</strong><span>{section.size} · settings retained</span></div>
                <button className="icon-button" aria-label={`Restore ${section.label} to current page`} type="button" onClick={() => onRestoreSection(section)}><RotateCcw aria-hidden="true" size={16} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="inspector-placeholder">Removed sections will wait here safely.</p>}
      </section>

      <section className="panel-section">
        <div className="panel-heading"><h2>Removed pages</h2><span className="panel-count">{document.removedPages.length}</span></div>
        {document.removedPages.length > 0 ? (
          <ul className="recover-list" aria-label="Removed pages">
            {document.removedPages.map((record) => (
              <li className="recover-row" data-page-id={record.page.id} key={record.page.id}>
                <div className="recover-row__copy"><strong>{record.page.name}</strong><span>{record.sectionIds.length} section{record.sectionIds.length === 1 ? '' : 's'} retained</span></div>
                <button className="icon-button" aria-label={`Restore ${record.page.name} page`} type="button" onClick={() => onRestorePage(record.page.id)}><RotateCcw aria-hidden="true" size={16} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="inspector-placeholder">Removed pages can be restored here.</p>}
      </section>
    </div>
  );
}

type InspectorPanelProps = {
  page: PageDocument;
  section: SectionInstance | null;
  onEditPage: () => void;
  onEditSection: (section: SectionInstance) => void;
  onMoveSection: (section: SectionInstance) => void;
  onRemoveSection: (section: SectionInstance) => void;
  onToggleSection: (section: SectionInstance) => void;
};

export function InspectorPanel({ page, section, onEditPage, onEditSection, onMoveSection, onRemoveSection, onToggleSection }: InspectorPanelProps) {
  return (
    <div>
      <section className="panel-section">
        <div className="panel-heading"><h2>Selected item</h2></div>
        {section ? (
          <div className="inspector-selected">
            <h2>{section.label}</h2>
            <p className="inspector-selected__meta">{section.size} · {section.visible ? 'Shown' : 'Hidden'}<br />ID remains stable when moved or restored.</p>
            <button className="secondary-button panel-full-button" type="button" onClick={() => onEditSection(section)}><Pencil aria-hidden="true" size={16} /> Edit settings</button>
            <button className="secondary-button panel-full-button" type="button" onClick={() => onToggleSection(section)}>{section.visible ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}{section.visible ? 'Hide section' : 'Show section'}</button>
            <button className="secondary-button panel-full-button" type="button" onClick={() => onMoveSection(section)}><Menu aria-hidden="true" size={16} /> Move to another page</button>
            <button className="secondary-button panel-full-button" type="button" onClick={() => onRemoveSection(section)}><Trash2 aria-hidden="true" size={16} /> Remove from this page</button>
          </div>
        ) : <p className="inspector-placeholder">Select a section on the canvas to inspect it. On mobile, its actions stay on the section card.</p>}
      </section>
      <section className="panel-section">
        <div className="panel-heading"><h2>Current page</h2></div>
        <div className="inspector-selected"><h2>{page.name}</h2><p className="inspector-selected__meta">{page.isHome ? 'Home' : `/${page.slug}`} · {page.visible ? 'Visible' : 'Hidden'}<br />{page.sections.length} section{page.sections.length === 1 ? '' : 's'}</p><button className="secondary-button panel-full-button" type="button" onClick={onEditPage}><Settings2 aria-hidden="true" size={16} /> Page settings</button></div>
      </section>
      <section className="panel-section">
        <div className="panel-heading"><h2>Starting history</h2></div>
        <p className="inspector-placeholder">The starting kit is recorded as metadata only. It does not limit this editor.</p>
      </section>
    </div>
  );
}

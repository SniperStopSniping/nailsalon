import { ArrowDown, ArrowUp, Download, FileUp, ImageUp, Maximize2, Plus, Redo2, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { BookingTokenPresetId, ImageFixture, MenuSize } from '../booking/types';
import {
  ADD_SECTION_CATALOGUE,
  type AddSectionLibraryItem,
  type CatalogueSectionType,
  getAddSectionLibrary,
  getNormalV1AddSectionTypes,
  type LibrarySectionType,
  type OriginStarter,
  type PageDocument,
  type PlaceholderSectionInstance,
  type RestorableSectionInstance,
  type SectionSize,
  type SiteBuilderDocument,
} from '../model';
import { Dialog } from './Dialog';

type LibraryAddState =
  | { blocked: true; reason: string }
  | { blocked: false };

type SectionLibraryDialogProps = {
  auditMode: boolean;
  businessStructure: 'multi_tech' | 'solo' | null;
  document: SiteBuilderDocument;
  insertionPosition: number | null;
  libraryAddState: (sectionType: LibrarySectionType) => LibraryAddState;
  onAdd: (
    sectionType: CatalogueSectionType | 'booking' | 'custom_design',
    size?: SectionSize,
  ) => void;
  onAddLibrary: (sectionType: LibrarySectionType) => void;
  onClose: () => void;
  onGoToBooking: () => void;
  onRestore: (
    section: RestorableSectionInstance,
    position?: number,
  ) => void;
  page: PageDocument;
};

const LIBRARY_CATEGORY_LABELS: Record<AddSectionLibraryItem['category'], string> = {
  booking: 'Booking',
  composition: 'Structure & chrome',
  conversion: 'First impressions & conversion',
  media: 'Media',
  operations: 'Practical details',
  portfolio: 'Work & offers',
  trust: 'Trust & story',
};

const LIBRARY_CATEGORY_ORDER: readonly AddSectionLibraryItem['category'][] = [
  'conversion',
  'portfolio',
  'trust',
  'operations',
  'composition',
  'booking',
  'media',
];

export function SectionLibraryDialog({
  auditMode,
  businessStructure,
  document,
  insertionPosition,
  libraryAddState,
  onAdd,
  onAddLibrary,
  onClose,
  onGoToBooking,
  onRestore,
  page,
}: SectionLibraryDialogProps) {
  const [search, setSearch] = useState('');
  const activeTypes = new Set(document.pages.flatMap((candidate) => candidate.sections.map((section) => section.sectionType)));
  const unusedTypes = new Set(document.unusedSections.map((section) => section.sectionType));
  const normalizedSearch = auditMode ? search.trim().toLocaleLowerCase() : '';
  const visibleItems = auditMode ? ADD_SECTION_CATALOGUE.filter((item) => {
    if (!normalizedSearch) return true;
    const searchable = item.sectionType === 'custom_design'
      ? [item.label, item.description, item.helper, ...item.searchKeywords, ...item.tags]
      : [item.label, item.defaultSize, 'placeholder', 'future section'];
    return searchable.some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  }) : [];
  const bookingMatches = auditMode
    && (!normalizedSearch || 'booking client service menu'.includes(normalizedSearch));
  const normalSectionTypes = new Set<LibrarySectionType | 'booking'>(getNormalV1AddSectionTypes({
    businessStructure,
    document,
    page,
  }));
  const libraryItems = getAddSectionLibrary().filter((item) => {
    if (!auditMode && !normalSectionTypes.has(item.sectionType)) return false;
    if (!normalizedSearch) return true;
    return [item.label, item.description, item.category, item.sectionType]
      .some(value => value.toLocaleLowerCase().includes(normalizedSearch));
  });
  const normalBookingAvailable = !auditMode && normalSectionTypes.has('booking');
  const libraryByCategory = LIBRARY_CATEGORY_ORDER
    .map(category => ({
      category,
      items: libraryItems.filter(item => item.category === category),
    }))
    .filter(group => group.items.length > 0);

  useEffect(() => {
    if (insertionPosition === null) setSearch('');
  }, [insertionPosition]);

  return (
    <Dialog
      description={auditMode
        ? `Choose what to add to ${page.name}${insertionPosition ? ` at position ${insertionPosition}` : ''}. Booking is already included and can move anywhere in your site.`
        : `Choose a missing core section for ${page.name}. Your shared business information stays connected.`}
      onClose={onClose}
      open={insertionPosition !== null}
      title="Add section"
      variant="section-library"
    >
      <div className="section-library-intro">
        <strong>{auditMode ? 'Section library' : 'Core website sections'}</strong>
        <span>{auditMode
          ? 'All starting points use the same library.'
          : 'Only sections that belong on this page are shown.'}</span>
      </div>
      {auditMode ? <label className="section-library-search">
        <span className="visually-hidden">Search sections</span>
        <Search aria-hidden="true" size={18} />
        <input
          autoComplete="off"
          placeholder="Search Canva, policies, booking…"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label> : null}
      {libraryByCategory.map(group => (
        <section aria-label={LIBRARY_CATEGORY_LABELS[group.category]} className="section-library-category" key={group.category}>
          <h3 className="section-library-category__title">{LIBRARY_CATEGORY_LABELS[group.category]}</h3>
          <div className="section-library-grid">
            {group.items.map((item) => {
              const addState = libraryAddState(item.sectionType);
              const itemDescription = !auditMode && item.sectionType === 'visit_us'
                ? 'Location, hours, arrival details, and public contact actions in one place.'
                : item.description;
              const itemLabel = !auditMode && item.sectionType === 'visit_us'
                ? 'Visit & Contact'
                : item.label;
              const activeCount = document.pages.reduce(
                (count, candidate) => count + candidate.sections.filter(
                  section => section.sectionType === item.sectionType,
                ).length,
                0,
              );
              const removedInstances = document.unusedSections.filter(
                section => section.sectionType === item.sectionType,
              );
              const visibleRemovedInstances = auditMode
                ? removedInstances
                : removedInstances.slice(0, 1);
              const stateLabel = activeCount > 0
                ? `${activeCount} in use`
                : removedInstances.length > 0
                  ? 'Removed'
                  : 'Available';
              return (
                <article className="library-item library-item--named" data-section-type={item.sectionType} key={item.sectionType}>
                  <div className="library-item__copy">
                    <strong>{itemLabel}</strong>
                    <span>{itemDescription}</span>
                    <span className="library-state">{stateLabel}</span>
                    {visibleRemovedInstances.map(section => (
                      <button
                        className="library-add-button library-restore-button"
                        key={section.id}
                        type="button"
                        onClick={() => onRestore(section, insertionPosition ?? undefined)}
                      >
                        <RotateCcw aria-hidden="true" size={15} />
                        <span>Restore removed {section.label}</span>
                      </button>
                    ))}
                    {auditMode || removedInstances.length === 0 ? (
                      <button
                        aria-haspopup={addState.blocked ? 'dialog' : undefined}
                        className="library-add-button"
                        type="button"
                        onClick={() => onAddLibrary(item.sectionType)}
                      >
                        <Plus aria-hidden="true" size={15} /> {addState.blocked ? addState.reason : `Add ${itemLabel}`}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <div className="section-library-grid">
        {visibleItems.map((item) => {
          if (item.sectionType === 'custom_design') {
            const activeCount = document.pages.reduce(
              (count, candidate) => count + candidate.sections.filter(
                (section) => section.sectionType === 'custom_design',
              ).length,
              0,
            );
            const removedCustomDesigns = document.unusedSections.filter(
              (section) => section.sectionType === 'custom_design',
            );
            const stateParts = [
              activeCount > 0 ? `${activeCount} in use` : '',
              removedCustomDesigns.length > 0
                ? `${removedCustomDesigns.length} removed`
                : '',
            ].filter(Boolean);
            const state = stateParts.length > 0 ? stateParts.join(' · ') : 'Available';
            return (
              <article className="library-item library-item--custom-design" data-section-type="custom_design" key={item.sectionType}>
                <div className="library-item__preview"><ImageUp aria-hidden="true" size={30} /></div>
                <div className="library-item__copy">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                  <span className="library-item__helper">{item.helper}</span>
                  <span className="library-state">{state}</span>
                  <span className="library-item__tags" aria-label="Custom Design tags">
                    {item.tags.map((tag) => <small key={tag}>{tag}</small>)}
                  </span>
                  {removedCustomDesigns.length > 0 ? (
                    <div className="library-restore-list" aria-label="Removed Custom Design sections">
                      {removedCustomDesigns.map((section, index) => {
                        const imageCount = section.settings.images.length;
                        const restoreLabel = removedCustomDesigns.length === 1
                          ? 'Restore removed Custom Design'
                          : `Restore removed Custom Design ${index + 1} of ${removedCustomDesigns.length}, ${imageCount} ${imageCount === 1 ? 'image' : 'images'}`;
                        return (
                          <button
                            aria-label={restoreLabel}
                            className="library-add-button library-restore-button"
                            key={section.id}
                            type="button"
                            onClick={() => onRestore(
                              section,
                              insertionPosition ?? undefined,
                            )}
                          >
                            <RotateCcw aria-hidden="true" size={15} />
                            <span>
                              Restore removed {section.label}
                              <small>
                                {removedCustomDesigns.length > 1
                                  ? `Removed ${index + 1} of ${removedCustomDesigns.length} · `
                                  : ''}
                                {imageCount} {imageCount === 1 ? 'image' : 'images'} · {section.visible ? 'shown' : 'hidden'}
                              </small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <button className="library-add-button" type="button" onClick={() => onAdd('custom_design')}>
                    <Plus aria-hidden="true" size={15} /> {removedCustomDesigns.length > 0 || activeCount > 0
                      ? 'Add another Custom Design'
                      : 'Add Custom Design'}
                  </button>
                </div>
              </article>
            );
          }
          const state = activeTypes.has(item.sectionType) ? 'Currently used' : unusedTypes.has(item.sectionType) ? 'Removed' : 'Available';
          return (
            <article className="library-item" key={item.sectionType}>
              <div className="library-item__preview">{item.label.replace('Section ', '')}</div>
              <div className="library-item__copy">
                <strong>{item.label}</strong>
                <span>{item.defaultSize} placeholder</span>
                <span className="library-state">{state}</span>
                <button className="library-add-button" type="button" onClick={() => onAdd(item.sectionType, item.defaultSize)}>
                  <Plus aria-hidden="true" size={15} /> Add {item.label}
                </button>
              </div>
            </article>
          );
        })}
        {bookingMatches ? <article className="library-item" data-section-type="booking">
          <div className="library-item__preview">B</div>
          <div className="library-item__copy">
            <strong>Booking</strong>
            <span>Client service menu</span>
            <span className="library-state">Currently used</span>
            <button
              aria-label="Go to Booking"
              className="library-add-button"
              type="button"
              onClick={onGoToBooking}
            >
              Go to Booking
            </button>
          </div>
        </article> : normalBookingAvailable ? (
          <article className="library-item" data-section-type="booking">
            <div className="library-item__preview">B</div>
            <div className="library-item__copy">
              <strong>Services &amp; Booking</strong>
              <span>Your single service catalogue and booking experience.</span>
              <span className="library-state">Available</span>
              <button
                className="library-add-button"
                type="button"
                onClick={() => onAdd('booking')}
              >
                <Plus aria-hidden="true" size={15} /> Add Services &amp; Booking
              </button>
            </div>
          </article>
        ) : null}
        {visibleItems.length === 0 && libraryItems.length === 0 && !bookingMatches && !normalBookingAvailable ? (
          <p className="section-library-empty">{auditMode
            ? `No sections match “${search.trim()}”. Try hero, reviews, hours, or Canva.`
            : `Every core section available for ${page.name} is already in your website.`}</p>
        ) : null}
      </div>
    </Dialog>
  );
}

type SectionSettingsDialogProps = {
  onClose: () => void;
  onSave: (values: { note: string; size: SectionSize }) => void;
  section: PlaceholderSectionInstance | null;
};

export function SectionSettingsDialog({ onClose, onSave, section }: SectionSettingsDialogProps) {
  const [note, setNote] = useState('');
  const [size, setSize] = useState<SectionSize>('medium');
  const initializedSectionId = useRef<string | null>(null);

  useEffect(() => {
    if (!section) {
      initializedSectionId.current = null;
    } else if (initializedSectionId.current !== section.id) {
      setNote(section.placeholderSettings.note ?? '');
      setSize(section.size);
      initializedSectionId.current = section.id;
    }
  }, [section]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ note, size });
  };

  return (
    <Dialog description="Adjust this placeholder. Real section controls will use this same editing space later." onClose={onClose} open={section !== null} title={section ? `Edit ${section.label}` : 'Edit section'} variant="context-panel">
      <form onSubmit={submit}>
        <label className="form-field">
          <span>Placeholder size</span>
          <select value={size} onChange={(event) => setSize(event.target.value as SectionSize)}>
            <option value="compact">Compact</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label className="form-field">
          <span>Owner note</span>
          <textarea maxLength={240} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note for this future section" />
        </label>
        <p className="form-hint">These settings stay with the section when it moves or is restored.</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit">Save section settings</button>
        </div>
      </form>
    </Dialog>
  );
}

type AddPageDialogProps = {
  onAdd: (name: string, slug: string) => void;
  onClose: () => void;
  open: boolean;
};

export function AddPageDialog({ onAdd, onClose, open }: AddPageDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  useEffect(() => { if (open) { setName(''); setSlug(''); } }, [open]);

  return (
    <Dialog description="Add pages anytime, no matter where you started." onClose={onClose} open={open} title="Add page" variant="context-panel">
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onAdd(name.trim(), slug); }}>
        <label className="form-field"><span>Page name</span><input autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} placeholder="Gallery" /></label>
        <details className="advanced-settings"><summary>Advanced</summary><label className="form-field"><span>Web address</span><input autoComplete="off" value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="gallery" /></label><p className="form-hint">Leave this blank and Luster will create it from the page name.</p></details>
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()} type="submit">Add page</button></div>
      </form>
    </Dialog>
  );
}

type PageSettingsDialogProps = {
  onClose: () => void;
  onSave: (values: { name: string; slug: string; visible: boolean; visibleInNavigation: boolean }) => void;
  page: PageDocument | null;
};

export function PageSettingsDialog({ onClose, onSave, page }: PageSettingsDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [visible, setVisible] = useState(true);
  const [visibleInNavigation, setVisibleInNavigation] = useState(true);
  const initializedPageId = useRef<string | null>(null);
  useEffect(() => {
    if (!page) {
      initializedPageId.current = null;
    } else if (initializedPageId.current !== page.id) {
      setName(page.name);
      setSlug(page.slug);
      setVisible(page.visible);
      setVisibleInNavigation(page.visibleInNavigation);
      initializedPageId.current = page.id;
    }
  }, [page]);

  return (
    <Dialog description={page?.isHome ? 'Home always remains your main page, but its name and visibility can change.' : 'Choose how this page appears to clients.'} onClose={onClose} open={page !== null} title={page ? `${page.name} settings` : 'Page settings'} variant="context-panel">
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave({ name: name.trim(), slug, visible, visibleInNavigation }); }}>
        <label className="form-field"><span>Page name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="switch-row"><span className="switch-row__copy"><strong>Show page</strong><span>Hidden pages stay editable.</span></span><button aria-checked={visible} aria-label="Show page" className="switch" role="switch" type="button" onClick={() => setVisible((value) => !value)} /></div>
        <div className="switch-row"><span className="switch-row__copy"><strong>Show in menu</strong><span>Choose whether clients see this page in your menu.</span></span><button aria-checked={visibleInNavigation} aria-label="Show page in menu" className="switch" role="switch" type="button" onClick={() => setVisibleInNavigation((value) => !value)} /></div>
        <details className="advanced-settings"><summary>Advanced</summary><label className="form-field"><span>Web address</span><input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={page?.isHome ? 'Home uses the main address' : 'page-address'} /></label></details>
        <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!name.trim()} type="submit">Save page</button></div>
      </form>
    </Dialog>
  );
}

type NavigationSettingsDialogProps = {
  document: SiteBuilderDocument;
  onClose: () => void;
  onMove: (pageId: string, position: number) => void;
  onRename: (pageId: string, label: string) => void;
  open: boolean;
};

export function NavigationSettingsDialog({ document, onClose, onMove, onRename, open }: NavigationSettingsDialogProps) {
  const items = [...document.navigation.items].sort((left, right) => left.order - right.order);
  return (
    <Dialog description="Reorder pages and choose the labels clients see." onClose={onClose} open={open} title="Menu settings" variant="structure-panel">
      <ol className="nav-item-list" aria-label="Navigation items">
        {items.map((item, index) => {
          const page = document.pages.find((candidate) => candidate.id === item.pageId);
          return (
            <li className="nav-item-row" key={item.id}>
              <label className="form-field" style={{ margin: 0 }}>
                <span>{index + 1}. {page?.name ?? 'Page'}{page?.visibleInNavigation ? '' : ' · hidden from menu'}</span>
                <input aria-label={`Navigation label for ${page?.name ?? 'page'}`} defaultValue={item.label} key={`${item.id}-${item.label}`} onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== item.label) onRename(item.pageId, event.target.value); }} />
              </label>
              <div className="row-button-group">
                <button aria-label={`Move ${item.label} up in navigation`} disabled={index === 0} type="button" onClick={() => onMove(item.pageId, index)}><ArrowUp aria-hidden="true" size={17} /></button>
                <button aria-label={`Move ${item.label} down in navigation`} disabled={index === items.length - 1} type="button" onClick={() => onMove(item.pageId, index + 2)}><ArrowDown aria-hidden="true" size={17} /></button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="dialog-actions"><button className="primary-button" type="button" onClick={onClose}>Done</button></div>
    </Dialog>
  );
}

type ConfirmationDialogProps = {
  cancelLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  description: string;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
};

export function ConfirmationDialog({ cancelLabel = 'Cancel', confirmLabel, danger = false, description, onClose, onConfirm, open, pending = false, title }: ConfirmationDialogProps) {
  return (
    <Dialog closeDisabled={pending} description={description} onClose={() => { if (!pending) onClose(); }} open={open} title={title}>
      <div aria-busy={pending || undefined} className="dialog-actions"><button className="secondary-button" disabled={pending} type="button" onClick={onClose}>{cancelLabel}</button><button className={danger ? 'danger-button' : 'primary-button'} disabled={pending} type="button" onClick={onConfirm}>{pending ? 'Starting over…' : confirmLabel}</button></div>
    </Dialog>
  );
}

type NavigationPromptDialogProps = {
  onAddNavigation: () => void;
  onClose: () => void;
  open: boolean;
};

export function NavigationPromptDialog({ onAddNavigation, onClose, open }: NavigationPromptDialogProps) {
  return (
    <Dialog description="You now have more than one page." onClose={onClose} open={open} title="Add a menu?">
      <p>Add a navigation menu so clients can move between your visible pages. You can change it anytime.</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Not now</button><button className="primary-button" type="button" onClick={onAddNavigation}>Add menu</button></div>
    </Dialog>
  );
}

type StartAgainDialogProps = {
  onChoose: (starter: OriginStarter) => void;
  onClose: () => void;
  open: boolean;
};

export function StartAgainDialog({ onChoose, onClose, open }: StartAgainDialogProps) {
  return (
    <Dialog description="This replaces the current local document. Export first if you want a backup." onClose={onClose} open={open} title="Start again from a kit">
      <div className="move-page-list" role="group" aria-label="Starting kits">
        <button className="sheet-list-button" type="button" onClick={() => onChoose('quick_book')}><strong>Quick Book</strong><span>4 sections</span></button>
        <button className="sheet-list-button" type="button" onClick={() => onChoose('one_page')}><strong>One-page website</strong><span>6 sections</span></button>
        <button className="sheet-list-button" type="button" onClick={() => onChoose('multi_page')}><strong>Multi-page website</strong><span>5 pages</span></button>
      </div>
    </Dialog>
  );
}

export type LabOptionsDialogProps = {
  canRedo: boolean;
  canUndo: boolean;
  imageFixture: ImageFixture;
  menuSize: MenuSize;
  onClose: () => void;
  onExport: () => void;
  onImageFixtureChange: (fixture: ImageFixture) => void;
  onImport: (file: File) => void;
  onMenuSizeChange: (menuSize: MenuSize) => void;
  onRedo: () => void;
  onResetLab: () => void;
  onResetStarter: () => void;
  onStartAgain: () => void;
  onTokenPresetChange: (preset: BookingTokenPresetId) => void;
  onToggleRealHeightSimulation: () => void;
  onUndo: () => void;
  open: boolean;
  realHeightSimulation: boolean;
  tokenPreset: BookingTokenPresetId;
};

export function LabOptionsDialog({
  canRedo,
  canUndo,
  imageFixture,
  menuSize,
  onClose,
  onExport,
  onImageFixtureChange,
  onImport,
  onMenuSizeChange,
  onRedo,
  onResetLab,
  onResetStarter,
  onStartAgain,
  onTokenPresetChange,
  onToggleRealHeightSimulation,
  onUndo,
  open,
  realHeightSimulation,
  tokenPreset,
}: LabOptionsDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog description="Site history and local prototype controls. No Production data is read or written." onClose={onClose} open={open} title="More" variant="bottom-sheet">
      <div className="more-options-section">
        <span>History</span>
        <div className="more-options-history">
          <button className="sheet-list-button" disabled={!canUndo} type="button" onClick={onUndo}><Undo2 aria-hidden="true" size={18} /> Undo</button>
          <button className="sheet-list-button" disabled={!canRedo} type="button" onClick={onRedo}><Redo2 aria-hidden="true" size={18} /> Redo</button>
        </div>
      </div>
      <div className="more-options-section">
        <span>Lab display</span>
        <div className="switch-row"><span className="switch-row__copy"><strong>Real-height simulation</strong><span>Preview how the editor behaves around short and very long future sections.</span></span><button aria-checked={realHeightSimulation} aria-label="Simulate real section heights" className="switch" role="switch" type="button" onClick={onToggleRealHeightSimulation}><Maximize2 aria-hidden="true" size={15} /></button></div>
      </div>
      <div className="more-options-section">
        <span>Booking preview fixtures</span>
        <p className="form-hint">These local review options do not change your site document.</p>
        <label className="form-field">
          <span>Service photos</span>
          <select
            aria-label="Booking service photo fixture"
            value={imageFixture}
            onChange={(event) => onImageFixtureChange(event.target.value as ImageFixture)}
          >
            <option value="image_rich">Rich imagery</option>
            <option value="partial_images">Partial imagery</option>
            <option value="no_images">No imagery</option>
          </select>
        </label>
        <label className="form-field">
          <span>Service menu</span>
          <select
            aria-label="Booking service menu fixture"
            value={menuSize}
            onChange={(event) => onMenuSizeChange(event.target.value as MenuSize)}
          >
            <option value="canonical">24 canonical services</option>
            <option value="stress_100">100-service stress menu</option>
          </select>
        </label>
        <label className="form-field">
          <span>Token fixture</span>
          <select
            aria-label="Booking presentation token fixture"
            value={tokenPreset}
            onChange={(event) => onTokenPresetChange(event.target.value as BookingTokenPresetId)}
          >
            <option value="warm">Warm Luster</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
      </div>
      <div className="more-options-section move-page-list">
        <span>Backup and reset</span>
        <p className="form-hint" data-testid="custom-design-json-warning">
          Uploaded design files are stored in this browser and aren’t included in the JSON backup.
        </p>
        <button className="sheet-list-button" type="button" onClick={onExport}><Download aria-hidden="true" size={18} /> Export JSON</button>
        <button className="sheet-list-button" type="button" onClick={() => inputRef.current?.click()}><FileUp aria-hidden="true" size={18} /> Import JSON</button>
        <input ref={inputRef} className="visually-hidden" accept="application/json,.json" aria-label="Import site JSON file" tabIndex={-1} type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) onImport(file); event.target.value = ''; }} />
        <button className="sheet-list-button" type="button" onClick={onResetStarter}><RotateCcw aria-hidden="true" size={18} /> Reset to starter kit</button>
        <button className="sheet-list-button" type="button" onClick={onStartAgain}><Plus aria-hidden="true" size={18} /> Start again from another kit</button>
        <button className="sheet-list-button" type="button" onClick={onResetLab}><Trash2 aria-hidden="true" size={18} /> Reset Lab</button>
      </div>
    </Dialog>
  );
}

type AlertDialogProps = {
  message: string | null;
  onClose: () => void;
  title?: string;
};

export function AlertDialog({ message, onClose, title = 'That change isn’t available' }: AlertDialogProps) {
  const [first, second] = (message ?? '').split(' Add another');
  return (
    <Dialog onClose={onClose} open={message !== null} title={title}>
      <div className={title === 'Keep a way to book' ? 'booking-protection-dialog-content' : undefined}>
        <div role="alert">
          <p><strong>{first}</strong></p>
          {second ? <p>Add another{second}</p> : null}
        </div>
        <div className="dialog-actions"><button className="primary-button" type="button" onClick={onClose}>{title === 'Keep a way to book' ? 'Keep Booking' : 'Got it'}</button></div>
      </div>
    </Dialog>
  );
}

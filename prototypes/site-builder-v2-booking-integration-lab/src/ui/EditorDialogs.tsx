import { ArrowDown, ArrowUp, Download, FileUp, Maximize2, Plus, Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { BookingTokenPresetId, ImageFixture, MenuSize } from '../booking/types';
import {
  SECTION_CATALOGUE,
  type CatalogueSectionType,
  type OriginStarter,
  type PageDocument,
  type PlaceholderSectionInstance,
  type SectionSize,
  type SiteBuilderDocument,
} from '../model';
import { Dialog } from './Dialog';

type SectionLibraryDialogProps = {
  document: SiteBuilderDocument;
  insertionPosition: number | null;
  onAdd: (sectionType: CatalogueSectionType, size: SectionSize) => void;
  onClose: () => void;
  page: PageDocument;
};

export function SectionLibraryDialog({ document, insertionPosition, onAdd, onClose, page }: SectionLibraryDialogProps) {
  const activeTypes = new Set(document.pages.flatMap((candidate) => candidate.sections.map((section) => section.sectionType)));
  const unusedTypes = new Set(document.unusedSections.map((section) => section.sectionType));

  return (
    <Dialog
      description={`Choose what to add to ${page.name}${insertionPosition ? ` at position ${insertionPosition}` : ''}. Booking is already included and can move anywhere in your site.`}
      onClose={onClose}
      open={insertionPosition !== null}
      title="Add section"
      variant="section-library"
    >
      <div className="section-library-intro">
        <strong>Section library</strong>
        <span>All starting points use the same library.</span>
      </div>
      <div className="section-library-grid">
        {SECTION_CATALOGUE.map((item) => {
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
        <article className="library-item" data-section-type="booking">
          <div className="library-item__preview">B</div>
          <div className="library-item__copy">
            <strong>Booking</strong>
            <span>Client service menu</span>
            <span className="library-state">Currently used</span>
            <button
              aria-label="Booking is currently used"
              className="library-add-button"
              disabled
              type="button"
            >
              Currently used
            </button>
          </div>
        </article>
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
  confirmLabel: string;
  danger?: boolean;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
};

export function ConfirmationDialog({ confirmLabel, danger = false, description, onClose, onConfirm, open, title }: ConfirmationDialogProps) {
  return (
    <Dialog description={description} onClose={onClose} open={open} title={title}>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className={danger ? 'danger-button' : 'primary-button'} type="button" onClick={onConfirm}>{confirmLabel}</button></div>
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
        <button className="sheet-list-button" type="button" onClick={() => onChoose('quick_book')}><strong>Quick Book</strong><span>3 sections</span></button>
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

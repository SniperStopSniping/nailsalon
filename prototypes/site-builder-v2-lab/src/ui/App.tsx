import {
  Check,
  ChevronDown,
  Eye,
  GripVertical,
  Laptop,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Settings2,
  Smartphone,
  Tablet,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  getSectionMoveAnnouncement,
  type BuilderCommand,
  type HistoryState,
  type OriginStarter,
  type PageDocument,
  type SectionInstance,
  type SectionSize,
  type SiteBuilderDocument,
} from '../model';
import {
  AddPageDialog,
  AlertDialog,
  ConfirmationDialog,
  LabOptionsDialog,
  MovePositionDialog,
  MoveSectionDialog,
  NavigationPromptDialog,
  NavigationSettingsDialog,
  PageSettingsDialog,
  SectionLibraryDialog,
  SectionSettingsDialog,
  StartAgainDialog,
} from './EditorDialogs';
import { InspectorPanel, PagesPanel } from './EditorPanels';
import { Dialog } from './Dialog';
import { Preview } from './Preview';
import { ReorderList } from './ReorderList';
import { SectionCard } from './SectionCard';
import { StarterChooser } from './StarterChooser';
import { useLabDocument } from './useLabDocument';

type EditorMode = 'edit' | 'reorder' | 'preview';
type PreviewViewport = 'desktop' | 'tablet' | 'mobile';
type ToastState = { message: string; undoable?: boolean } | null;
type ResetChoice = 'lab' | 'starter' | null;

const getHomeOrFirstPage = (document: SiteBuilderDocument): PageDocument =>
  document.pages.find((page) => page.isHome) ?? document.pages[0] as PageDocument;

const findSectionPage = (document: SiteBuilderDocument, sectionId: string): PageDocument | null =>
  document.pages.find((page) => page.sections.some((section) => section.id === sectionId)) ?? null;

const findSection = (document: SiteBuilderDocument, sectionId: string | null): SectionInstance | null => {
  if (!sectionId) {
    return null;
  }
  for (const page of document.pages) {
    const section = page.sections.find((candidate) => candidate.id === sectionId);
    if (section) {
      return section;
    }
  }
  return null;
};

const starterLabel = (starter: OriginStarter): string => ({
  quick_book: 'Quick Book',
  one_page: 'One-page website',
  multi_page: 'Multi-page website',
})[starter];

export function App() {
  const lab = useLabDocument();
  const document = lab.document;
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const [libraryPosition, setLibraryPosition] = useState<number | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [positionSectionId, setPositionSectionId] = useState<string | null>(null);
  const [movingSectionId, setMovingSectionId] = useState<string | null>(null);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const [pendingPageRemovalId, setPendingPageRemovalId] = useState<string | null>(null);
  const [addPageOpen, setAddPageOpen] = useState(false);
  const [navigationPromptOpen, setNavigationPromptOpen] = useState(false);
  const [navigationSettingsOpen, setNavigationSettingsOpen] = useState(false);
  const [mobilePagesOpen, setMobilePagesOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [startAgainOpen, setStartAgainOpen] = useState(false);
  const [resetChoice, setResetChoice] = useState<ResetChoice>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertTitle, setAlertTitle] = useState('This change is protected');
  const [toast, setToast] = useState<ToastState>(null);
  const [announcement, setAnnouncement] = useState('');
  const [reorderBaseline, setReorderBaseline] = useState<HistoryState | null>(null);

  const activePage = document
    ? document.pages.find((page) => page.id === activePageId) ?? getHomeOrFirstPage(document)
    : null;
  const selectedSection = document ? findSection(document, selectedSectionId) : null;
  const editingSection = document ? findSection(document, editingSectionId) : null;
  const positionSection = document ? findSection(document, positionSectionId) : null;
  const movingSection = document ? findSection(document, movingSectionId) : null;
  const editingPage = document?.pages.find((page) => page.id === editingPageId) ?? null;
  const pendingPageRemoval = document?.pages.find((page) => page.id === pendingPageRemovalId) ?? null;
  const movingSectionPage = document && movingSection ? findSectionPage(document, movingSection.id) : null;
  const positionSectionPage = document && positionSection ? findSectionPage(document, positionSection.id) : null;
  const currentPosition = positionSection && positionSectionPage
    ? positionSectionPage.sections.findIndex((section) => section.id === positionSection.id) + 1
    : 1;

  useEffect(() => {
    if (!document) {
      setActivePageId(null);
      setSelectedSectionId(null);
      setMode('edit');
      return;
    }
    if (!document.pages.some((page) => page.id === activePageId)) {
      setActivePageId(getHomeOrFirstPage(document).id);
    }
  }, [activePageId, document]);

  useEffect(() => {
    if (!document || !selectedSectionId) {
      return;
    }
    const selectedPage = findSectionPage(document, selectedSectionId);
    if (!selectedPage || selectedPage.id !== activePage?.id) {
      setSelectedSectionId(null);
      setMobileActionsOpen(false);
    }
  }, [activePage?.id, document, selectedSectionId]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setToast(null), toast.undoable ? 8_000 : 3_800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const sortedActiveSections = useMemo(
    () => activePage ? [...activePage.sections].sort((left, right) => left.order - right.order) : [],
    [activePage],
  );

  const showError = (message: string, title = 'This change is protected') => {
    setAlertTitle(title);
    setAlertMessage(message);
  };

  const execute = (command: BuilderCommand) => {
    const result = lab.runCommand(command);
    if (!result.success) {
      showError(result.message, result.code === 'booking_access_required' ? 'Booking access is protected' : 'That change is not available');
    }
    return result;
  };

  const chooseStarter = (starter: OriginStarter) => {
    lab.chooseStarter(starter);
    setActivePageId(null);
    setSelectedSectionId(null);
    setMode('edit');
    setStartAgainOpen(false);
    setOptionsOpen(false);
    setToast({ message: `${starterLabel(starter)} initialized. Same universal editor, all capabilities available.` });
  };

  const enterReorder = () => {
    setReorderBaseline(lab.createHistoryCheckpoint());
    setMode('reorder');
    setSelectedSectionId(null);
  };

  const cancelReorder = () => {
    if (reorderBaseline) {
      lab.restoreHistoryCheckpoint(reorderBaseline);
    }
    setReorderBaseline(null);
    setMode('edit');
    setAnnouncement('Reorder changes cancelled.');
  };

  const finishReorder = () => {
    setReorderBaseline(null);
    setMode('edit');
    setAnnouncement('Section order saved.');
  };

  const enterPreview = () => {
    if (!document) {
      return;
    }
    const current = activePage?.visible ? activePage : document.pages.find((page) => page.visible) ?? getHomeOrFirstPage(document);
    setReorderBaseline(null);
    setActivePageId(current.id);
    setMobilePagesOpen(false);
    setMode('preview');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  };

  const addSection = (sectionType: SectionInstance['sectionType'], size: SectionSize) => {
    if (!activePage || libraryPosition === null) {
      return;
    }
    const beforeIds = new Set(activePage.sections.map((section) => section.id));
    const result = execute({ type: 'add_section', input: { pageId: activePage.id, sectionType, position: libraryPosition, size } });
    if (!result.success) {
      return;
    }
    const nextPage = result.document.pages.find((page) => page.id === activePage.id);
    const created = nextPage?.sections.find((section) => !beforeIds.has(section.id));
    setSelectedSectionId(created?.id ?? null);
    setLibraryPosition(null);
    setToast({ message: `${created?.label ?? 'Section'} added to ${activePage.name}.` });
  };

  const editSection = (section: SectionInstance) => {
    setSelectedSectionId(section.id);
    setEditingSectionId(section.id);
    setMobileActionsOpen(false);
  };

  const saveSection = (values: { note: string; size: SectionSize }) => {
    if (!editingSection) {
      return;
    }
    const result = execute({ type: 'update_section_settings', sectionId: editingSection.id, note: values.note, size: values.size });
    if (result.success) {
      setEditingSectionId(null);
      setToast({ message: `${editingSection.label} settings saved.` });
    }
  };

  const toggleSection = (section: SectionInstance) => {
    const result = execute({ type: 'set_section_visible', sectionId: section.id, visible: !section.visible });
    if (result.success) {
      setToast({ message: `${section.label} is now ${section.visible ? 'hidden' : 'shown'}.` });
    }
  };

  const removeSection = (section: SectionInstance) => {
    const result = execute({ type: 'remove_section', sectionId: section.id });
    if (result.success) {
      setSelectedSectionId(null);
      setMobileActionsOpen(false);
      setToast({ message: 'Section removed · Undo', undoable: true });
    }
  };

  const restoreSection = (section: SectionInstance) => {
    if (!activePage) {
      return;
    }
    const result = execute({ type: 'restore_section', sectionId: section.id, pageId: activePage.id });
    if (result.success) {
      setSelectedSectionId(section.id);
      setToast({ message: `${section.label} restored to ${activePage.name}.` });
    }
  };

  const announceMovedSection = (nextDocument: SiteBuilderDocument, sectionId: string) => {
    const message = getSectionMoveAnnouncement(nextDocument, sectionId);
    setAnnouncement(message);
    setToast({ message });
  };

  const moveSectionToPosition = (section: SectionInstance, position: number) => {
    const result = execute({ type: 'move_section', sectionId: section.id, position });
    if (result.success) {
      announceMovedSection(result.document, section.id);
      setPositionSectionId(null);
    }
  };

  const moveSectionUp = (section: SectionInstance) => {
    const result = execute({ type: 'move_section_up', sectionId: section.id });
    if (result.success) {
      announceMovedSection(result.document, section.id);
    }
  };

  const moveSectionDown = (section: SectionInstance) => {
    const result = execute({ type: 'move_section_down', sectionId: section.id });
    if (result.success) {
      announceMovedSection(result.document, section.id);
    }
  };

  const moveSectionToPage = (section: SectionInstance, pageId: string) => {
    const result = execute({ type: 'move_section_to_page', sectionId: section.id, pageId });
    if (result.success) {
      const page = result.document.pages.find((candidate) => candidate.id === pageId);
      setActivePageId(pageId);
      setSelectedSectionId(section.id);
      setMovingSectionId(null);
      setToast({ message: `${section.label} moved to ${page?.name ?? 'page'}.` });
    }
  };

  const moveSectionToNewPage = (section: SectionInstance, name: string) => {
    if (!document) {
      return;
    }
    const beforeIds = new Set(document.pages.map((page) => page.id));
    const beforeVisibleCount = document.pages.filter((page) => page.visible).length;
    const result = execute({ type: 'move_section_to_new_page', input: { sectionId: section.id, name } });
    if (!result.success) {
      return;
    }
    const created = result.document.pages.find((page) => !beforeIds.has(page.id));
    if (created) {
      setActivePageId(created.id);
    }
    setSelectedSectionId(section.id);
    setMovingSectionId(null);
    if (!document.navigation.enabled && beforeVisibleCount === 1 && result.document.pages.filter((page) => page.visible).length > 1) {
      setNavigationPromptOpen(true);
    }
    setToast({ message: `${name} created with ${section.label} intact.` });
  };

  const addPage = (name: string, slug: string) => {
    if (!document) {
      return;
    }
    const beforeIds = new Set(document.pages.map((page) => page.id));
    const beforeVisibleCount = document.pages.filter((page) => page.visible).length;
    const result = execute({ type: 'add_page', input: { name, slug: slug || undefined } });
    if (!result.success) {
      return;
    }
    const created = result.document.pages.find((page) => !beforeIds.has(page.id));
    setAddPageOpen(false);
    setMobilePagesOpen(false);
    if (created) {
      setActivePageId(created.id);
    }
    if (!document.navigation.enabled && beforeVisibleCount === 1 && result.document.pages.filter((page) => page.visible).length > 1) {
      setNavigationPromptOpen(true);
    }
    setToast({ message: `${name} page added.` });
  };

  const savePage = (values: { name: string; slug: string; visible: boolean; visibleInNavigation: boolean }) => {
    if (!editingPage) {
      return;
    }
    const result = execute({
      type: 'update_page_settings',
      pageId: editingPage.id,
      ...values,
    });
    if (result.success) {
      setEditingPageId(null);
      setToast({ message: `${values.name} page settings saved.` });
    }
  };

  const movePage = (page: PageDocument, position: number) => {
    const result = execute({ type: 'move_page', pageId: page.id, position });
    if (result.success) {
      setAnnouncement(`${page.name} moved to page position ${position} of ${result.document.pages.length}.`);
    }
  };

  const confirmRemovePage = () => {
    if (!pendingPageRemoval) {
      return;
    }
    const result = execute({ type: 'remove_page', pageId: pendingPageRemoval.id });
    setPendingPageRemovalId(null);
    if (result.success) {
      setToast({ message: 'Page removed · Undo', undoable: true });
      if (activePageId === pendingPageRemoval.id) {
        setActivePageId(getHomeOrFirstPage(result.document).id);
      }
    }
  };

  const restorePage = (pageId: string) => {
    const result = execute({ type: 'restore_page', pageId });
    if (result.success) {
      const page = result.document.pages.find((candidate) => candidate.id === pageId);
      setActivePageId(pageId);
      setToast({ message: `${page?.name ?? 'Page'} restored with its sections intact.` });
    }
  };

  const toggleNavigation = () => {
    if (!document) {
      return;
    }
    const result = execute({ type: 'toggle_navigation', enabled: !document.navigation.enabled });
    if (result.success) {
      setToast({ message: `Navigation ${document.navigation.enabled ? 'disabled' : 'enabled'}.` });
    }
  };

  const exportJson = () => {
    const json = lab.exportJson();
    if (!json) {
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = 'luster-site-builder-v2-lab-schema-1.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setOptionsOpen(false);
    setToast({ message: 'Lab document exported as JSON.' });
  };

  const importFile = async (file: File) => {
    try {
      const result = lab.importJson(await file.text());
      if (!result.success) {
        showError(result.issues.join(' '), 'Import could not be completed');
        return;
      }
      setOptionsOpen(false);
      setActivePageId(getHomeOrFirstPage(result.document).id);
      setSelectedSectionId(null);
      setMode('edit');
      setToast({ message: 'Site restored from imported JSON.' });
    } catch {
      showError('The selected file could not be read.', 'Import could not be completed');
    }
  };

  const confirmReset = () => {
    if (resetChoice === 'lab') {
      lab.resetLab();
      setOptionsOpen(false);
      setToast(null);
    } else if (resetChoice === 'starter') {
      lab.resetToStarter();
      setActivePageId(null);
      setSelectedSectionId(null);
      setMode('edit');
      setOptionsOpen(false);
      setToast({ message: 'Reset to the original starting kit.' });
    }
    setResetChoice(null);
  };

  if (!document || !activePage) {
    return (
      <>
        {lab.loadIssues.length > 0 ? (
          <div className="toast" role="alert"><span>Saved Lab data is corrupted and was not loaded. {lab.loadIssues.join(' ')}</span><button type="button" onClick={lab.resetLab}>Reset saved Lab</button></div>
        ) : null}
        <StarterChooser onChoose={chooseStarter} onImport={importFile} />
        <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} title={alertTitle} />
      </>
    );
  }

  const previewPage = activePage.visible ? activePage : document.pages.find((page) => page.visible) ?? getHomeOrFirstPage(document);

  if (mode === 'preview') {
    return (
      <div className="preview-app">
        <header className="preview-toolbar" aria-label="Preview controls">
          <div className="preview-toolbar__title"><Eye aria-hidden="true" size={18} /><span>Site preview · {previewPage.name}</span></div>
          <div className="segmented-control" role="group" aria-label="Preview viewport">
            <button aria-label="Desktop" aria-pressed={viewport === 'desktop'} type="button" onClick={() => setViewport('desktop')}><Laptop aria-hidden="true" size={17} /> <span aria-hidden="true" className="viewport-full-label">Desktop</span><span aria-hidden="true" className="viewport-short-label">Desk</span></button>
            <button aria-label="Tablet" aria-pressed={viewport === 'tablet'} type="button" onClick={() => setViewport('tablet')}><Tablet aria-hidden="true" size={17} /> <span aria-hidden="true" className="viewport-full-label">Tablet</span><span aria-hidden="true" className="viewport-short-label">Tab</span></button>
            <button aria-label="Mobile" aria-pressed={viewport === 'mobile'} type="button" onClick={() => setViewport('mobile')}><Smartphone aria-hidden="true" size={17} /> <span aria-hidden="true" className="viewport-full-label">Mobile</span><span aria-hidden="true" className="viewport-short-label">Phone</span></button>
          </div>
          <button className="primary-button preview-toolbar__done" type="button" onClick={() => setMode('edit')}>Done</button>
        </header>
        <section aria-label="Site preview">
          <Preview activePage={previewPage} document={document} viewport={viewport} onNavigate={(pageId) => { const page = document.pages.find((candidate) => candidate.id === pageId); if (page?.visible) setActivePageId(pageId); }} />
        </section>
      </div>
    );
  }

  const pagesPanel = (
    <PagesPanel
      activePageId={activePage.id}
      document={document}
      onAddPage={() => { setMobilePagesOpen(false); setAddPageOpen(true); }}
      onEditNavigation={() => { setMobilePagesOpen(false); setNavigationSettingsOpen(true); }}
      onEditPage={(page) => { setMobilePagesOpen(false); setEditingPageId(page.id); }}
      onMovePage={movePage}
      onRemovePage={(page) => { setMobilePagesOpen(false); setPendingPageRemovalId(page.id); }}
      onRestorePage={(pageId) => { setMobilePagesOpen(false); restorePage(pageId); }}
      onRestoreSection={(section) => { setMobilePagesOpen(false); restoreSection(section); }}
      onSelectPage={(pageId) => { setActivePageId(pageId); setSelectedSectionId(null); setMobilePagesOpen(false); }}
      onToggleNavigation={toggleNavigation}
    />
  );

  return (
    <div className="editor-app">
      <header className="top-toolbar" aria-label="Site builder toolbar">
        <div className="toolbar-brand"><span className="brand-mark" aria-hidden="true">L</span><strong>{document.siteName}</strong><span className="lab-pill">V2 Lab</span></div>
        <div className="segmented-control" role="group" aria-label="Editor modes">
          <button aria-pressed={mode === 'edit'} type="button" onClick={() => { if (mode === 'reorder') finishReorder(); else setMode('edit'); }}><Pencil aria-hidden="true" size={16} /> Edit</button>
          <button aria-pressed={mode === 'reorder'} type="button" onClick={() => { if (mode !== 'reorder') enterReorder(); }}><GripVertical aria-hidden="true" size={16} /> Reorder</button>
          <button aria-pressed="false" type="button" onClick={enterPreview}><Eye aria-hidden="true" size={16} /> Preview</button>
        </div>
        <div className="toolbar-actions">
          <div className="toolbar-history">
            <button className="icon-button" aria-label="Undo" disabled={!lab.canUndo} type="button" onClick={() => { if (lab.undo()) setAnnouncement('Last change undone.'); }}><Undo2 aria-hidden="true" size={18} /></button>
            <button className="icon-button" aria-label="Redo" disabled={!lab.canRedo} type="button" onClick={() => { if (lab.redo()) setAnnouncement('Last change redone.'); }}><Redo2 aria-hidden="true" size={18} /></button>
          </div>
          <span className={`save-status${lab.saveStatus === 'saved' ? ' is-saved' : ''}`} role="status" aria-label="Save status">
            {lab.saveStatus === 'saved' ? <Check aria-hidden="true" size={15} /> : <Save aria-hidden="true" size={15} />}
            {lab.saveStatus === 'saving' ? 'Saving…' : lab.saveStatus === 'error' ? 'Save failed' : 'Saved'}
          </span>
          <button className="toolbar-button" type="button" onClick={() => setOptionsOpen(true)}><MoreHorizontal aria-hidden="true" size={18} /> Lab options</button>
          <div className="toolbar-mobile-actions">
            <button className="icon-button" aria-label="Undo" disabled={!lab.canUndo} type="button" onClick={() => { if (lab.undo()) setAnnouncement('Last change undone.'); }}><Undo2 aria-hidden="true" size={18} /></button>
            <button className="icon-button" aria-label="Redo" disabled={!lab.canRedo} type="button" onClick={() => { if (lab.redo()) setAnnouncement('Last change redone.'); }}><Redo2 aria-hidden="true" size={18} /></button>
            <button className="icon-button" aria-label="Open Pages" type="button" onClick={() => setMobilePagesOpen(true)}><Menu aria-hidden="true" size={19} /></button>
            <button className="icon-button" aria-label="Open Lab options" type="button" onClick={() => setOptionsOpen(true)}><MoreHorizontal aria-hidden="true" size={19} /></button>
          </div>
        </div>
      </header>

      <div className="editor-layout">
        <aside className="pages-panel">{pagesPanel}</aside>
        <main className="canvas-shell">
          <div className="canvas-frame">
            <div className="canvas-page-header">
              <div><p className="eyebrow">{starterLabel(document.originStarter)} origin · universal editor</p><h1>{activePage.name}</h1><p>{activePage.isHome ? 'Home page' : `/${activePage.slug}`} · {activePage.sections.length} section{activePage.sections.length === 1 ? '' : 's'} · {activePage.visible ? 'Visible' : 'Hidden'}</p></div>
              <button className="secondary-button" type="button" onClick={() => setEditingPageId(activePage.id)}><Settings2 aria-hidden="true" size={17} /> Page settings</button>
            </div>

            {mode === 'reorder' ? (
              <>
                <div className="reorder-instructions"><GripVertical aria-hidden="true" size={22} /><span><strong>Reorder mode is on.</strong> Drag only from a handle, tap a number to move by position, or use the movement buttons. Normal scrolling remains available outside the handles.</span></div>
                {sortedActiveSections.length > 0 ? (
                  <ReorderList
                    onAnnounce={setAnnouncement}
                    onDragReorder={(sectionId, position) => {
                      const result = execute({ type: 'move_section', sectionId, position });
                      if (result.success) setAnnouncement(getSectionMoveAnnouncement(result.document, sectionId));
                    }}
                    onMoveDown={moveSectionDown}
                    onMovePage={(section) => setMovingSectionId(section.id)}
                    onMoveUp={moveSectionUp}
                    onOpenPosition={(section) => setPositionSectionId(section.id)}
                    sections={sortedActiveSections}
                  />
                ) : <p className="empty-state">This page has no sections to reorder.</p>}
                <div className="dialog-actions reorder-inline-actions"><button className="secondary-button" type="button" onClick={cancelReorder}><X aria-hidden="true" size={17} /> Cancel</button><button className="primary-button" type="button" onClick={finishReorder}><Check aria-hidden="true" size={17} /> Done</button></div>
              </>
            ) : (
              <div aria-label={`Sections on ${activePage.name}`} role="list">
                <button className="add-section-button" type="button" aria-label={`Add section at top of ${activePage.name}`} onClick={() => setLibraryPosition(1)}><Plus aria-hidden="true" size={16} /> Add section</button>
                {sortedActiveSections.map((section, index) => (
                  <div key={section.id}>
                    <SectionCard
                      page={activePage}
                      section={section}
                      selected={selectedSectionId === section.id}
                      onEdit={editSection}
                      onMove={(candidate) => setMovingSectionId(candidate.id)}
                      onRemove={removeSection}
                      onSelect={(candidate) => {
                        setSelectedSectionId(candidate.id);
                        if (window.matchMedia('(max-width: 899px)').matches) setMobileActionsOpen(true);
                      }}
                      onToggleVisible={toggleSection}
                    />
                    <button
                      className="add-section-button"
                      type="button"
                      aria-label={index === sortedActiveSections.length - 1 ? `Add section at bottom of ${activePage.name}` : `Add section after ${section.label}`}
                      onClick={() => setLibraryPosition(index + 2)}
                    >
                      <Plus aria-hidden="true" size={16} /> Add section
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mobile-sticky-controls">
              {mode === 'reorder' ? <><button className="secondary-button" type="button" onClick={cancelReorder}>Cancel</button><button className="primary-button" type="button" onClick={finishReorder}>Done</button></> : <><button className="secondary-button" type="button" onClick={() => setMobilePagesOpen(true)}>Pages <ChevronDown aria-hidden="true" size={16} /></button><button className="primary-button" type="button" onClick={enterPreview}>Preview</button></>}
            </div>
          </div>
        </main>
        <aside className="inspector-panel"><InspectorPanel page={activePage} section={selectedSection} onEditPage={() => setEditingPageId(activePage.id)} onEditSection={editSection} onMoveSection={(section) => setMovingSectionId(section.id)} onRemoveSection={removeSection} onToggleSection={toggleSection} /></aside>
      </div>

      <div className="visually-hidden" aria-live="polite" data-testid="reorder-live-region" role="status">{announcement}</div>

      {toast ? (
        <div className="toast" role="status"><span>{toast.message}</span>{toast.undoable ? <button type="button" onClick={() => { lab.undo(); setToast(null); setAnnouncement('Removal undone.'); }}>Undo</button> : null}</div>
      ) : null}

      <SectionLibraryDialog document={document} insertionPosition={libraryPosition} onAdd={addSection} onClose={() => setLibraryPosition(null)} page={activePage} />
      <SectionSettingsDialog onClose={() => setEditingSectionId(null)} onSave={saveSection} section={editingSection} />
      <MovePositionDialog currentPosition={currentPosition} onClose={() => setPositionSectionId(null)} onMove={(position) => { if (positionSection) moveSectionToPosition(positionSection, position); }} section={positionSection} total={positionSectionPage?.sections.length ?? 1} />
      <MoveSectionDialog currentPageId={movingSectionPage?.id ?? activePage.id} document={document} onClose={() => setMovingSectionId(null)} onCreatePage={(name) => { if (movingSection) moveSectionToNewPage(movingSection, name); }} onMove={(pageId) => { if (movingSection) moveSectionToPage(movingSection, pageId); }} section={movingSection} />
      <AddPageDialog onAdd={addPage} onClose={() => setAddPageOpen(false)} open={addPageOpen} />
      <PageSettingsDialog onClose={() => setEditingPageId(null)} onSave={savePage} page={editingPage} />
      <NavigationSettingsDialog document={document} onClose={() => setNavigationSettingsOpen(false)} onMove={(pageId, position) => execute({ type: 'move_navigation_item', pageId, position })} onRename={(pageId, label) => execute({ type: 'rename_navigation_item', pageId, label })} open={navigationSettingsOpen} />
      <NavigationPromptDialog onAddNavigation={() => { execute({ type: 'toggle_navigation', enabled: true }); setNavigationPromptOpen(false); setToast({ message: 'Navigation enabled.' }); }} onClose={() => setNavigationPromptOpen(false)} open={navigationPromptOpen} />
      <ConfirmationDialog confirmLabel="Remove page" danger description={pendingPageRemoval ? `${pendingPageRemoval.name} and its sections will move to recoverable storage.` : ''} onClose={() => setPendingPageRemovalId(null)} onConfirm={confirmRemovePage} open={pendingPageRemoval !== null} title="Remove this page?" />
      <LabOptionsDialog onClose={() => setOptionsOpen(false)} onExport={exportJson} onImport={importFile} onResetLab={() => { setOptionsOpen(false); setResetChoice('lab'); }} onResetStarter={() => { setOptionsOpen(false); setResetChoice('starter'); }} onStartAgain={() => { setOptionsOpen(false); setStartAgainOpen(true); }} open={optionsOpen} />
      <StartAgainDialog onChoose={chooseStarter} onClose={() => setStartAgainOpen(false)} open={startAgainOpen} />
      <ConfirmationDialog confirmLabel={resetChoice === 'lab' ? 'Reset Lab' : 'Reset to starter'} danger description={resetChoice === 'lab' ? 'This clears the local Lab document and returns to the starting-point chooser.' : 'This replaces local changes with fresh defaults for the current starting kit.'} onClose={() => setResetChoice(null)} onConfirm={confirmReset} open={resetChoice !== null} title={resetChoice === 'lab' ? 'Reset the entire Lab?' : 'Reset to the starting kit?'} />
      <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} title={alertTitle} />

      <Dialog onClose={() => setMobilePagesOpen(false)} open={mobilePagesOpen} title="Pages" variant="sheet">{pagesPanel}</Dialog>
      <Dialog onClose={() => setMobileActionsOpen(false)} open={mobileActionsOpen && selectedSection !== null} title={selectedSection ? `${selectedSection.label} actions` : 'Section actions'} variant="bottom-sheet">
        {selectedSection ? (
          <div className="move-page-list">
            <p>{selectedSection.size} · {selectedSection.visible ? 'Shown' : 'Hidden'} · content and settings remain recoverable.</p>
            <button className="sheet-list-button" type="button" onClick={() => editSection(selectedSection)}><Pencil aria-hidden="true" size={17} /> Edit placeholder settings</button>
            <button className="sheet-list-button" type="button" onClick={() => { toggleSection(selectedSection); setMobileActionsOpen(false); }}>{selectedSection.visible ? <Eye aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}{selectedSection.visible ? 'Hide section' : 'Show section'}</button>
            <button className="sheet-list-button" type="button" onClick={() => { setMobileActionsOpen(false); setMovingSectionId(selectedSection.id); }}><Menu aria-hidden="true" size={17} /> Move to another page</button>
            <button className="sheet-list-button" type="button" onClick={() => removeSection(selectedSection)}><RotateCcw aria-hidden="true" size={17} /> Remove from this page</button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

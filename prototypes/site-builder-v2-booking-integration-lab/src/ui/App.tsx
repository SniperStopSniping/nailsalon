import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  Laptop,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Save,
  Smartphone,
  Tablet,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  createEmptyBookingSession,
  createMenuFixture,
  normalizeBookingSelection,
} from '../booking/helpers';
import { BookingSettingsPanel } from '../booking/SettingsPanel';
import type {
  BookingSectionPresentationSettings,
  BookingSessionState,
  BookingTokenPresetId,
  ImageFixture,
  MenuSize,
} from '../booking/types';
import {
  getSectionMoveAnnouncement,
  type BuilderCommand,
  type CatalogueSectionType,
  type HistoryState,
  type OriginStarter,
  type PageDocument,
  type PlaceholderSectionInstance,
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
  PageSettingsDialog,
  SectionLibraryDialog,
  SectionSettingsDialog,
  StartAgainDialog,
} from './EditorDialogs';
import { Dialog } from './Dialog';
import { FinalStructurePanel } from './FinalStructurePanel';
import { BookingSectionCard } from './BookingSectionCard';
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
  const [structureOpen, setStructureOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [startAgainOpen, setStartAgainOpen] = useState(false);
  const [resetChoice, setResetChoice] = useState<ResetChoice>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [alertTitle, setAlertTitle] = useState('This change is protected');
  const [toast, setToast] = useState<ToastState>(null);
  const [announcement, setAnnouncement] = useState('');
  const [reorderBaseline, setReorderBaseline] = useState<HistoryState | null>(null);
  const [realHeightSimulation, setRealHeightSimulation] = useState(false);
  const [imageFixture, setImageFixture] = useState<ImageFixture>('image_rich');
  const [menuSize, setMenuSize] = useState<MenuSize>('canonical');
  const [tokenPreset, setTokenPreset] = useState<BookingTokenPresetId>('warm');
  const [bookingSession, setBookingSession] = useState<BookingSessionState>(
    createEmptyBookingSession,
  );

  const bookingFixture = useMemo(
    () => createMenuFixture({ imageFixture, menuSize }),
    [imageFixture, menuSize],
  );

  const activePage = document
    ? document.pages.find((page) => page.id === activePageId) ?? getHomeOrFirstPage(document)
    : null;
  const selectedSection = document ? findSection(document, selectedSectionId) : null;
  const editingSection = document ? findSection(document, editingSectionId) : null;
  const editingBooking = editingSection?.sectionType === 'booking' ? editingSection : null;
  const editingPlaceholder = editingSection && editingSection.sectionType !== 'booking'
    ? editingSection
    : null;
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

  useEffect(() => {
    setBookingSession((current) => {
      const selection = normalizeBookingSelection(
        current.selection,
        bookingFixture.services,
        bookingFixture.addOns,
      );
      const detailStillExists = current.detailServiceId === null
        || bookingFixture.services.some((service) => service.id === current.detailServiceId);
      return {
        ...current,
        selection,
        detailServiceId: detailStillExists ? current.detailServiceId : null,
        draftAddOnIds: detailStillExists ? current.draftAddOnIds : [],
        handoffOpen: selection.serviceId === null ? false : current.handoffOpen,
      };
    });
  }, [bookingFixture.addOns, bookingFixture.services]);

  useEffect(() => {
    window.document.body.dataset.editorShell = 'final-hybrid';
    return () => {
      delete window.document.body.dataset.editorShell;
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || window.document.querySelector('[role="dialog"]')) {
        return;
      }
      setSelectedSectionId(null);
      setMobileActionsOpen(false);
    };
    window.document.addEventListener('keydown', handleEscape);
    return () => window.document.removeEventListener('keydown', handleEscape);
  }, []);

  const sortedActiveSections = useMemo(
    () => activePage ? [...activePage.sections].sort((left, right) => left.order - right.order) : [],
    [activePage],
  );
  const canvasNavigationLabels = useMemo(() => {
    if (!document?.navigation.enabled) {
      return [];
    }
    return [...document.navigation.items]
      .sort((left, right) => left.order - right.order)
      .filter((item) => {
        const page = document.pages.find((candidate) => candidate.id === item.pageId);
        return page?.visible && page.visibleInNavigation;
      })
      .map((item) => item.label);
  }, [document]);

  const showError = (message: string, title = 'This change is protected') => {
    setAlertTitle(title);
    setAlertMessage(message);
  };

  const execute = (command: BuilderCommand) => {
    const result = lab.runCommand(command);
    if (!result.success) {
      if (result.code === 'booking_required') {
        showError(
          'Your site needs at least one visible way for clients to start booking.',
          'Keep a way to book',
        );
      } else {
        showError(result.message, 'That change is not available');
      }
    }
    return result;
  };

  const chooseStarter = (starter: OriginStarter) => {
    lab.chooseStarter(starter);
    setBookingSession(createEmptyBookingSession());
    setActivePageId(null);
    setSelectedSectionId(null);
    setMode('edit');
    setStartAgainOpen(false);
    setOptionsOpen(false);
    setToast({ message: `${starterLabel(starter)} is ready. Change anything later.` });
  };

  const enterReorder = () => {
    if (mode === 'reorder') {
      return;
    }
    setReorderBaseline(lab.createHistoryCheckpoint());
    setMode('reorder');
    setSelectedSectionId(null);
    setMobileActionsOpen(false);
    setStructureOpen(false);
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
    if (!document || mode === 'reorder') {
      return;
    }
    const current = activePage?.visible ? activePage : document.pages.find((page) => page.visible) ?? getHomeOrFirstPage(document);
    setReorderBaseline(null);
    setActivePageId(current.id);
    setStructureOpen(false);
    if (window.matchMedia('(max-width: 700px)').matches || window.document.body.clientWidth <= 700) {
      setViewport('mobile');
    }
    setMode('preview');
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  };

  const addSection = (sectionType: CatalogueSectionType, size: SectionSize) => {
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
    setStructureOpen(false);
    setSelectedSectionId(section.id);
    setEditingSectionId(section.id);
    setMobileActionsOpen(false);
    setToast(null);
  };

  const saveSection = (values: { note: string; size: SectionSize }) => {
    if (!editingPlaceholder) {
      return;
    }
    const result = execute({ type: 'update_section_settings', sectionId: editingPlaceholder.id, note: values.note, size: values.size });
    if (result.success) {
      setEditingSectionId(null);
      setToast({ message: `${editingPlaceholder.label} settings saved.` });
    }
  };

  const updateBookingPresentation = (
    settings: BookingSectionPresentationSettings,
  ) => {
    if (!editingBooking) {
      return;
    }
    const result = execute({
      type: 'update_booking_presentation',
      sectionId: editingBooking.id,
      settings,
    });
    if (!result.success) {
      return;
    }
    setToast({ message: 'Booking presentation updated.' });
  };

  const resetBookingPresentation = () => {
    if (!editingBooking) {
      return;
    }
    const result = execute({
      type: 'reset_booking_presentation',
      sectionId: editingBooking.id,
    });
    if (result.success) {
      setToast({ message: 'Booking presentation reset.' });
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
      setToast({ message: 'Section removed', undoable: true });
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
    setStructureOpen(false);
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
      setToast({ message: 'Page removed', undoable: true });
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
      setToast({ message: `Menu ${document.navigation.enabled ? 'turned off' : 'added'}.` });
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
    anchor.download = 'luster-site-builder-v2-booking-integration-lab-v1.json';
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
      setBookingSession(createEmptyBookingSession());
      setMode('edit');
      setToast({ message: 'Site restored from imported JSON.' });
    } catch {
      showError('The selected file could not be read.', 'Import could not be completed');
    }
  };

  const confirmReset = () => {
    if (resetChoice === 'lab') {
      lab.resetLab();
      setBookingSession(createEmptyBookingSession());
      setOptionsOpen(false);
      setToast(null);
    } else if (resetChoice === 'starter') {
      lab.resetToStarter();
      setBookingSession(createEmptyBookingSession());
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
        <StarterChooser
          onChoose={chooseStarter}
          onImport={importFile}
        />
        <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} title={alertTitle} />
      </>
    );
  }

  const previewPage = activePage.visible ? activePage : document.pages.find((page) => page.visible) ?? getHomeOrFirstPage(document);

  const undoLastChange = () => {
    if (lab.undo()) {
      setAnnouncement('Last change undone.');
      setToast({ message: 'Last change undone.' });
    }
  };

  const redoLastChange = () => {
    if (lab.redo()) {
      setAnnouncement('Last change redone.');
      setToast({ message: 'Last change redone.' });
    }
  };

  const closeStructureOnMobile = () => {
    if (window.matchMedia('(max-width: 899px)').matches) {
      setStructureOpen(false);
    }
  };

  const openStructure = () => {
    setEditingSectionId(null);
    setMovingSectionId(null);
    setEditingPageId(null);
    setAddPageOpen(false);
    setMobileActionsOpen(false);
    setStructureOpen(true);
  };

  const openMoveSection = (sectionId: string) => {
    setStructureOpen(false);
    setMovingSectionId(sectionId);
  };

  const structurePanel = (
    <FinalStructurePanel
      activePageId={activePage.id}
      document={document}
      onAddPage={() => { setStructureOpen(false); setAddPageOpen(true); }}
      onEditPage={(page) => { setStructureOpen(false); setEditingPageId(page.id); }}
      onEnterReorder={enterReorder}
      onMoveNavigationItem={(pageId, position) => execute({ type: 'move_navigation_item', pageId, position })}
      onMovePage={movePage}
      onRemovePage={(page) => { setStructureOpen(false); setPendingPageRemovalId(page.id); }}
      onRenameNavigationItem={(pageId, label) => execute({ type: 'rename_navigation_item', pageId, label })}
      onRestorePage={restorePage}
      onRestoreSection={restoreSection}
      onSelectPage={(pageId) => {
        setActivePageId(pageId);
        setSelectedSectionId(null);
        closeStructureOnMobile();
      }}
      onSelectSection={(pageId, section) => {
        setActivePageId(pageId);
        setSelectedSectionId(section.id);
        closeStructureOnMobile();
      }}
      onToggleNavigation={toggleNavigation}
      open={structureOpen}
      selectedSectionId={selectedSectionId}
    />
  );

  const zoomCompactedPreview = window.innerWidth > 700 && window.document.body.clientWidth <= 700;

  if (mode === 'preview') {
    return (
      <div className={`preview-app final-hybrid-preview${realHeightSimulation ? ' is-real-height-simulation' : ''}`} data-editor-shell="final-hybrid">
        <header className={`preview-toolbar final-preview-toolbar${zoomCompactedPreview ? ' is-zoom-compact' : ''}`} aria-label="Preview controls">
          <button aria-label="Back to editor" className="final-preview-toolbar__back" type="button" onClick={() => setMode('edit')}><ArrowLeft aria-hidden="true" size={18} /><span>Back to editor</span></button>
          <div className="final-preview-toolbar__page"><Eye aria-hidden="true" size={17} /><span>Previewing <strong>{previewPage.name}</strong></span></div>
          <div className="segmented-control final-preview-devices" role="group" aria-label="Preview viewport">
            <button aria-label="Desktop" aria-pressed={viewport === 'desktop'} type="button" onClick={() => setViewport('desktop')}><Laptop aria-hidden="true" size={17} /><span>Desktop</span></button>
            <button aria-label="Tablet" aria-pressed={viewport === 'tablet'} type="button" onClick={() => setViewport('tablet')}><Tablet aria-hidden="true" size={17} /><span>Tablet</span></button>
            <button aria-label="Phone" aria-pressed={viewport === 'mobile'} type="button" onClick={() => setViewport('mobile')}><Smartphone aria-hidden="true" size={17} /><span>Phone</span></button>
          </div>
        </header>
        <section aria-label="Site preview">
          <Preview
            activePage={previewPage}
            bookingFixture={bookingFixture}
            bookingSession={bookingSession}
            document={document}
            tokenPreset={tokenPreset}
            viewport={viewport}
            onBookingSessionChange={setBookingSession}
            onNavigate={(pageId) => {
              const page = document.pages.find((candidate) => candidate.id === pageId);
              if (page?.visible) {
                setActivePageId(pageId);
              }
            }}
          />
        </section>
      </div>
    );
  }

  return (
    <div
      className={`editor-app final-hybrid-app${selectedSection ? ' has-selected-section' : ''}${editingSectionId || movingSectionId || editingPageId || addPageOpen ? ' has-context-drawer' : ''}${realHeightSimulation ? ' is-real-height-simulation' : ''}`}
      data-canvas-viewport={viewport}
      data-editor-shell="final-hybrid"
      data-editor-mode={mode}
      data-testid="final-hybrid-editor"
    >
      <header className="final-topbar" aria-label="Site builder toolbar">
        <div className="final-topbar__brand">
          <span aria-hidden="true">L</span><strong>Luster</strong>
          {lab.saveStatus === 'error' ? (
            <><button aria-label="Local save failed. Open backup and reset options" className="save-status is-error" type="button" onClick={() => setOptionsOpen(true)}><AlertTriangle aria-hidden="true" size={15} /><span>Save failed</span></button><span className="visually-hidden" role="alert">Local saving failed. Open backup and reset options for recovery actions.</span></>
          ) : (
            <span className={`save-status${lab.saveStatus === 'saved' ? ' is-saved' : ''}`} role="status" aria-label="Save status">
              {lab.saveStatus === 'saved' ? <Check aria-hidden="true" size={14} /> : <Save aria-hidden="true" size={14} />}
              <span>{lab.saveStatus === 'saving' ? 'Saving…' : 'Saved'}</span>
            </span>
          )}
        </div>
        {mode === 'reorder' ? (
          <div className="final-topbar__page final-topbar__page-label"><span>{activePage.name}</span></div>
        ) : (
          <button
            aria-expanded={structureOpen}
            aria-label={`Open Pages & Structure for ${activePage.name}`}
            className="final-topbar__page"
            type="button"
            onClick={openStructure}
          >
            <span>{activePage.name}</span><ChevronDown aria-hidden="true" size={16} />
          </button>
        )}
        <div className="final-topbar__actions">
          {mode === 'reorder' ? <span className="final-topbar__reorder-status">Reordering</span> : (
            <>
              <div className="final-topbar__history">
                <button aria-label="Undo" disabled={!lab.canUndo} type="button" onClick={undoLastChange}><Undo2 aria-hidden="true" size={18} /></button>
                <button aria-label="Redo" disabled={!lab.canRedo} type="button" onClick={redoLastChange}><Redo2 aria-hidden="true" size={18} /></button>
              </div>
              <button aria-label="Preview" className="final-topbar__preview" type="button" onClick={enterPreview}><Eye aria-hidden="true" size={18} /><span>Preview</span></button>
              <button aria-label="More site options" className="final-topbar__more" type="button" onClick={() => setOptionsOpen(true)}><MoreHorizontal aria-hidden="true" size={20} /></button>
            </>
          )}
        </div>
      </header>

      <main
        className="final-canvas-shell"
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest('.section-card, button, input, select, textarea, a')) {
            setSelectedSectionId(null);
            setMobileActionsOpen(false);
          }
        }}
      >
        <div className="final-canvas-frame">
          {mode === 'reorder' ? (
            <section aria-label={`Reorder sections on ${activePage.name}`} className="final-reorder-shell">
              <div className="final-reorder-heading">
                <span>Page · {activePage.name}</span>
                <h1>Reorder sections</h1>
                <p>Drag from a handle, tap a number, or use the movement buttons. Normal scrolling stays safe outside the handles.</p>
              </div>
              {sortedActiveSections.length > 0 ? (
                <ReorderList
                  onAnnounce={setAnnouncement}
                  onDragReorder={(sectionId, position) => {
                    const result = execute({ type: 'move_section', sectionId, position });
                    if (result.success) {
                      setAnnouncement(getSectionMoveAnnouncement(result.document, sectionId));
                    }
                  }}
                  onMoveDown={moveSectionDown}
                  onMovePage={(section) => openMoveSection(section.id)}
                  onMoveUp={moveSectionUp}
                  onOpenPosition={(section) => setPositionSectionId(section.id)}
                  sections={sortedActiveSections}
                />
              ) : <p className="final-empty-page">This page has no sections to reorder.</p>}
              <div className="final-reorder-desktop-actions"><button type="button" onClick={cancelReorder}><X aria-hidden="true" size={17} /> Cancel</button><button type="button" onClick={finishReorder}><Check aria-hidden="true" size={17} /> Done</button></div>
            </section>
          ) : (
            <div className="final-site-canvas" data-page-id={activePage.id}>
              <div className="canvas-client-header" aria-hidden="true">
                <span><i>L</i><strong>{document.siteName}</strong></span>
                {canvasNavigationLabels.length > 0 ? <span className="canvas-client-header__nav">{canvasNavigationLabels.join('   ')}</span> : null}
              </div>
              <div className="final-page-heading">
                <h1>{activePage.name}</h1>
                <p>{activePage.sections.length} section{activePage.sections.length === 1 ? '' : 's'}{activePage.visible ? '' : ' · Page hidden'}</p>
              </div>

              <div aria-label={`Sections on ${activePage.name}`} className="final-sections-list" role="list">
                {sortedActiveSections.length === 0 ? (
                  <div className="final-empty-page">
                    <h2>Your page is empty</h2>
                    <p>Add a section to start building it.</p>
                    <button type="button" onClick={() => setLibraryPosition(1)}><Plus aria-hidden="true" size={18} /> Add section</button>
                  </div>
                ) : (
                  <>
                    <button className="final-insertion final-insertion--top" type="button" aria-label={`Add section at top of ${activePage.name}`} onClick={() => setLibraryPosition(1)}><Plus aria-hidden="true" size={15} /> Add section here</button>
                    {sortedActiveSections.map((section, index) => (
                      <div className="final-section-block" key={section.id}>
                        {section.sectionType === 'booking' ? (
                          <BookingSectionCard
                            fixture={bookingFixture}
                            page={activePage}
                            section={section}
                            selected={selectedSectionId === section.id}
                            session={bookingSession}
                            tokenPreset={tokenPreset}
                            onEdit={editSection}
                            onEnterReorder={enterReorder}
                            onMove={(candidate) => openMoveSection(candidate.id)}
                            onRemove={removeSection}
                            onSelect={(candidate) => {
                              setSelectedSectionId((current) => current === candidate.id ? null : candidate.id);
                              setMobileActionsOpen(false);
                            }}
                            onSessionChange={setBookingSession}
                            onToggleVisible={toggleSection}
                          />
                        ) : (
                          <SectionCard
                            page={activePage}
                            section={section}
                            selected={selectedSectionId === section.id}
                            onEdit={editSection}
                            onEnterReorder={enterReorder}
                            onMove={(candidate) => openMoveSection(candidate.id)}
                            onRemove={removeSection}
                            onSelect={(candidate) => {
                              setSelectedSectionId((current) => current === candidate.id ? null : candidate.id);
                              setMobileActionsOpen(false);
                            }}
                            onToggleVisible={toggleSection}
                          />
                        )}
                        <button
                          className="final-insertion"
                          type="button"
                          aria-label={index === sortedActiveSections.length - 1 ? `Add section at bottom of ${activePage.name}` : `Add section after ${section.label}`}
                          onClick={() => setLibraryPosition(index + 2)}
                        >
                          <Plus aria-hidden="true" size={15} /> Add section here
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <div className="final-mobile-dock">
        {mode === 'reorder' ? (
          <div aria-label="Reorder actions" className="final-mobile-dock__reorder" role="group">
            <button type="button" onClick={cancelReorder}>Cancel</button>
            <button className="is-primary" type="button" onClick={finishReorder}>Done</button>
          </div>
        ) : selectedSection ? (
          <div aria-label={`${selectedSection.label} actions`} className="final-mobile-dock__selected" role="group">
            <button type="button" onClick={() => editSection(selectedSection)}><Pencil aria-hidden="true" size={18} /> Edit</button>
            <button type="button" onClick={() => openMoveSection(selectedSection.id)}><Menu aria-hidden="true" size={18} /> Move</button>
            <button type="button" onClick={() => toggleSection(selectedSection)}><Eye aria-hidden="true" size={18} /> {selectedSection.visible ? 'Hide' : 'Show'}</button>
            <button type="button" onClick={() => setMobileActionsOpen(true)}><MoreHorizontal aria-hidden="true" size={19} /> More</button>
          </div>
        ) : (
          <button className="final-mobile-dock__add" type="button" onClick={() => setLibraryPosition(sortedActiveSections.length + 1)}><Plus aria-hidden="true" size={20} /> Add section</button>
        )}
      </div>

      <div className="visually-hidden" aria-live="polite" data-testid="reorder-live-region" role="status">{announcement}</div>

      {toast ? (
        <div className="toast" role="status"><span>{toast.message}</span>{toast.undoable ? <button type="button" onClick={() => { lab.undo(); setToast(null); setAnnouncement('Removal undone.'); }}>Undo</button> : null}</div>
      ) : null}

      <SectionLibraryDialog document={document} insertionPosition={libraryPosition} onAdd={addSection} onClose={() => setLibraryPosition(null)} page={activePage} />
      <SectionSettingsDialog onClose={() => setEditingSectionId(null)} onSave={saveSection} section={editingPlaceholder} />
      <Dialog
        onClose={() => setEditingSectionId(null)}
        open={editingBooking !== null}
        title="Booking"
        variant="context-panel"
      >
        {editingBooking ? (
          <BookingSettingsPanel
            settings={editingBooking.settings}
            onChange={updateBookingPresentation}
            onReset={resetBookingPresentation}
          />
        ) : null}
      </Dialog>
      <MovePositionDialog currentPosition={currentPosition} onClose={() => setPositionSectionId(null)} onMove={(position) => { if (positionSection) moveSectionToPosition(positionSection, position); }} section={positionSection} total={positionSectionPage?.sections.length ?? 1} />
      <MoveSectionDialog currentPageId={movingSectionPage?.id ?? activePage.id} document={document} onClose={() => setMovingSectionId(null)} onCreatePage={(name) => { if (movingSection) moveSectionToNewPage(movingSection, name); }} onMove={(pageId) => { if (movingSection) moveSectionToPage(movingSection, pageId); }} section={movingSection} />
      <AddPageDialog onAdd={addPage} onClose={() => setAddPageOpen(false)} open={addPageOpen} />
      <PageSettingsDialog onClose={() => setEditingPageId(null)} onSave={savePage} page={editingPage} />
      <NavigationPromptDialog onAddNavigation={() => { execute({ type: 'toggle_navigation', enabled: true }); setNavigationPromptOpen(false); setToast({ message: 'Menu added.' }); }} onClose={() => setNavigationPromptOpen(false)} open={navigationPromptOpen} />
      <ConfirmationDialog confirmLabel="Remove page" danger description={pendingPageRemoval ? `${pendingPageRemoval.name} and its sections will move to Removed pages, where they can be restored.` : ''} onClose={() => setPendingPageRemovalId(null)} onConfirm={confirmRemovePage} open={pendingPageRemoval !== null} title="Remove this page?" />
      <LabOptionsDialog
        canRedo={lab.canRedo}
        canUndo={lab.canUndo}
        imageFixture={imageFixture}
        menuSize={menuSize}
        onClose={() => setOptionsOpen(false)}
        onExport={exportJson}
        onImageFixtureChange={setImageFixture}
        onImport={importFile}
        onMenuSizeChange={setMenuSize}
        onRedo={redoLastChange}
        onResetLab={() => { setOptionsOpen(false); setResetChoice('lab'); }}
        onResetStarter={() => { setOptionsOpen(false); setResetChoice('starter'); }}
        onStartAgain={() => { setOptionsOpen(false); setStartAgainOpen(true); }}
        onTokenPresetChange={setTokenPreset}
        onToggleRealHeightSimulation={() => setRealHeightSimulation((value) => !value)}
        onUndo={undoLastChange}
        open={optionsOpen}
        realHeightSimulation={realHeightSimulation}
        tokenPreset={tokenPreset}
      />
      <StartAgainDialog onChoose={chooseStarter} onClose={() => setStartAgainOpen(false)} open={startAgainOpen} />
      <ConfirmationDialog confirmLabel={resetChoice === 'lab' ? 'Reset Lab' : 'Reset to starter'} danger description={resetChoice === 'lab' ? 'This clears the local Lab document and returns to the starting-point chooser.' : 'This replaces local changes with fresh defaults for the current starting point.'} onClose={() => setResetChoice(null)} onConfirm={confirmReset} open={resetChoice !== null} title={resetChoice === 'lab' ? 'Reset the entire Lab?' : 'Reset to the starting point?'} />
      <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} title={alertTitle} />

      <Dialog onClose={() => setStructureOpen(false)} open={structureOpen} title="Pages & Structure" variant="structure-panel">
        {structurePanel}
      </Dialog>
      <Dialog onClose={() => setMobileActionsOpen(false)} open={mobileActionsOpen && selectedSection !== null} title={selectedSection ? `${selectedSection.label} actions` : 'Section actions'} variant="bottom-sheet">
        {selectedSection ? (
          <div className="final-more-actions">
            <p>
              {selectedSection.visible ? 'Shown on your website' : 'Hidden from clients'} · {' '}
              {selectedSection.sectionType === 'booking'
                ? 'Protected client booking menu'
                : `${selectedSection.size} placeholder`}
            </p>
            <button type="button" onClick={() => { setMobileActionsOpen(false); openMoveSection(selectedSection.id); }}><Menu aria-hidden="true" size={18} /> Move to page</button>
            <button type="button" onClick={() => { setMobileActionsOpen(false); removeSection(selectedSection); }}><Trash2 aria-hidden="true" size={18} /> Remove from page</button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

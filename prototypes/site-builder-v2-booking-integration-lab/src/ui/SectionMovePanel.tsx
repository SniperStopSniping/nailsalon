import { ChevronRight, MoveRight, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { PageDocument, SectionInstance, SiteBuilderDocument } from '../model';
import { Dialog } from './Dialog';
import { ReorderList } from './ReorderList';

type SectionMovePanelProps = {
  activeSectionId: string;
  commitStatus: 'error' | 'saved' | 'saving';
  dirty: boolean;
  document: SiteBuilderDocument;
  entry: 'arrange' | 'section';
  onActivateSection: (section: SectionInstance) => void;
  onAnnounce: (message: string) => void;
  onCancel: () => void;
  onCreatePage: (name: string) => void;
  onDone: () => void;
  onDragReorder: (sectionId: string, position: number) => void;
  onMoveDown: (section: SectionInstance) => void;
  onMoveToPage: (pageId: string) => void;
  onMoveToPosition: (section: SectionInstance, position: number) => void;
  onMoveUp: (section: SectionInstance) => void;
  onRequestClose: () => void;
  open: boolean;
  page: PageDocument;
  sections: SectionInstance[];
};

const sectionName = (section: SectionInstance | null): string =>
  section?.sectionType === 'booking' ? 'Booking' : section?.label ?? 'section';

export function SectionMovePanel({
  activeSectionId,
  commitStatus,
  dirty,
  document,
  entry,
  onActivateSection,
  onAnnounce,
  onCancel,
  onCreatePage,
  onDone,
  onDragReorder,
  onMoveDown,
  onMoveToPage,
  onMoveToPosition,
  onMoveUp,
  onRequestClose,
  open,
  page,
  sections,
}: SectionMovePanelProps) {
  const activeSection = sections.find((section) => section.id === activeSectionId) ?? null;
  const activeName = sectionName(activeSection);
  const [newPageName, setNewPageName] = useState('');
  const [pageDestinationsOpen, setPageDestinationsOpen] = useState(sections.length < 2);
  const [scrollable, setScrollable] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const destinationRef = useRef<HTMLDivElement>(null);
  const pageNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setNewPageName('');
    setPageDestinationsOpen(sections.length < 2);
  }, [open, page.id, sections.length]);

  useEffect(() => {
    if (!open) return undefined;
    const scroll = scrollRef.current;
    if (!scroll) return undefined;
    const update = () => {
      setScrollable(scroll.scrollHeight > scroll.clientHeight + 2);
      setScrolledToEnd(scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroll);
    const child = scroll.firstElementChild;
    if (child) observer?.observe(child);
    scroll.addEventListener('scroll', update, { passive: true });
    return () => {
      observer?.disconnect();
      scroll.removeEventListener('scroll', update);
    };
  }, [open, pageDestinationsOpen, sections.length]);

  const revealDestinations = () => {
    setPageDestinationsOpen((current) => {
      const next = !current;
      if (next) {
        window.requestAnimationFrame(() => {
          destinationRef.current?.scrollIntoView({ block: 'start' });
          const firstDestination = destinationRef.current?.querySelector<HTMLButtonElement>('[data-destination-page]');
          (firstDestination ?? pageNameRef.current)?.focus({ preventScroll: true });
        });
      }
      return next;
    });
  };

  const createPage = (event: FormEvent) => {
    event.preventDefault();
    if (newPageName.trim()) onCreatePage(newPageName.trim());
  };

  const otherPages = document.pages.filter((candidate) => candidate.id !== page.id);

  return (
    <Dialog
      description={entry === 'arrange'
        ? `Arrange sections on ${page.name}. Choose a row to move it.`
        : `Arrange sections on ${page.name}, or move ${activeName} to another page.`}
      initialFocusSelector="[data-move-target-row='true']"
      onClose={onRequestClose}
      open={open}
      title={entry === 'arrange' ? 'Arrange sections' : `Move ${activeName}`}
      variant="move-panel"
    >
      <div className="section-move-panel" data-dirty={dirty ? 'true' : 'false'} data-testid="move-section-panel">
        <div
          ref={scrollRef}
          className={`section-move-panel__scroll${scrollable && !scrolledToEnd ? ' has-more-content' : ''}`}
        >
          <div className="section-move-panel__content">
            <section aria-labelledby="move-current-page-heading" className="move-current-page">
              <div className="move-current-page__heading">
                <div>
                  <span>Sections on</span>
                  <h3 id="move-current-page-heading">{page.name}</h3>
                </div>
                <span>{sections.length} section{sections.length === 1 ? '' : 's'}</span>
              </div>
              {sections.length < 2 ? (
                <p className="move-current-page__help" id="move-position-help">
                  {activeName} is the only section on {page.name}.
                </p>
              ) : (
                <p className="move-current-page__help" id="move-position-help">
                  Type a position and press Enter, use the arrows, or drag a handle. Cancel puts everything back.
                </p>
              )}
              <ReorderList
                onActivateSection={onActivateSection}
                onAnnounce={onAnnounce}
                onDragReorder={onDragReorder}
                onMoveDown={onMoveDown}
                onMoveToPosition={onMoveToPosition}
                onMoveUp={onMoveUp}
                sections={sections}
                selectedSectionId={activeSectionId}
              />
            </section>

            <section className="move-page-destination">
              <button
                aria-controls="move-page-destinations"
                aria-expanded={pageDestinationsOpen}
                className="move-page-disclosure"
                type="button"
                onClick={revealDestinations}
              >
                <span><MoveRight aria-hidden="true" size={18} /> Move {activeName} to another page</span>
                <ChevronRight aria-hidden="true" className={pageDestinationsOpen ? 'is-open' : ''} size={18} />
              </button>

              {pageDestinationsOpen ? (
                <div ref={destinationRef} className="move-page-destination__body" id="move-page-destinations" tabIndex={-1}>
                  <p className="move-page-destination__identity">Moving <strong>{activeName}</strong></p>
                  {otherPages.length > 0 ? (
                    <ul className="move-page-list" aria-label="Destination pages">
                      {otherPages.map((candidate) => (
                        <li key={candidate.id}>
                          <button
                            className="sheet-list-button"
                            data-destination-page
                            type="button"
                            onClick={() => onMoveToPage(candidate.id)}
                          >
                            {candidate.name}<span aria-hidden="true">→</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="empty-state">There are no other pages yet. Create one below and {activeName} will move there.</p>}
                  <form onSubmit={createPage}>
                    <label className="form-field move-page-destination__new-page">
                      <span>Or create a new page</span>
                      <input
                        ref={pageNameRef}
                        autoComplete="off"
                        placeholder="Page name"
                        value={newPageName}
                        onChange={(event) => setNewPageName(event.target.value)}
                      />
                    </label>
                    <button className="move-page-create-button" disabled={!newPageName.trim()} type="submit">
                      <Plus aria-hidden="true" size={17} /> Create page and move
                    </button>
                  </form>
                </div>
              ) : null}
            </section>
          </div>
        </div>

        <div aria-label="Move actions" className="section-move-panel__footer" role="group">
          <span className="section-move-panel__status" data-status={dirty ? 'dirty' : commitStatus}>
            {dirty
              ? 'Order not saved yet'
              : commitStatus === 'error'
                ? 'Save failed'
                : commitStatus === 'saving'
                  ? 'Saving…'
                  : 'Saved'}
          </span>
          <span className="section-move-panel__helper">Cancel puts everything back.</span>
          <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="button" onClick={onDone}>Done</button>
        </div>
      </div>
    </Dialog>
  );
}

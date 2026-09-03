import { ChevronRight, MoveRight, Plus } from 'lucide-react';
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  type CommitSectionMoveDestination,
  getSectionMoveDestinationAvailability,
  type PageDocument,
  type SectionInstance,
  type SiteBuilderDocument,
} from '../model';
import { Dialog } from './Dialog';
import { ReorderList } from './ReorderList';

type SectionMovePanelProps = {
  commitStatus: 'error' | 'saved' | 'saving';
  destination: CommitSectionMoveDestination | null;
  dirty: boolean;
  document: SiteBuilderDocument;
  entry: 'arrange' | 'section';
  onActivateSection: (section: SectionInstance) => void;
  onAnnounce: (message: string) => void;
  onCancel: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClearDestination: () => void;
  onCreatePage: (name: string) => void;
  onDestinationPositionChange: (position: number) => void;
  onDone: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDragReorder: (sectionId: string, position: number) => void;
  onMoveDown: (section: SectionInstance) => void;
  onMoveToPage: (pageId: string) => void;
  onMoveToPosition: (section: SectionInstance, position: number) => void;
  onMoveUp: (section: SectionInstance) => void;
  onRequestClose: () => void;
  open: boolean;
  page: PageDocument;
  sections: SectionInstance[];
  targetSectionId: string;
};

const sectionName = (section: SectionInstance | null): string =>
  section?.sectionType === 'booking' ? 'Booking' : section?.label ?? 'section';

export function SectionMovePanel({
  commitStatus,
  destination,
  dirty,
  document,
  entry,
  onActivateSection,
  onAnnounce,
  onCancel,
  onClearDestination,
  onCreatePage,
  onDestinationPositionChange,
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
  targetSectionId,
}: SectionMovePanelProps) {
  const activeSection = sections.find(section => section.id === targetSectionId) ?? null;
  const activeName = sectionName(activeSection);
  const [newPageName, setNewPageName] = useState('');
  const [pageDestinationsOpen, setPageDestinationsOpen] = useState(sections.length < 2);
  const [scrollable, setScrollable] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const destinationRef = useRef<HTMLDivElement>(null);
  const pageNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setNewPageName('');
    setPageDestinationsOpen(sections.length < 2);
  }, [open, page.id, sections.length]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const scroll = scrollRef.current;
    if (!scroll) {
      return undefined;
    }
    const update = () => {
      setScrollable(scroll.scrollHeight > scroll.clientHeight + 2);
      setScrolledToEnd(scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroll);
    const child = scroll.firstElementChild;
    if (child) {
      observer?.observe(child);
    }
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
          destinationRef.current?.scrollIntoView?.({ block: 'start' });
          const firstDestination = destinationRef.current?.querySelector<HTMLButtonElement>('[data-destination-page]');
          (firstDestination ?? pageNameRef.current)?.focus({ preventScroll: true });
        });
      }
      return next;
    });
  };

  const createPage = (event: FormEvent) => {
    event.preventDefault();
    if (newPageName.trim()) {
      onCreatePage(newPageName.trim());
    }
  };

  const otherPages = document.pages.filter(candidate => candidate.id !== page.id);
  const selectedDestinationPage = destination?.type === 'existing_page'
    ? document.pages.find(candidate => candidate.id === destination.pageId) ?? null
    : null;
  const destinationPosition = destination?.type === 'existing_page'
    ? destination.position ?? ((selectedDestinationPage?.sections.length ?? 0) + 1)
    : 1;
  const destinationPreviewSections = activeSection && destination
    ? destination.type === 'new_page'
      ? [activeSection]
      : (() => {
          const next = [...(selectedDestinationPage?.sections ?? [])];
          next.splice(destinationPosition - 1, 0, activeSection);
          return next;
        })()
    : [];

  const destinationPositionLabel = (position: number): string => {
    if (!selectedDestinationPage) {
      return String(position);
    }
    const before = selectedDestinationPage.sections[position - 2];
    const after = selectedDestinationPage.sections[position - 1];
    if (!before && after) {
      return `${position} — Before ${sectionName(after)}`;
    }
    if (before && !after) {
      return `${position} — After ${sectionName(before)}`;
    }
    if (before && after) {
      return `${position} — Between ${sectionName(before)} and ${sectionName(after)}`;
    }
    return `${position} — Only position`;
  };

  return (
    <Dialog
      description={entry === 'arrange'
        ? `Arrange sections on ${page.name}. Choose a row to move it.`
        : `Arrange sections on ${page.name}, or move ${activeName} to another page.`}
      initialFocusSelector="[data-move-target-row='true']"
      onClose={onRequestClose}
      open={open}
      restoreFocusOnClose={false}
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
                <span>
                  {sections.length}
                  {' '}
                  section
                  {sections.length === 1 ? '' : 's'}
                </span>
              </div>
              {sections.length < 2
                ? (
                    <p className="move-current-page__help" id="move-position-help">
                      {activeName}
                      {' is the only section on '}
                      {page.name}
                      .
                    </p>
                  )
                : (
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
                selectedSectionId={targetSectionId}
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
                <span>
                  <MoveRight aria-hidden="true" size={18} />
                  {' '}
                  Move
                  {' '}
                  {activeName}
                  {' '}
                  to another page
                </span>
                <ChevronRight aria-hidden="true" className={pageDestinationsOpen ? 'is-open' : ''} size={18} />
              </button>

              {pageDestinationsOpen
                ? (
                    <div ref={destinationRef} className="move-page-destination__body" id="move-page-destinations" tabIndex={-1}>
                      <p className="move-page-destination__identity">
                        {'Moving '}
                        <strong>{activeName}</strong>
                      </p>
                      <ul className="move-page-list" aria-label="Destination pages">
                        <li>
                          <button
                            aria-pressed={destination === null}
                            className={`sheet-list-button move-page-list__button${destination === null ? ' is-selected' : ''}`}
                            type="button"
                            onClick={onClearDestination}
                          >
                            <span>
                              <strong>{page.name}</strong>
                              <small>Current page · Keep here</small>
                            </span>
                            {destination === null ? <span aria-hidden="true">✓</span> : null}
                          </button>
                        </li>
                        {otherPages.map((candidate) => {
                          const availability = activeSection
                            ? getSectionMoveDestinationAvailability(
                              document,
                              activeSection.id,
                              candidate.id,
                            )
                            : { available: false as const, reason: 'The section is no longer available.' };
                          const selected = destination?.type === 'existing_page'
                            && destination.pageId === candidate.id;
                          const reasonId = `move-destination-reason-${candidate.id}`;
                          const cues = [
                            ...(candidate.visible ? [] : ['Hidden from clients']),
                            ...(candidate.visibleInNavigation ? [] : ['Not in navigation']),
                          ];
                          return (
                            <li key={candidate.id}>
                              <button
                                aria-describedby={!availability.available ? reasonId : undefined}
                                aria-disabled={!availability.available ? 'true' : undefined}
                                aria-pressed={selected}
                                className={`sheet-list-button move-page-list__button${selected ? ' is-selected' : ''}${availability.available ? '' : ' is-unavailable'}`}
                                data-destination-page
                                type="button"
                                onClick={() => {
                                  if (availability.available) {
                                    onMoveToPage(candidate.id);
                                  } else {
                                    onAnnounce(availability.reason);
                                  }
                                }}
                              >
                                <span>
                                  <strong>{candidate.name}</strong>
                                  {cues.length > 0 ? <small>{cues.join(' · ')}</small> : null}
                                </span>
                                <span aria-hidden="true">{selected ? '✓' : availability.available ? '→' : '—'}</span>
                              </button>
                              {!availability.available
                                ? (
                                    <span className="move-page-list__reason" id={reasonId}>
                                      Unavailable —
                                      {' '}
                                      {availability.reason}
                                    </span>
                                  )
                                : null}
                            </li>
                          );
                        })}
                      </ul>
                      {otherPages.length === 0
                        ? (
                            <p className="empty-state">
                              {'There are no other pages yet. Create one below and stage '}
                              {activeName}
                              {' '}
                              to move there.
                            </p>
                          )
                        : null}
                      <form onSubmit={createPage}>
                        <label className="form-field move-page-destination__new-page">
                          <span>Or create a new page</span>
                          <input
                            ref={pageNameRef}
                            autoComplete="off"
                            placeholder="Page name"
                            value={newPageName}
                            onChange={event => setNewPageName(event.target.value)}
                          />
                        </label>
                        <button className="move-page-create-button" disabled={!newPageName.trim()} type="submit">
                          <Plus aria-hidden="true" size={17} />
                          {' '}
                          Create page and move
                        </button>
                      </form>

                      {destination && activeSection
                        ? (
                            <section aria-label="Staged destination" className="move-destination-preview">
                              <div className="move-destination-preview__heading">
                                <span>Staged destination</span>
                                <strong>{destination.type === 'new_page' ? destination.name : selectedDestinationPage?.name}</strong>
                              </div>
                              {destination.type === 'new_page'
                                ? (
                                    <p>
                                      <strong>{destination.name}</strong>
                                      {' '}
                                      will be created when you press Done.
                                    </p>
                                  )
                                : selectedDestinationPage
                                  ? (
                                      <label className="form-field move-destination-preview__position">
                                        <span>
                                          {'Position on '}
                                          {selectedDestinationPage.name}
                                        </span>
                                        <select
                                          aria-label={`Position on ${selectedDestinationPage.name}`}
                                          value={destinationPosition}
                                          onChange={event => onDestinationPositionChange(Number(event.target.value))}
                                        >
                                          {Array.from(
                                            { length: selectedDestinationPage.sections.length + 1 },
                                            (_value, index) => index + 1,
                                          ).map(position => (
                                            <option key={position} value={position}>
                                              {destinationPositionLabel(position)}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    )
                                  : null}
                              <ol aria-label={`Preview of sections on ${destination.type === 'new_page' ? destination.name : selectedDestinationPage?.name ?? 'destination page'}`}>
                                {destinationPreviewSections.map((section, index) => (
                                  <li className={section.id === activeSection.id ? 'is-moving' : undefined} key={section.id}>
                                    <span>{index + 1}</span>
                                    <span>
                                      <strong>{sectionName(section)}</strong>
                                      {section.id === activeSection.id ? <small>Moving here</small> : null}
                                    </span>
                                  </li>
                                ))}
                              </ol>
                              <button className="move-destination-preview__clear" type="button" onClick={onClearDestination}>
                                Keep
                                {' '}
                                {activeName}
                                {' '}
                                on
                                {' '}
                                {page.name}
                              </button>
                            </section>
                          )
                        : null}
                    </div>
                  )
                : null}
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

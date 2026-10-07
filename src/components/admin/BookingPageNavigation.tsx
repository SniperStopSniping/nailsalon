'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { BOOKING_PAGE_GROUPS, type BookingPagePanel, getBookingPageEditor } from './bookingPageEditorSections';

/** One destination list for the entry page and the persistent editor navigation. */
export function BookingPageNavigation({
  editorHref,
  includeFlow,
  currentPanel,
  disabled = false,
  onNavigate,
  customIsla = false,
}: {
  editorHref: string;
  includeFlow: boolean;
  currentPanel?: BookingPagePanel;
  disabled?: boolean;
  onNavigate?: (href: string) => void;
  customIsla?: boolean;
}) {
  return (
    <nav aria-label="Booking Page editors" className={currentPanel ? 'space-y-5' : 'grid gap-5 md:grid-cols-2 md:items-start'}>
      {BOOKING_PAGE_GROUPS.map(group => (
        <section key={group.id} aria-labelledby={`booking-page-group-${group.id}`}>
          <h2 id={`booking-page-group-${group.id}`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--owner-muted)]">{group.title}</h2>
          <ul className={currentPanel ? 'space-y-1' : 'divide-y divide-[var(--owner-line)] overflow-hidden rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)]'}>
            {group.panels.filter(id => id !== 'flow' || includeFlow).map((id) => {
              const { title, description, icon: Icon } = getBookingPageEditor(id, customIsla);
              const selected = currentPanel === id;
              return (
                <li key={id}>
                  <a
                    href={`${editorHref}&panel=${id}`}
                    aria-current={selected ? 'page' : undefined}
                    aria-disabled={disabled || undefined}
                    className={`flex min-h-11 min-w-0 items-center gap-3 rounded-xl p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] ${selected ? 'bg-[var(--owner-blush)] font-semibold text-[var(--owner-accent)]' : 'text-[var(--owner-ink)] hover:bg-[var(--owner-blush)]'} ${disabled ? 'opacity-60' : ''}`}
                    onClick={(event) => {
                      if (disabled || selected) {
                        event.preventDefault();
                      } else if (onNavigate && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                        event.preventDefault();
                        onNavigate(`${editorHref}&panel=${id}`);
                      }
                    }}
                  >
                    <Icon aria-hidden="true" className="shrink-0 text-[var(--owner-accent)]" size={currentPanel ? 18 : 20} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{title}</span>
                      {!currentPanel && <span className="mt-1 block text-sm leading-snug text-[var(--owner-muted)]">{description}</span>}
                    </span>
                    {!currentPanel && <ChevronRight aria-hidden="true" className="shrink-0 text-[var(--owner-muted)]" size={16} />}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function BookingPageEditorLayout({ children, panel, ...navigation }: {
  children: ReactNode;
  panel: BookingPagePanel;
} & Omit<Parameters<typeof BookingPageNavigation>[0], 'currentPanel'>) {
  const [expanded, setExpanded] = useState(false);
  // Settings-backed sections remount this layout. Treat that first committed
  // heading as a destination too, then leave focus alone during normal edits.
  const previousPanel = useRef<BookingPagePanel | null>(null);
  const previouslyExpanded = useRef(expanded);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panelChanged = previousPanel.current !== panel;
    const menuClosed = previouslyExpanded.current && !expanded;
    previousPanel.current = panel;
    previouslyExpanded.current = expanded;
    if (!panelChanged && !menuClosed) {
      return;
    }
    if (panelChanged) {
      setExpanded(false);
    }
    const destination = contentRef.current?.querySelector<HTMLElement>('[role="alertdialog"]')
      ?? contentRef.current?.querySelector<HTMLElement>('h1');
    if (destination) {
      destination.tabIndex = -1;
      destination.focus({ preventScroll: true });
      if (menuClosed) {
        destination.scrollIntoView?.({ block: 'start' });
      }
    }
  }, [expanded, panel]);

  return (
    <div className="mx-auto grid max-w-6xl items-start gap-5 [overflow-wrap:anywhere] lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
      <aside className="min-w-0 rounded-2xl border border-[var(--owner-line)] bg-[var(--owner-surface)] p-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto" aria-label="Booking Page sections">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-semibold text-[var(--owner-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--owner-focus)] lg:hidden"
          aria-expanded={expanded}
          aria-controls="booking-page-section-list"
          onClick={() => setExpanded(value => !value)}
        >
          <span className="min-w-0">
            <span className="block text-xs font-normal text-[var(--owner-muted)]">Sections</span>
            {getBookingPageEditor(panel, navigation.customIsla).title}
          </span>
          <ChevronDown aria-hidden="true" className={`shrink-0 ${expanded ? 'rotate-180' : ''}`} size={18} />
        </button>
        <div id="booking-page-section-list" className={`${expanded ? 'mt-4 block' : 'hidden'} lg:mt-0 lg:block`}>
          <BookingPageNavigation
            {...navigation}
            currentPanel={panel}
            onNavigate={navigation.onNavigate
              ? (href) => {
                  setExpanded(false);
                  navigation.onNavigate?.(href);
                }
              : undefined}
          />
        </div>
      </aside>
      <div ref={contentRef} className="min-w-0">{children}</div>
    </div>
  );
}

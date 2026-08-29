import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  Globe2,
  HelpCircle,
  LayoutDashboard,
  MoreHorizontal,
  Scissors,
  Users,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { SiteBuilderDocument } from '../../../model/types';
import { Dialog } from '../../../ui/Dialog';
import type { BusinessProfileDraft, PlanIntent } from '../../model/types';
import { serviceMenuPort } from '../adapters/service-menu';
import type {
  DashboardChecklistFixtures,
  DashboardChecklistItem,
  DashboardDestination,
  DashboardTourStep,
} from '../contracts/dashboard';
import {
  LAB_DASHBOARD_HANDOFF_PORT,
  LAB_DASHBOARD_TOUR_PORT,
  LAB_SETUP_CHECKLIST_PORT,
} from './createLabDashboardPorts';
import './dashboard-preview.css';

type DashboardPreviewSurfaceProps = {
  auditMode?: boolean;
  document: SiteBuilderDocument | null;
  fixtures: DashboardChecklistFixtures;
  onEditWebsite: () => void;
  onReturnToReview: () => void;
  onTourCompletedChange: (completed: boolean) => void;
  planIntent: PlanIntent | null;
  profile: BusinessProfileDraft;
  reducedMotion: boolean;
  selectedServiceIds: readonly string[];
  tourCompleted: boolean;
};

const DESTINATION_LABELS: Record<DashboardDestination, string> = {
  calendar: 'Calendar',
  clients: 'Clients',
  more: 'More',
  services: 'Services',
  today: 'Today',
  website: 'Website & Booking Page',
};

const DESTINATION_ORDER: readonly DashboardDestination[] = [
  'today',
  'website',
  'calendar',
  'clients',
  'services',
  'more',
];

const DESTINATION_ICONS = {
  calendar: CalendarDays,
  clients: Users,
  more: MoreHorizontal,
  services: Scissors,
  today: LayoutDashboard,
  website: Globe2,
} as const;

const STORYBOARD_COPY: Record<DashboardDestination, {
  description: string;
  eyebrow: string;
  items: readonly string[];
}> = {
  calendar: {
    description: 'See your Luster appointments by week or month. Calendar events can appear here after you connect Google Calendar.',
    eyebrow: 'Your calendar',
    items: ['Week view', 'Month view', 'Luster appointments', 'Add an appointment'],
  },
  clients: {
    description: 'Keep visits, spending and follow-ups easy to find when a client returns.',
    eyebrow: 'Your clients',
    items: ['Client list', 'Visit history', 'Spending', 'Follow-ups'],
  },
  more: {
    description: 'Connections, settings and workspace help stay together in More.',
    eyebrow: 'Your workspace',
    items: ['Google Calendar', 'Payments', 'Integrations', 'Help and tour replay'],
  },
  services: {
    description: 'Your selected nail services are ready to refine whenever you want.',
    eyebrow: 'Your services',
    items: ['Prices and durations', 'Service photos', 'Add-ons', 'Service Library'],
  },
  today: {
    description: 'See the parts of your business that need your attention today.',
    eyebrow: 'Your day at a glance',
    items: ['Upcoming appointments', 'Today’s schedule', 'Follow-ups', 'Needs attention'],
  },
  website: {
    description: 'Preview, edit and share the website and Booking Page you just created.',
    eyebrow: 'Your website and booking page',
    items: ['Preview website', 'Edit website', 'Share booking link', 'Booking Page'],
  },
};

const planLabel = (intent: PlanIntent | null): string => {
  if (intent === 'free') return 'Free selected';
  if (intent === 'monthly') return 'Monthly interest saved — we’ll let you know when details are ready';
  if (intent === 'founding') return 'Founding offer reserved — we’ll let you know when details are ready';
  return 'Setup complete';
};

const checklistStatusLabel = (item: DashboardChecklistItem): string => {
  if (item.status === 'complete') return 'Ready';
  if (item.status === 'connected') return 'Connected';
  if (item.status === 'needs_attention') return 'Needs attention';
  if (item.id === 'share_booking_link') return 'Not shared yet';
  return 'Not connected';
};

function DashboardTour({
  onClose,
  onComplete,
  onDestinationChange,
  open,
}: {
  onClose: () => void;
  onComplete: () => void;
  onDestinationChange: (destination: DashboardDestination) => void;
  open: boolean;
}) {
  const steps = useMemo(() => LAB_DASHBOARD_TOUR_PORT.getSteps(), []);
  const [index, setIndex] = useState(0);
  const step = steps[index] as DashboardTourStep;

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    onDestinationChange(steps[0]?.destination ?? 'today');
  }, [onDestinationChange, open, steps]);

  const selectIndex = (nextIndex: number) => {
    const bounded = Math.max(0, Math.min(steps.length - 1, nextIndex));
    setIndex(bounded);
    const nextStep = steps[bounded];
    if (nextStep) onDestinationChange(nextStep.destination);
  };

  return (
    <Dialog
      description="Five quick stops. You can skip the tour and replay it later."
      initialFocusSelector="[data-dashboard-tour-heading]"
      onClose={onClose}
      open={open}
      title="A quick look around Luster"
    >
      <div className="lab-dashboard-tour">
        <div className="lab-dashboard-tour__progress">
          <span aria-label={`Tour step ${index + 1} of ${steps.length}`}>{index + 1} of {steps.length}</span>
          <span>{DESTINATION_LABELS[step.destination]}</span>
        </div>
        <section aria-live="polite" className="lab-dashboard-tour__moment">
          <h3 data-dashboard-tour-heading tabIndex={-1}>{step.title}</h3>
          <p>{step.description}</p>
          <p className="lab-dashboard-tour__spotlight-note">
            This area is highlighted in the dashboard behind the tour.
          </p>
        </section>
        <footer className="lab-dashboard-tour__actions">
          <button type="button" onClick={onClose}>Skip tour</button>
          <span />
          {index > 0 ? (
            <button type="button" onClick={() => selectIndex(index - 1)}>
              <ChevronLeft aria-hidden="true" size={16} /> Back
            </button>
          ) : null}
          {index < steps.length - 1 ? (
            <button className="is-primary" type="button" onClick={() => selectIndex(index + 1)}>
              Next <ChevronRight aria-hidden="true" size={16} />
            </button>
          ) : (
            <button className="is-primary" type="button" onClick={onComplete}>Done</button>
          )}
        </footer>
      </div>
    </Dialog>
  );
}

export function DashboardPreviewSurface({
  auditMode = false,
  document,
  fixtures,
  onEditWebsite,
  onReturnToReview,
  onTourCompletedChange,
  planIntent,
  profile,
  reducedMotion,
  selectedServiceIds,
  tourCompleted,
}: DashboardPreviewSurfaceProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const storyboardRef = useRef<HTMLElement>(null);
  const storyboardHeadingRef = useRef<HTMLHeadingElement>(null);
  const navButtonRefs = useRef<Partial<Record<DashboardDestination, HTMLButtonElement | null>>>({});
  const hasFocusedDashboardRef = useRef(false);
  const focusTodayAfterTourRef = useRef(false);
  const [destination, setDestination] = useState<DashboardDestination>(
    LAB_DASHBOARD_HANDOFF_PORT.getInitialDestination,
  );
  const [tourOpen, setTourOpen] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(true);
  const checklist = useMemo(() => LAB_SETUP_CHECKLIST_PORT.getItems({
    document,
    fixtures,
    selectedServiceIds,
  }), [document, fixtures, selectedServiceIds]);
  const selectedServices = useMemo(() => serviceMenuPort.getSelectedServices({
    ownerOverridesByServiceId: {},
    reviewed: true,
    selectedServiceIds: [...selectedServiceIds],
  }), [selectedServiceIds]);
  const storyboard = STORYBOARD_COPY[destination];
  const doneItems = checklist.filter((item) => item.status === 'complete' || item.status === 'connected');
  const nextItems = checklist.filter((item) => item.status !== 'complete' && item.status !== 'connected');

  useEffect(() => {
    if (tourOpen || hasFocusedDashboardRef.current) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      hasFocusedDashboardRef.current = true;
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [tourOpen]);

  useEffect(() => {
    if (tourOpen || !focusTodayAfterTourRef.current) return undefined;
    const focusFrame = window.requestAnimationFrame(() => {
      storyboardHeadingRef.current?.focus({ preventScroll: true });
      focusTodayAfterTourRef.current = false;
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [tourOpen]);

  useEffect(() => {
    navButtonRefs.current[destination]?.scrollIntoView?.({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [destination, reducedMotion]);

  const selectDestination = useCallback((next: DashboardDestination, moveFocus = false) => {
    setDestination(next);
    window.requestAnimationFrame(() => {
      storyboardRef.current?.scrollIntoView?.({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
      if (moveFocus) storyboardHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [reducedMotion]);

  const showTourDestination = useCallback((next: DashboardDestination) => {
    setDestination(next);
    window.requestAnimationFrame(() => {
      storyboardRef.current?.scrollIntoView?.({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      });
    });
  }, [reducedMotion]);

  const openTour = () => setTourOpen(true);
  const closeTour = () => {
    onTourCompletedChange(true);
    setTourOpen(false);
  };
  const completeTour = () => {
    onTourCompletedChange(true);
    focusTodayAfterTourRef.current = true;
    setTourOpen(false);
    selectDestination('today');
  };

  const businessName = profile.businessName.trim() || 'Your nail business';
  const ownerName = profile.ownerName.trim() || businessName;

  return (
    <main className={`lab-dashboard-preview${reducedMotion ? ' is-reduced-motion' : ''}${tourOpen ? ' is-tour-open' : ''}`}>
      <header className="lab-dashboard-preview__topbar">
        <div><span>L</span><strong>Luster</strong></div>
        <p>Changes stay on this device</p>
        <button type="button" onClick={openTour}>
          <HelpCircle aria-hidden="true" size={17} /> {tourCompleted ? 'Replay tour' : 'Take a quick tour'}
        </button>
      </header>

      {welcomeVisible ? (
        <section className="lab-dashboard-preview__welcome">
          <p>{planLabel(planIntent)}</p>
          <h1 ref={headingRef} tabIndex={-1}>You’re ready</h1>
          <p>{ownerName}, your website, booking page and service menu are set up. This is where you’ll manage appointments, clients, services and your site.</p>
          <div className="lab-dashboard-preview__handoff-actions">
            <button className="is-primary" type="button" onClick={onEditWebsite}>Edit my website</button>
            <button type="button" onClick={openTour}>Take a quick tour</button>
            <button type="button" onClick={() => {
              setWelcomeVisible(false);
              selectDestination('today', true);
            }}>Explore dashboard</button>
            {auditMode ? (
              <button type="button" onClick={onReturnToReview}>Return to onboarding review · Lab only</button>
            ) : null}
          </div>
        </section>
      ) : (
        <h1 className="visually-hidden" ref={headingRef} tabIndex={-1}>Luster dashboard</h1>
      )}

      <nav aria-label="Dashboard destinations" className="lab-dashboard-preview__nav">
        {DESTINATION_ORDER.map((id) => {
          const Icon = DESTINATION_ICONS[id];
          return (
            <button
              ref={(element) => { navButtonRefs.current[id] = element; }}
              aria-current={destination === id ? 'page' : undefined}
              key={id}
              type="button"
              onClick={() => selectDestination(id)}
            >
              <Icon aria-hidden="true" size={18} /> {DESTINATION_LABELS[id]}
            </button>
          );
        })}
      </nav>

      <div className="lab-dashboard-preview__grid">
        <section
          ref={storyboardRef}
          aria-labelledby="dashboard-storyboard-heading"
          className="lab-dashboard-storyboard"
          data-tour-highlighted={tourOpen ? 'true' : undefined}
        >
          <p>{storyboard.eyebrow}</p>
          <h2 id="dashboard-storyboard-heading" ref={storyboardHeadingRef} tabIndex={-1}>
            {destination === 'today' ? `Today at ${businessName}` : DESTINATION_LABELS[destination]}
          </h2>
          <p>{storyboard.description}</p>
          <div className={`lab-dashboard-storyboard__visual is-${destination}`} aria-label={`${DESTINATION_LABELS[destination]} preview`}>
            {destination === 'services' ? (
              <article className="lab-dashboard-storyboard__service-summary">
                <span aria-hidden="true">{selectedServices.length}</span>
                <strong>{selectedServices.length} selected {selectedServices.length === 1 ? 'service' : 'services'}</strong>
                <small>Ready to edit from Services</small>
              </article>
            ) : null}
            {destination === 'services' ? selectedServices.slice(0, 4).map((service) => (
              <article key={service.id}>
                <span aria-hidden="true">✓</span>
                <strong>{service.name}</strong>
                <small>{service.durationLabel} · {service.priceLabel}</small>
              </article>
            )) : storyboard.items.map((item, index) => (
              <article key={item}>
                <span aria-hidden="true">{index + 1}</span>
                <strong>{item}</strong>
              </article>
            ))}
          </div>
          {destination === 'website' ? (
            <button className="lab-dashboard-storyboard__edit" type="button" onClick={onEditWebsite}>
              Edit my website <ExternalLink aria-hidden="true" size={16} />
            </button>
          ) : null}
        </section>

        <aside aria-labelledby="setup-checklist-heading" className="lab-dashboard-checklist">
          <p>Keep going at your own pace</p>
          <h2 id="setup-checklist-heading">What’s next</h2>
          {doneItems.length > 0 ? (
            <section aria-labelledby="checklist-done-heading">
              <h3 id="checklist-done-heading">Done</h3>
              <ul>
                {doneItems.map((item) => (
                  <li className="is-complete" key={item.id}>
                    <Check aria-hidden="true" size={17} />
                    <button aria-label={`${item.label}, ${checklistStatusLabel(item)}`} type="button" onClick={() => selectDestination(item.destination, true)}>
                      <strong>{item.label}</strong><span>{checklistStatusLabel(item)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {nextItems.length > 0 ? (
            <section aria-labelledby="checklist-next-heading">
              <h3 id="checklist-next-heading">Whenever you’re ready</h3>
              <ul>
                {nextItems.map((item) => (
                  <li key={item.id}>
                    <Circle aria-hidden="true" size={17} />
                    <button aria-label={`${item.label}, ${checklistStatusLabel(item)}`} type="button" onClick={() => selectDestination(item.destination, true)}>
                      <strong>{item.label}</strong><span>{checklistStatusLabel(item)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {auditMode ? <small>Integration rows use explicit UX Lab fixture states; no provider account was changed.</small> : null}
        </aside>
      </div>

      <DashboardTour
        onClose={closeTour}
        onComplete={completeTour}
        onDestinationChange={showTourDestination}
        open={tourOpen}
      />
    </main>
  );
}

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
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
    description: 'Your weekly schedule brings Luster appointments and connected calendar time together.',
    eyebrow: 'Calendar preview',
    items: ['Week and month views', 'Luster appointments', 'Google Busy / Free events', 'Add appointment'],
  },
  clients: {
    description: 'Keep visits, spending and follow-ups easy to find when a client returns.',
    eyebrow: 'Clients preview',
    items: ['Client list', 'Visit history', 'Spending', 'Follow-ups'],
  },
  more: {
    description: 'Connections, settings and workspace tools stay together in More.',
    eyebrow: 'Workspace preview',
    items: ['Google Calendar', 'Payments', 'Integrations', 'Help and tour replay'],
  },
  services: {
    description: 'Your selected nail services are ready to refine whenever you want.',
    eyebrow: 'Services preview',
    items: ['Prices and durations', 'Service photos', 'Add-ons', 'Service Library'],
  },
  today: {
    description: 'This is where your day starts after setup.',
    eyebrow: 'Your day at a glance',
    items: ['Upcoming appointments', 'Today’s schedule', 'Revenue', 'Follow-ups', 'Needs attention'],
  },
  website: {
    description: 'Preview, edit and share the website and Booking Page you just created.',
    eyebrow: 'Website & Booking Page preview',
    items: ['Preview website', 'Edit website', 'Share booking link', 'Booking Page'],
  },
};

const planLabel = (intent: PlanIntent | null): string => {
  if (intent === 'free') return 'Continuing free';
  if (intent === 'monthly') return 'Monthly plan saved';
  if (intent === 'founding') return 'Founding offer saved';
  return 'Plan choice saved';
};

type DashboardServiceSummary = {
  durationLabel: string;
  id: string;
  name: string;
  priceLabel: string;
};

function DashboardTourMiniature({
  businessName,
  destination,
  services,
}: {
  businessName: string;
  destination: DashboardTourStep['destination'];
  services: readonly DashboardServiceSummary[];
}) {
  if (destination === 'today') {
    return (
      <div aria-hidden="true" className="lab-dashboard-tour__miniature is-today">
        <strong>Today</strong>
        <span>Today’s schedule</span>
        <span>Follow-ups</span>
        <span>Needs attention</span>
      </div>
    );
  }
  if (destination === 'calendar') {
    return (
      <div aria-hidden="true" className="lab-dashboard-tour__miniature is-calendar">
        <strong>Calendar</strong>
        <div><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span></div>
        <i /><i /><i />
      </div>
    );
  }
  if (destination === 'clients') {
    return (
      <div aria-hidden="true" className="lab-dashboard-tour__miniature is-clients">
        <strong>Clients</strong>
        <span>Client list</span>
        <span>Visit history</span>
        <span>Follow-ups</span>
      </div>
    );
  }
  if (destination === 'services') {
    return (
      <div aria-hidden="true" className="lab-dashboard-tour__miniature is-services">
        <strong>{services.length} selected {services.length === 1 ? 'service' : 'services'}</strong>
        {services.slice(0, 3).map((service) => (
          <span key={service.id}>{service.name}<small>{service.durationLabel} · {service.priceLabel}</small></span>
        ))}
        {services.length === 0 ? <span>Choose services from the Service Library</span> : null}
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="lab-dashboard-tour__miniature is-website">
      <strong>{businessName}</strong>
      <span>Preview website</span>
      <span>Edit website</span>
      <span>Share booking link</span>
    </div>
  );
}

function DashboardTour({
  businessName,
  onClose,
  onComplete,
  onDestinationChange,
  open,
  services,
}: {
  businessName: string;
  onClose: () => void;
  onComplete: () => void;
  onDestinationChange: (destination: DashboardDestination) => void;
  open: boolean;
  services: readonly DashboardServiceSummary[];
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
      description="A short optional tour of the owner workspace destinations."
      initialFocusSelector="[data-dashboard-tour-heading]"
      onClose={onClose}
      open={open}
      title="Welcome to your Luster workspace"
    >
      <div className="lab-dashboard-tour">
        <p aria-label={`Tour step ${index + 1} of ${steps.length}`}>{index + 1} of {steps.length}</p>
        <section aria-live="polite" className="lab-dashboard-tour__moment">
          <span>{DESTINATION_LABELS[step.destination]}</span>
          <h3 data-dashboard-tour-heading tabIndex={-1}>{step.title}</h3>
          <p>{step.description}</p>
          <DashboardTourMiniature
            businessName={businessName}
            destination={step.destination}
            services={services}
          />
        </section>
        <footer className="lab-dashboard-tour__actions">
          <button type="button" onClick={onClose}>Skip tour</button>
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
            <button className="is-primary" type="button" onClick={onComplete}>Go to dashboard</button>
          )}
        </footer>
      </div>
    </Dialog>
  );
}

export function DashboardPreviewSurface({
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
  const storyboardHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusDashboardAfterTourRef = useRef(!tourCompleted);
  const focusTodayAfterTourRef = useRef(false);
  const hasFocusedDashboardRef = useRef(false);
  const [destination, setDestination] = useState<DashboardDestination>(
    LAB_DASHBOARD_HANDOFF_PORT.getInitialDestination,
  );
  const [tourOpen, setTourOpen] = useState(!tourCompleted);
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

  useEffect(() => {
    if (tourOpen || (!focusDashboardAfterTourRef.current && hasFocusedDashboardRef.current)) {
      return undefined;
    }
    const focusFrame = window.requestAnimationFrame(() => {
      if (focusTodayAfterTourRef.current) {
        storyboardHeadingRef.current?.focus({ preventScroll: true });
        focusTodayAfterTourRef.current = false;
      } else {
        headingRef.current?.focus({ preventScroll: true });
      }
      focusDashboardAfterTourRef.current = false;
      hasFocusedDashboardRef.current = true;
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [tourOpen]);

  const completeTour = () => {
    focusDashboardAfterTourRef.current = true;
    focusTodayAfterTourRef.current = true;
    onTourCompletedChange(true);
    setTourOpen(false);
    setDestination('today');
  };

  const businessName = profile.businessName.trim() || 'Your nail business';
  const goToDashboard = useCallback(() => {
    setDestination('today');
    window.requestAnimationFrame(() => {
      storyboardHeadingRef.current?.focus({ preventScroll: true });
    });
  }, []);
  return (
    <main className={`lab-dashboard-preview${reducedMotion ? ' is-reduced-motion' : ''}`}>
      <header className="lab-dashboard-preview__topbar">
        <div>
          <span>L</span>
          <strong>Luster</strong>
        </div>
        <p>Dashboard preview · UX Lab · Changes stay on this device</p>
        <button type="button" onClick={() => {
          focusDashboardAfterTourRef.current = false;
          setTourOpen(true);
        }}>
          <HelpCircle aria-hidden="true" size={17} /> Replay tour
        </button>
      </header>

      <section className="lab-dashboard-preview__welcome">
        <p>{planLabel(planIntent)}</p>
        <h1 ref={headingRef} tabIndex={-1}>Welcome to Luster, {profile.ownerName.trim() || businessName}</h1>
        <p>Your website is saved. This preview shows where your day, clients, services, and website will live.</p>
        <div className="lab-dashboard-preview__handoff-actions">
          <button className="is-primary" type="button" onClick={goToDashboard}>Go to dashboard</button>
          <button type="button" onClick={onEditWebsite}>Edit website</button>
          <button type="button" onClick={onReturnToReview}>Return to onboarding review · Lab only</button>
        </div>
      </section>

      <nav aria-label="Dashboard preview destinations" className="lab-dashboard-preview__nav">
        {(Object.keys(DESTINATION_LABELS) as DashboardDestination[]).map((id) => {
          const Icon = DESTINATION_ICONS[id];
          return (
            <button aria-current={destination === id ? 'page' : undefined} key={id} type="button" onClick={() => setDestination(id)}>
              <Icon aria-hidden="true" size={18} /> {DESTINATION_LABELS[id]}
            </button>
          );
        })}
      </nav>

      <div className="lab-dashboard-preview__grid">
        <section aria-labelledby="dashboard-storyboard-heading" className="lab-dashboard-storyboard">
          <p>{storyboard.eyebrow}</p>
          <h2 id="dashboard-storyboard-heading" ref={storyboardHeadingRef} tabIndex={-1}>
            {destination === 'today' ? `Today at ${businessName}` : DESTINATION_LABELS[destination]}
          </h2>
          <p>{storyboard.description}</p>
          <div className={`lab-dashboard-storyboard__visual is-${destination}`} aria-label={`${DESTINATION_LABELS[destination]} visual preview`}>
            {destination === 'services' ? (
              <article className="lab-dashboard-storyboard__service-summary">
                <span aria-hidden="true">{selectedServices.length}</span>
                <strong>{selectedServices.length} selected {selectedServices.length === 1 ? 'service' : 'services'}</strong>
                <small>From the same Service Library selection used by the Booking preview</small>
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
                <small>Available in your Luster workspace</small>
              </article>
            ))}
          </div>
          {destination === 'website' ? (
            <button className="lab-dashboard-storyboard__edit" type="button" onClick={onEditWebsite}>
              Edit website <ExternalLink aria-hidden="true" size={16} />
            </button>
          ) : null}
        </section>

        <aside aria-labelledby="setup-checklist-heading" className="lab-dashboard-checklist">
          <p>Keep going when you’re ready</p>
          <h2 id="setup-checklist-heading">Finish setting up Luster</h2>
          <ul>
            {checklist.map((item) => {
              const complete = item.status === 'complete' || item.status === 'connected';
              const statusLabel = item.status === 'complete'
                ? 'Ready'
                : item.status === 'connected'
                  ? 'Connected'
                  : item.status === 'needs_attention'
                    ? 'Needs attention'
                    : 'Not connected';
              return (
                <li key={item.id}>
                  {complete ? <Check aria-hidden="true" size={18} /> : <CircleAlert aria-hidden="true" size={18} />}
                  <button type="button" onClick={() => setDestination(item.destination)}>
                    <strong>{item.label}</strong>
                    <span>{statusLabel}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <small>Connection items use explicit UX Lab states. No Google Calendar or payment account was changed.</small>
        </aside>
      </div>

      <DashboardTour
        businessName={businessName}
        onClose={() => {
          onTourCompletedChange(true);
          setTourOpen(false);
        }}
        onComplete={completeTour}
        onDestinationChange={setDestination}
        open={tourOpen}
        services={selectedServices}
      />
    </main>
  );
}

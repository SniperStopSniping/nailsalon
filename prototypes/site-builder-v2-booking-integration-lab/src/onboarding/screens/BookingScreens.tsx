import {
  Check,
  ChevronDown,
  Info,
  LockKeyhole,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { Dialog } from '../../ui/Dialog';
import { StarterChoiceGrid, useMediaQuery } from '../../ui/StarterChooser';
import {
  ChoiceGroup,
  type ChoiceOption,
  focusFirstInvalidControl,
  TextField,
  ValidationSummary,
} from '../components/FormFields';
import { StickyOnboardingActions } from '../components/StickyOnboardingActions';
import { SCREEN_METADATA, STARTER_ENTRY_COPY } from '../copy';
import { useFeedback } from '../feedback/useFeedback';
import { bookingPreferencesPort } from '../integrations/adapters/booking-preferences';
import { serviceMenuPort } from '../integrations/adapters/service-menu';
import type {
  DepositAmountChoice,
  DepositDraft,
  DepositMode,
  MinimumNoticeChoice,
  MinimumNoticeUnit,
} from '../integrations/contracts/booking-preferences';
import type {
  ServiceMenuItem,
  ServiceMenuSelectionDraft,
} from '../integrations/contracts/service-menu';
import { normalizeSiteSlug, siteUrlForSlug } from '../model/business-identity';
import { getPublicLocationPreview } from '../model/location';
import {
  formatMinimumNoticeDuration,
  getMinimumNoticeCopy,
} from '../model/minimum-notice';
import { getDepositPolicyMode } from '../model/policies';
import type {
  BookingPreferencesDraft,
  BusinessProfileDraft,
  LocationDraft,
  NewClientStatus,
  StarterId,
  VisitMode,
} from '../model/types';

const VISIT_MODES: readonly ChoiceOption<VisitMode>[] = [
  { label: 'Appointment only', value: 'appointment_only' },
  { label: 'Walk-ins only', value: 'walk_ins_only' },
  { label: 'Appointments and walk-ins', value: 'appointments_and_walk_ins' },
];

const NEW_CLIENT_STATUSES: readonly ChoiceOption<NewClientStatus>[] = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: 'Ask me first', value: 'ask_first' },
  { label: 'Waitlist only', value: 'waitlist_only' },
];

const DEPOSIT_MODE_OPTIONS: readonly ChoiceOption<DepositMode>[] = [
  { label: 'No deposit', value: 'none' },
  { label: 'Same deposit for every service', value: 'fixed' },
];

const MINIMUM_NOTICE_LABELS: Record<MinimumNoticeChoice, string> = {
  'preset:0': 'No minimum notice',
  'preset:120': '2 hours',
  'preset:240': '4 hours',
  'preset:480': '8 hours',
  'preset:720': '12 hours',
  'preset:1440': '1 day',
  'preset:2880': '2 days',
  'preset:4320': '3 days',
  'custom': 'Custom',
};

const minimumNoticeOptions = Object.entries(MINIMUM_NOTICE_LABELS) as Array<[
  MinimumNoticeChoice,
  string,
]>;

const DEPOSIT_AMOUNT_LABELS = Object.fromEntries([
  ...bookingPreferencesPort.depositAmountPresets.map(amountCents => [
    `preset:${amountCents}`,
    `$${amountCents / 100}`,
  ]),
  ['custom', 'Custom amount'],
]) as Record<DepositAmountChoice, string>;

type ServiceLibraryDialogProps = {
  initialTab: 'services' | 'add_ons';
  onClose: () => void;
  onDone: () => void;
  onServiceMenuChange: (draft: ServiceMenuSelectionDraft) => void;
  open: boolean;
  serviceMenu: ServiceMenuSelectionDraft;
};

function ServiceLibraryDialog({
  initialTab,
  onClose,
  onDone,
  onServiceMenuChange,
  open,
  serviceMenu,
}: ServiceLibraryDialogProps) {
  const feedback = useFeedback();
  const [activeTab, setActiveTab] = useState<'services' | 'add_ons'>(initialTab);
  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const categoryScrollerRef = useRef<HTMLDivElement>(null);
  const activeCategoryRef = useRef<HTMLButtonElement>(null);
  const resultsListRef = useRef<HTMLUListElement>(null);
  const [categoryOverflow, setCategoryOverflow] = useState({ left: false, right: false });
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const selectedIds = new Set(
    serviceMenuPort.normalizeSelection(serviceMenu).selectedServiceIds,
  );
  const selectedAddOnIds = new Set(
    serviceMenuPort.normalizeSelection(serviceMenu).selectedAddOnIds ?? [],
  );
  const allItems = activeTab === 'services'
    ? serviceMenuPort.getLibraryServices().filter(({ categoryId }) => categoryId !== 'add_ons')
    : serviceMenuPort.getLibraryAddOns();
  const libraryItems = allItems.filter(item => (
    (activeCategoryId === 'all' || item.categoryId === activeCategoryId)
    && (!normalizedSearch || item.name.toLocaleLowerCase().includes(normalizedSearch))
  ));
  const serviceCategories = serviceMenuPort.getCategories().filter(({ id }) => id !== 'add_ons');
  const addOnCategories = Array.from(new Map(
    serviceMenuPort.getLibraryAddOns().map(({ categoryId, categoryLabel }) => [
      categoryId,
      { id: categoryId, label: categoryLabel },
    ]),
  ).values());
  const selectedServiceCount = selectedIds.size;
  const selectedAddOnCount = selectedAddOnIds.size;

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveTab(initialTab);
    setActiveCategoryId('all');
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const scroller = categoryScrollerRef.current;
    if (!scroller) {
      return undefined;
    }
    const updateOverflow = () => {
      const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      setCategoryOverflow({
        left: scroller.scrollLeft > 1,
        right: scroller.scrollLeft < maximum - 1,
      });
    };
    const revealSelected = () => {
      activeCategoryRef.current?.scrollIntoView?.({
        behavior: 'auto',
        block: 'nearest',
        inline: 'nearest',
      });
      updateOverflow();
    };
    revealSelected();
    const frame = window.requestAnimationFrame(revealSelected);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(revealSelected);
    observer?.observe(scroller);
    window.addEventListener('resize', revealSelected);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', revealSelected);
    };
  }, [activeCategoryId, activeTab, open]);

  useEffect(() => {
    if (!open || !resultsListRef.current) {
      return;
    }
    resultsListRef.current.scrollTop = 0;
  }, [activeCategoryId, activeTab, normalizedSearch, open]);

  return (
    <Dialog
      description="Remove anything you don’t offer or add services from the library. You can change prices and durations later."
      onClose={onClose}
      open={open}
      title="Choose your services"
      variant="section-library"
    >
      <div className="onboarding-service-library">
        <label className="onboarding-service-library__search">
          <span className="visually-hidden">Search services</span>
          <Search aria-hidden="true" size={18} />
          <input
            placeholder="Search services"
            type="search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />
        </label>
        <div
          aria-label="Service library type"
          className="onboarding-service-library__tabs"
          role="tablist"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
              return;
            }
            event.preventDefault();
            const nextTab = event.key === 'ArrowLeft' || event.key === 'Home'
              ? 'services'
              : 'add_ons';
            const tabList = event.currentTarget;
            setActiveTab(nextTab);
            setActiveCategoryId('all');
            window.requestAnimationFrame(() => {
              tabList.querySelector<HTMLElement>(`[data-library-tab="${nextTab}"]`)?.focus();
            });
          }}
        >
          <button
            aria-controls="onboarding-service-library-results"
            aria-selected={activeTab === 'services'}
            data-library-tab="services"
            id="onboarding-service-library-tab-services"
            role="tab"
            tabIndex={activeTab === 'services' ? 0 : -1}
            type="button"
            onClick={() => {
              setActiveTab('services');
              setActiveCategoryId('all');
            }}
          >
            Services
          </button>
          <button
            aria-controls="onboarding-service-library-results"
            aria-selected={activeTab === 'add_ons'}
            data-library-tab="add_ons"
            id="onboarding-service-library-tab-add-ons"
            role="tab"
            tabIndex={activeTab === 'add_ons' ? 0 : -1}
            type="button"
            onClick={() => {
              setActiveTab('add_ons');
              setActiveCategoryId('all');
            }}
          >
            Add-ons
          </button>
        </div>
        <div
          className={`onboarding-service-library__category-rail${categoryOverflow.left ? ' has-left-overflow' : ''}${categoryOverflow.right ? ' has-right-overflow' : ''}`}
        >
          <div
            ref={categoryScrollerRef}
            aria-label={`${activeTab === 'services' ? 'Service' : 'Add-on'} categories`}
            className="onboarding-service-library__chips"
            onScroll={(event) => {
              const scroller = event.currentTarget;
              const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
              setCategoryOverflow({
                left: scroller.scrollLeft > 1,
                right: scroller.scrollLeft < maximum - 1,
              });
            }}
          >
            <button
              ref={activeCategoryId === 'all' ? activeCategoryRef : undefined}
              aria-pressed={activeCategoryId === 'all'}
              type="button"
              onClick={() => setActiveCategoryId('all')}
            >
              {activeTab === 'services' ? 'All' : 'All add-ons'}
            </button>
            {(activeTab === 'services' ? serviceCategories : addOnCategories).map(({ id, label }) => (
              <button
                ref={activeCategoryId === id ? activeCategoryRef : undefined}
                aria-pressed={activeCategoryId === id}
                key={id}
                type="button"
                onClick={() => setActiveCategoryId(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ul
          ref={resultsListRef}
          aria-label={activeTab === 'services' ? 'Library services' : 'Library add-ons'}
          aria-labelledby={activeTab === 'services'
            ? 'onboarding-service-library-tab-services'
            : 'onboarding-service-library-tab-add-ons'}
          className="onboarding-service-library__list"
          id="onboarding-service-library-results"
          role="tabpanel"
        >
          {libraryItems.map((item) => {
            const selected = item.itemKind === 'service'
              ? selectedIds.has(item.id)
              : selectedAddOnIds.has(item.id);
            return (
              <li className={selected ? 'is-selected' : undefined} key={item.id}>
                {item.imageSrc
                  ? (
                      <img alt={item.imageAlt ?? ''} src={item.imageSrc} />
                    )
                  : (
                      <span aria-hidden="true" className="onboarding-service-library__icon">
                        <Sparkles size={20} strokeWidth={1.8} />
                      </span>
                    )}
                <span className="onboarding-service-library__item-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.categoryLabel}
                    {' '}
                    ·
                    {' '}
                    {item.durationLabel}
                  </small>
                  <b>{item.priceLabel}</b>
                </span>
                <button
                  aria-label={`${selected ? 'Remove' : 'Add'} ${item.name}`}
                  aria-pressed={selected}
                  type="button"
                  onClick={() => {
                    onServiceMenuChange(
                      item.itemKind === 'service'
                        ? serviceMenuPort.setServiceSelected(serviceMenu, item.id, !selected)
                        : serviceMenuPort.setAddOnSelected(serviceMenu, item.id, !selected),
                    );
                    feedback.send({
                      kind: selected ? 'removed' : 'added',
                      message: `${item.name} ${selected ? 'removed.' : 'added.'}`,
                      targetId: item.id,
                    });
                  }}
                >
                  {selected ? <Check aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
                  {selected ? 'Added' : 'Add'}
                </button>
              </li>
            );
          })}
        </ul>
        {libraryItems.length === 0
          ? (
              <p className="onboarding-service-library__empty">
                {'No matching '}
                {activeTab === 'services' ? 'services' : 'add-ons'}
                .
              </p>
            )
          : null}
        {activeTab === 'add_ons'
          ? (
              <aside className="onboarding-service-library__tip" aria-label="Add-ons are optional">
                <Info aria-hidden="true" size={18} />
                <div>
                  <strong>ADD-ONS ARE OPTIONAL</strong>
                  <p>Add-ons help clients customize their service, but you can skip them for now and add them anytime from your dashboard.</p>
                </div>
              </aside>
            )
          : null}
        <footer className="onboarding-service-library__footer">
          <span>
            <strong>
              {selectedServiceCount}
              {' '}
              {selectedServiceCount === 1 ? 'service' : 'services'}
              {' '}
              selected
            </strong>
            {selectedAddOnCount > 0
              ? (
                  <small>
                    {selectedAddOnCount}
                    {' '}
                    add-on
                    {selectedAddOnCount === 1 ? '' : 's'}
                    {' '}
                    added
                  </small>
                )
              : null}
          </span>
          <button disabled={selectedServiceCount === 0} type="button" onClick={onDone}>Done</button>
        </footer>
        {selectedServiceCount === 0
          ? <p className="onboarding-field-error" role="alert">Choose at least one service.</p>
          : null}
      </div>
    </Dialog>
  );
}

type BookingPreferencesScreenProps = {
  onBack: () => void;
  onBookingPreferencesChange: (patch: Partial<BookingPreferencesDraft>) => void;
  onContinue: () => void;
  onDepositChange: (deposit: DepositDraft) => void;
  onServiceMenuChange: (draft: ServiceMenuSelectionDraft) => void;
  onValidationFailure?: (fieldIds: string[]) => void;
  previewTimestamp?: string;
  profile: BusinessProfileDraft;
};

type BookingTaskId = 'services' | 'clients' | 'notice' | 'deposits';

type BookingTaskCardProps = {
  children: ReactNode;
  celebrating?: boolean;
  complete: boolean;
  description: string;
  id: BookingTaskId;
  number: number;
  onToggle: () => void;
  open: boolean;
  summary: string;
  title: string;
};

function BookingTaskCard({
  children,
  celebrating = false,
  complete,
  description,
  id,
  number,
  onToggle,
  open,
  summary,
  title,
}: BookingTaskCardProps) {
  const contentId = `booking-task-${id}`;
  return (
    <section className={`onboarding-booking-task${open ? ' is-open' : ''}${complete ? ' is-complete' : ''}${celebrating ? ' is-celebrating' : ''}`} data-booking-task={id}>
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="onboarding-booking-task__header"
        type="button"
        onClick={onToggle}
      >
        <span className="onboarding-booking-task__number">{complete ? <Check aria-hidden="true" size={15} /> : number}</span>
        <span className="onboarding-booking-task__heading">
          <strong>{title}</strong>
          <small>{open ? description : summary}</small>
        </span>
        {complete
          ? (
              <span className="onboarding-booking-task__complete">
                {'Complete '}
                <Check aria-hidden="true" size={13} />
              </span>
            )
          : null}
        <ChevronDown aria-hidden="true" className="onboarding-booking-task__chevron" size={18} />
      </button>
      {open ? <div className="onboarding-booking-task__content" id={contentId}>{children}</div> : null}
    </section>
  );
}

export function BookingPreferencesScreen({
  onBack,
  onBookingPreferencesChange,
  onContinue,
  onDepositChange,
  onServiceMenuChange,
  onValidationFailure,
  profile,
}: BookingPreferencesScreenProps) {
  const feedback = useFeedback();
  const copy = SCREEN_METADATA.booking_preferences;
  const formId = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceLibraryOpen, setServiceLibraryOpen] = useState(false);
  const [serviceLibraryTab, setServiceLibraryTab] = useState<'services' | 'add_ons'>('services');
  const [openTask, setOpenTask] = useState<BookingTaskId | null>('services');
  const [editingCustomNotice, setEditingCustomNotice] = useState(false);
  const initialCustomNotice = bookingPreferencesPort.getCustomMinimumNoticeInput(
    profile.bookingPreferences.minimumNoticeMinutes,
  );
  const [customNoticeAmount, setCustomNoticeAmount] = useState(initialCustomNotice.amount);
  const [customNoticeUnit, setCustomNoticeUnit] = useState<MinimumNoticeUnit>(
    initialCustomNotice.unit,
  );
  const [editingCustomDeposit, setEditingCustomDeposit] = useState(false);
  const [customDepositAmount, setCustomDepositAmount] = useState(() =>
    profile.policies.deposits.amountCents === null
      ? ''
      : String(profile.policies.deposits.amountCents / 100));
  const celebrationTimersRef = useRef<number[]>([]);
  const [menuCelebrating, setMenuCelebrating] = useState(false);
  const preferences = profile.bookingPreferences;
  const selectedServices = serviceMenuPort.getSelectedServices(profile.serviceMenu);
  const selectedAddOns = serviceMenuPort.getSelectedAddOns(profile.serviceMenu);
  const [celebrationCount, setCelebrationCount] = useState(selectedServices.length);
  const storedNoticeChoice = bookingPreferencesPort.getMinimumNoticeChoice(
    preferences.minimumNoticeMinutes,
  );
  const noticeChoice = editingCustomNotice ? 'custom' : storedNoticeChoice;
  const storedDepositAmountChoice = bookingPreferencesPort.getDepositAmountChoice(
    profile.policies.deposits.amountCents,
  );
  const depositAmountChoice = editingCustomDeposit
    ? 'custom'
    : storedDepositAmountChoice;
  const minimumNoticeCopy = getMinimumNoticeCopy(preferences.minimumNoticeMinutes);
  const servicesComplete = selectedServices.length > 0 && profile.serviceMenu.reviewed === true;
  const clientsComplete = preferences.visitMode !== null && preferences.newClientStatus !== null;
  const noticeComplete = Number.isFinite(preferences.minimumNoticeMinutes)
    && preferences.minimumNoticeMinutes >= 0;
  const depositMode = getDepositPolicyMode(profile.policies);
  const depositComplete = depositMode === 'none'
    || (depositMode === 'fixed'
      && profile.policies.deposits.amountCents !== null
      && profile.policies.deposits.amountCents > 0);
  const allTasksComplete = servicesComplete && clientsComplete && noticeComplete && depositComplete;

  useEffect(() => {
    if (!menuCelebrating) {
      setCelebrationCount(selectedServices.length);
    }
  }, [menuCelebrating, selectedServices.length]);

  useEffect(() => () => {
    celebrationTimersRef.current.forEach(timer => window.clearTimeout(timer));
  }, []);

  const startServiceMenuCelebration = () => {
    celebrationTimersRef.current.forEach(timer => window.clearTimeout(timer));
    celebrationTimersRef.current = [];
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion || selectedServices.length === 0) {
      setCelebrationCount(selectedServices.length);
      setMenuCelebrating(false);
      return;
    }
    setCelebrationCount(0);
    setMenuCelebrating(true);
    const interval = Math.max(48, Math.floor(360 / selectedServices.length));
    for (let count = 1; count <= selectedServices.length; count += 1) {
      celebrationTimersRef.current.push(window.setTimeout(
        () => setCelebrationCount(count),
        interval * count,
      ));
    }
    celebrationTimersRef.current.push(window.setTimeout(
      () => setMenuCelebrating(false),
      Math.min(560, interval * selectedServices.length + 140),
    ));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget;
    const nextErrors: Record<string, string> = {};
    if (selectedServices.length === 0) {
      nextErrors.services = 'Choose at least one service.';
    }
    if (selectedServices.length > 0 && !profile.serviceMenu.reviewed) {
      nextErrors.services = 'Review your services and select Done.';
    }
    if (!preferences.visitMode) {
      nextErrors.visitMode = 'Choose how clients can visit you.';
    }
    if (!preferences.newClientStatus) {
      nextErrors.newClientStatus = 'Choose your new-client status.';
    }
    if (noticeChoice === 'custom'
      && bookingPreferencesPort.normalizeCustomMinimumNotice(
        customNoticeAmount,
        customNoticeUnit,
      ) === null) {
      nextErrors.customNoticeAmount = 'Enter a custom notice amount greater than zero.';
    }
    if (profile.policies.deposits.mode === 'fixed'
      && depositAmountChoice === 'custom'
      && bookingPreferencesPort.normalizeCustomDepositAmount(customDepositAmount) === null) {
      nextErrors.customDepositAmount = 'Enter a custom deposit amount greater than zero.';
    }
    setErrors(nextErrors);
    const failedFields = Object.keys(nextErrors);
    if (failedFields.length > 0) {
      onValidationFailure?.(failedFields);
      const firstFailedTask: BookingTaskId = failedFields.includes('services')
        ? 'services'
        : failedFields.some(field => field === 'visitMode' || field === 'newClientStatus')
          ? 'clients'
          : failedFields.includes('customNoticeAmount')
            ? 'notice'
            : 'deposits';
      setOpenTask(firstFailedTask);
      window.requestAnimationFrame(() => focusFirstInvalidControl(form));
      return;
    }
    onContinue();
  };

  const revealTask = (task: BookingTaskId, { focusHeader = false } = {}) => {
    setOpenTask(task);
    window.requestAnimationFrame(() => {
      const taskElement = document.querySelector<HTMLElement>(`[data-booking-task="${task}"]`);
      taskElement?.scrollIntoView?.({
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
      if (focusHeader) {
        taskElement?.querySelector<HTMLButtonElement>('.onboarding-booking-task__header')
          ?.focus({ preventScroll: true });
      }
    });
  };

  const openServiceLibrary = (tab: 'services' | 'add_ons') => {
    setServiceLibraryTab(tab);
    setServiceLibraryOpen(true);
  };

  const finishServiceMenu = () => {
    if (selectedServices.length === 0) {
      return;
    }
    onServiceMenuChange({ ...profile.serviceMenu, reviewed: true });
    if (!profile.serviceMenu.reviewed) {
      startServiceMenuCelebration();
      feedback.send({
        kind: 'milestone',
        message: `Your service menu is ready. ${selectedServices.length} ${selectedServices.length === 1 ? 'service' : 'services'} added.`,
        onceKey: 'service_menu_ready',
        visual: false,
      });
    }
    setErrors(current => ({ ...current, services: '' }));
    setServiceLibraryOpen(false);
    revealTask('clients', { focusHeader: true });
  };

  const finishLastTask = () => {
    celebrationTimersRef.current.push(window.setTimeout(() => {
      setOpenTask(null);
    }, 450));
  };

  const visitModeLabel = VISIT_MODES.find(({ value }) => value === preferences.visitMode)?.label;
  const acceptingLabel = preferences.newClientStatus === 'yes'
    ? 'Accepting new clients'
    : preferences.newClientStatus === 'waitlist_only'
      ? 'Waitlist only'
      : preferences.newClientStatus === 'ask_first'
        ? 'New clients by request'
        : preferences.newClientStatus === 'no'
          ? 'Not accepting new clients'
          : null;
  const servicesSummary = `${selectedServices.length} ${selectedServices.length === 1 ? 'service' : 'services'} · ${selectedAddOns.length} add-on${selectedAddOns.length === 1 ? '' : 's'}`;
  const clientsSummary = visitModeLabel && acceptingLabel
    ? `${visitModeLabel} · ${acceptingLabel}`
    : 'Finish your client settings';
  const depositSummary = depositMode === 'fixed' && profile.policies.deposits.amountCents !== null
    ? `$${profile.policies.deposits.amountCents / 100} for every service`
    : depositMode === 'fixed'
      ? 'Finish your deposit amount'
      : 'No deposit';

  return (
    <section aria-labelledby="booking-preferences-heading" className="onboarding-screen onboarding-booking-preferences-screen">
      <header className="onboarding-screen__heading">
        <p className="onboarding-screen-status">Step 7 — Services &amp; booking</p>
        <h1 id="booking-preferences-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <form className="onboarding-booking-tasks" id={formId} noValidate onSubmit={submit}>
        <ValidationSummary errors={errors} />
        <BookingTaskCard
          celebrating={menuCelebrating}
          complete={servicesComplete}
          description="Choose what clients can book."
          id="services"
          number={1}
          open={openTask === 'services'}
          summary={servicesComplete ? servicesSummary : 'Choose what clients can book'}
          title="Services"
          onToggle={() => setOpenTask(current => current === 'services' ? null : 'services')}
        >
          <aside className="onboarding-booking-guidance is-services">
            <Sparkles aria-hidden="true" size={18} />
            <div>
              <strong>YOUR STARTER MENU IS READY</strong>
              <p>We added popular services to get you started. You don’t need to finish your full menu now — choose what you want to start with and update everything later from your dashboard.</p>
            </div>
          </aside>
          <p aria-live="polite" className="onboarding-service-menu-count">
            <strong>
              <span aria-hidden={menuCelebrating || undefined}>{celebrationCount}</span>
              {menuCelebrating ? <span className="visually-hidden">{selectedServices.length}</span> : null}
              {' '}
              {selectedServices.length === 1 ? 'service selected' : 'services selected'}
            </strong>
            <span>
              {' · '}
              {selectedAddOns.length}
              {' '}
              {selectedAddOns.length === 1 ? 'add-on' : 'add-ons'}
              {' '}
              ready
            </span>
          </p>
          {selectedServices.length > 0
            ? (
                <ul className="onboarding-service-menu-sample" aria-label="Selected services">
                  {selectedServices.slice(0, 3).map((service: ServiceMenuItem) => (
                    <li key={service.id}>
                      {service.imageSrc ? <img alt={service.imageAlt ?? ''} src={service.imageSrc} /> : <span aria-hidden="true" className="onboarding-service-menu-sample__icon">LN</span>}
                      <span className="onboarding-service-menu-sample__copy">
                        <strong>{service.name}</strong>
                        <small>
                          {service.categoryLabel}
                          {' '}
                          ·
                          {' '}
                          {service.durationLabel}
                        </small>
                      </span>
                      <b>{service.priceLabel}</b>
                    </li>
                  ))}
                </ul>
              )
            : <p>No services selected yet.</p>}
          {selectedServices.length > 3
            ? (
                <button className="onboarding-service-menu-card__more" type="button" onClick={() => openServiceLibrary('services')}>
                  +
                  {' '}
                  {selectedServices.length - 3}
                  {' '}
                  more
                  {' '}
                  {selectedServices.length - 3 === 1 ? 'service' : 'services'}
                </button>
              )
            : null}
          <button className="onboarding-booking-addons-summary" type="button" onClick={() => openServiceLibrary('add_ons')}>
            <span>
              <strong>Add-ons · Optional</strong>
              <Info aria-hidden="true" size={15} />
            </span>
            <span>
              {selectedAddOns.length}
              {' '}
              add-on
              {selectedAddOns.length === 1 ? '' : 's'}
              {' '}
              <ChevronDown aria-hidden="true" size={16} />
            </span>
          </button>
          <div className="onboarding-inline-actions">
            <button type="button" onClick={() => openServiceLibrary('services')}>
              Review services &amp; add-ons
            </button>
          </div>
          <p className="onboarding-booking-later-note">
            <LockKeyhole aria-hidden="true" size={13} />
            {' '}
            You can change prices, durations, photos, options and add-ons later.
          </p>
          {errors.services ? <p className="onboarding-field-error" role="alert">{errors.services}</p> : null}
        </BookingTaskCard>

        <BookingTaskCard
          complete={clientsComplete}
          description="Choose how you currently accept clients."
          id="clients"
          number={2}
          open={openTask === 'clients'}
          summary={clientsSummary}
          title="Clients"
          onToggle={() => setOpenTask(current => current === 'clients' ? null : 'clients')}
        >
          <ChoiceGroup
            error={errors.visitMode}
            legend="How do you accept clients?"
            name="visit-mode"
            options={VISIT_MODES}
            value={preferences.visitMode}
            onChange={(visitMode) => {
              setErrors(current => ({ ...current, visitMode: '' }));
              onBookingPreferencesChange({ visitMode });
              if (preferences.newClientStatus) {
                revealTask('notice');
              }
            }}
          />
          <ChoiceGroup
            error={errors.newClientStatus}
            legend="Are you accepting new clients?"
            name="new-client-status"
            options={NEW_CLIENT_STATUSES}
            value={preferences.newClientStatus}
            onChange={(newClientStatus) => {
              setErrors(current => ({ ...current, newClientStatus: '' }));
              onBookingPreferencesChange({ newClientStatus });
              if (preferences.visitMode) {
                revealTask('notice');
              }
            }}
          />
        </BookingTaskCard>

        <BookingTaskCard
          complete={noticeComplete}
          description="Choose how far ahead clients need to book."
          id="notice"
          number={3}
          open={openTask === 'notice'}
          summary={formatMinimumNoticeDuration(preferences.minimumNoticeMinutes)}
          title="Booking notice"
          onToggle={() => setOpenTask(current => current === 'notice' ? null : 'notice')}
        >
          <label className="onboarding-select-field">
            <span id={`${formId}-minimum-notice-label`}>How much notice do you need before an appointment?</span>
            <select
              aria-describedby={`${formId}-minimum-notice-hint`}
              aria-labelledby={`${formId}-minimum-notice-label`}
              value={noticeChoice}
              onChange={(event) => {
                const choice = event.target.value as MinimumNoticeChoice;
                if (choice === 'custom') {
                  setEditingCustomNotice(true);
                  setErrors(current => ({ ...current, customNoticeAmount: '' }));
                  return;
                }
                setEditingCustomNotice(false);
                setErrors(current => ({ ...current, customNoticeAmount: '' }));
                onBookingPreferencesChange({ minimumNoticeMinutes: Number(choice.replace('preset:', '')) });
                revealTask('deposits');
              }}
            >
              {minimumNoticeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <small className="onboarding-field__hint" id={`${formId}-minimum-notice-hint`}>
              {preferences.minimumNoticeMinutes === 0
                ? 'Clients can book any available appointment without a minimum advance notice.'
                : minimumNoticeCopy.helper}
            </small>
          </label>
          {noticeChoice === 'custom'
            ? (
                <div className="onboarding-inline-fields">
                  <TextField
                    error={errors.customNoticeAmount}
                    inputMode="decimal"
                    label="Amount"
                    min="0"
                    type="number"
                    value={customNoticeAmount}
                    onChange={(event) => {
                      const amount = event.target.value;
                      setCustomNoticeAmount(amount);
                      const minimumNoticeMinutes = bookingPreferencesPort.normalizeCustomMinimumNotice(amount, customNoticeUnit);
                      setErrors(current => ({ ...current, customNoticeAmount: minimumNoticeMinutes === null ? current.customNoticeAmount ?? '' : '' }));
                      if (minimumNoticeMinutes !== null) {
                        onBookingPreferencesChange({ minimumNoticeMinutes });
                      }
                    }}
                  />
                  <label className="onboarding-select-field">
                    <span>Unit</span>
                    <select
                      value={customNoticeUnit}
                      onChange={(event) => {
                        const unit = event.target.value as MinimumNoticeUnit;
                        setCustomNoticeUnit(unit);
                        const minimumNoticeMinutes = bookingPreferencesPort.normalizeCustomMinimumNotice(customNoticeAmount, unit);
                        if (minimumNoticeMinutes !== null) {
                          setErrors(current => ({ ...current, customNoticeAmount: '' }));
                          onBookingPreferencesChange({ minimumNoticeMinutes });
                        }
                      }}
                    >
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </label>
                </div>
              )
            : null}
        </BookingTaskCard>

        <BookingTaskCard
          complete={depositComplete}
          description="Choose whether clients pay something when they book."
          id="deposits"
          number={4}
          open={openTask === 'deposits'}
          summary={depositSummary}
          title="Deposits"
          onToggle={() => setOpenTask(current => current === 'deposits' ? null : 'deposits')}
        >
          <ChoiceGroup
            legend="How do you handle booking deposits?"
            name="deposit-policy-mode"
            options={DEPOSIT_MODE_OPTIONS}
            value={depositMode}
            onChange={(mode) => {
              setErrors(current => ({ ...current, customDepositAmount: '' }));
              onDepositChange(bookingPreferencesPort.updateDepositDraft(profile.policies.deposits, {
                amountCents: mode === 'fixed' ? profile.policies.deposits.amountCents : null,
                mode,
              }));
              if (mode === 'none') {
                finishLastTask();
              }
            }}
          />
          {profile.policies.deposits.mode === 'fixed'
            ? (
                <>
                  <fieldset className="onboarding-choice-group onboarding-deposit-amounts">
                    <legend>Deposit amount</legend>
                    <div className="onboarding-choice-group__options">
                      {(Object.entries(DEPOSIT_AMOUNT_LABELS) as Array<[DepositAmountChoice, string]>).map(([value, label]) => (
                        <label className="onboarding-choice" key={value}>
                          <input
                            checked={depositAmountChoice === value}
                            name="deposit-amount"
                            type="radio"
                            value={value}
                            onChange={() => {
                              if (value === 'custom') {
                                setEditingCustomDeposit(true);
                                setErrors(current => ({ ...current, customDepositAmount: '' }));
                                return;
                              }
                              setEditingCustomDeposit(false);
                              setErrors(current => ({ ...current, customDepositAmount: '' }));
                              onDepositChange(bookingPreferencesPort.updateDepositDraft(profile.policies.deposits, { amountCents: Number(value.replace('preset:', '')) }));
                              finishLastTask();
                            }}
                          />
                          <span><strong>{label === 'Custom amount' ? 'Custom' : label}</strong></span>
                        </label>
                      ))}
                    </div>
                    {depositAmountChoice === 'custom'
                      ? (
                          <TextField
                            error={errors.customDepositAmount}
                            inputMode="decimal"
                            label="Custom deposit amount"
                            min="0"
                            step="0.01"
                            type="number"
                            value={customDepositAmount}
                            onChange={(event) => {
                              const amount = event.target.value;
                              setCustomDepositAmount(amount);
                              const amountCents = bookingPreferencesPort.normalizeCustomDepositAmount(amount);
                              setErrors(current => ({ ...current, customDepositAmount: amountCents === null ? current.customDepositAmount ?? '' : '' }));
                              if (amountCents !== null) {
                                onDepositChange(bookingPreferencesPort.updateDepositDraft(profile.policies.deposits, { amountCents }));
                              }
                            }}
                          />
                        )
                      : null}
                  </fieldset>
                  {profile.policies.deposits.amountCents
                    ? (
                        <p className="onboarding-booking-confirmation">
                          <Check aria-hidden="true" size={15} />
                          {' '}
                          Clients will pay a $
                          {profile.policies.deposits.amountCents / 100}
                          {' '}
                          deposit when booking.
                        </p>
                      )
                    : null}
                  <aside className="onboarding-booking-guidance is-payments">
                    <Info aria-hidden="true" size={18} />
                    <div>
                      <strong>PAYMENTS LATER</strong>
                      <p>You’ll connect payments after setup. We’ll guide you through it before you start collecting deposits.</p>
                    </div>
                  </aside>
                </>
              )
            : (
                <p className="onboarding-booking-confirmation">
                  <Check aria-hidden="true" size={15} />
                  {' '}
                  Clients book without paying a deposit.
                </p>
              )}
        </BookingTaskCard>

        {allTasksComplete
          ? (
              <section className="onboarding-booking-ready" aria-labelledby="booking-ready-heading">
                <h2 id="booking-ready-heading">
                  <Check aria-hidden="true" size={19} />
                  {' '}
                  Your booking setup is ready
                </h2>
                <dl>
                  <div>
                    <dt>Clients</dt>
                    <dd>{clientsSummary}</dd>
                    <Check aria-hidden="true" size={15} />
                  </div>
                  <div>
                    <dt>Services</dt>
                    <dd>{servicesSummary}</dd>
                    <Check aria-hidden="true" size={15} />
                  </div>
                  <div>
                    <dt>Booking notice</dt>
                    <dd>{formatMinimumNoticeDuration(preferences.minimumNoticeMinutes)}</dd>
                    <Check aria-hidden="true" size={15} />
                  </div>
                  <div>
                    <dt>Deposits</dt>
                    <dd>{depositSummary}</dd>
                    <Check aria-hidden="true" size={15} />
                  </div>
                </dl>
              </section>
            )
          : null}
      </form>
      <footer aria-label="Onboarding actions" className="sticky-onboarding-actions onboarding-booking-actions is-primary-first">
        <button className="sticky-onboarding-actions__back" type="button" onClick={onBack}>Back</button>
        <button className="sticky-onboarding-actions__primary" form={formId} type="submit">Save and continue</button>
        <p className="onboarding-booking-dashboard-note">
          <LockKeyhole aria-hidden="true" size={13} />
          {' '}
          You can change any of this later in your dashboard.
        </p>
      </footer>
      <ServiceLibraryDialog
        initialTab={serviceLibraryTab}
        onClose={() => setServiceLibraryOpen(false)}
        onDone={finishServiceMenu}
        onServiceMenuChange={onServiceMenuChange}
        open={serviceLibraryOpen}
        serviceMenu={profile.serviceMenu}
      />
    </section>
  );
}

type StartingPointScreenProps = {
  businessName: string;
  canGoBack?: boolean;
  canvaIntentNoted?: boolean;
  logoUrl?: string;
  location?: LocationDraft;
  onBack: () => void;
  onCanvaIntent?: () => void;
  onChooseStarter: (starter: StarterId) => void;
  ownerName?: string;
  reducedMotion?: boolean;
  selectedStarter: StarterId | null;
};

/**
 * Lets the press/selection beat land before the flow advances. Kept just
 * under the shared selection+press motion budget so the choice feels
 * deliberate without reading as lag.
 */
const STARTER_COMMIT_DELAY_MS = 320;

export function StartingPointScreen({
  businessName,
  canGoBack = false,
  canvaIntentNoted = false,
  logoUrl,
  location,
  onBack,
  onCanvaIntent,
  onChooseStarter,
  ownerName,
  reducedMotion = false,
  selectedStarter,
}: StartingPointScreenProps) {
  const copy = SCREEN_METADATA.starter;
  const feedback = useFeedback();
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const motionReduced = reducedMotion || systemReducedMotion;
  const [committingStarter, setCommittingStarter] = useState<StarterId | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const publicLocation = location ? getPublicLocationPreview(location).primary : '';

  useEffect(() => () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    }
  }, []);

  const chooseStarter = (starter: StarterId) => {
    if (committingStarter) {
      return;
    }
    feedback.send({ kind: 'selection' });
    // Re-selection and switching go through their own confirm flow; only a
    // first-time choice earns the commit beat, and reduced motion skips it.
    if (motionReduced || selectedStarter !== null) {
      onChooseStarter(starter);
      return;
    }
    setCommittingStarter(starter);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      setCommittingStarter(null);
      onChooseStarter(starter);
    }, STARTER_COMMIT_DELAY_MS);
  };

  return (
    <main className="onboarding-starter-entry" id="onboarding-starter-entry">
      <div aria-label="Luster" className="onboarding-starter-entry__brand">
        <span aria-hidden="true">L</span>
        <strong>Luster</strong>
      </div>
      <section aria-labelledby="starting-point-heading" className="onboarding-starter-entry__content">
        <header className="onboarding-starter-entry__heading">
          <p className="onboarding-screen-kicker">{STARTER_ENTRY_COPY.kicker}</p>
          <h1 id="starting-point-heading">{copy.heading}</h1>
          <p>{copy.supportingCopy}</p>
        </header>
        <div
          className="onboarding-starter-entry__grid"
          data-committing-starter={committingStarter ?? undefined}
        >
          <StarterChoiceGrid
            businessName={businessName.trim() || 'Your business'}
            committingStarter={committingStarter}
            logoUrl={logoUrl}
            onChoose={chooseStarter}
            ownerName={ownerName}
            publicLocation={publicLocation}
            reducedMotion={reducedMotion}
            selectedStarter={selectedStarter}
          />
        </div>
        {onCanvaIntent
          ? (
              <div className="onboarding-starter-entry__canva">
                <button
                  aria-pressed={canvaIntentNoted}
                  type="button"
                  onClick={() => {
                    feedback.send({ kind: 'selection' });
                    onCanvaIntent();
                  }}
                >
                  {STARTER_ENTRY_COPY.canvaIntent}
                </button>
                <p role="status">{canvaIntentNoted ? STARTER_ENTRY_COPY.canvaConfirmed : ''}</p>
              </div>
            )
          : null}
        <p className="onboarding-lab-note">{STARTER_ENTRY_COPY.autosaveNote}</p>
        <p className="onboarding-starter-entry__reassurance">{STARTER_ENTRY_COPY.reassurance}</p>
      </section>
      {canGoBack
        ? (
            <footer
              aria-label="Onboarding actions"
              className="sticky-onboarding-actions sticky-onboarding-actions--back-only"
            >
              <button type="button" onClick={onBack}>Back</button>
            </footer>
          )
        : null}
    </main>
  );
}

export { StartingPointScreen as StarterScreen };

type StartingPreviewScreenProps = {
  onBack: () => void;
  onContinue: () => void;
  onOpenPreview: () => void;
  preview: ReactNode;
  profile: BusinessProfileDraft;
  reveal?: boolean;
  starter: StarterId;
};

const STARTER_LABELS: Record<StarterId, string> = {
  multi_page: 'Multi-page website',
  one_page: 'One-page website',
  quick_book: 'Quick Book',
};

export function StartingPreviewScreen({
  onBack,
  onContinue,
  onOpenPreview,
  preview,
  profile,
  reveal = false,
  starter,
}: StartingPreviewScreenProps) {
  const copy = SCREEN_METADATA.starting_preview;

  return (
    <section
      aria-labelledby="starting-preview-heading"
      className={`onboarding-screen onboarding-starting-preview-screen${reveal ? ' is-revealing' : ''}`}
    >
      <header className="onboarding-screen__heading">
        <h1 id="starting-preview-heading">{copy.heading}</h1>
        <p>{copy.supportingCopy}</p>
      </header>
      <div className="onboarding-starting-preview__summary">
        <span>{STARTER_LABELS[starter]}</span>
        <strong>{profile.businessName || 'Your business'}</strong>
        {profile.businessName.trim()
          ? (
              <span>{siteUrlForSlug(profile.siteSlug || normalizeSiteSlug(profile.businessName))}</span>
            )
          : null}
      </div>
      <section
        aria-label={`${profile.businessName || 'Your business'} starting website preview`}
        className="onboarding-starting-preview__canvas"
      >
        {preview}
      </section>
      <StickyOnboardingActions
        onBack={onBack}
        onPrimary={onContinue}
        onSkip={onOpenPreview}
        primaryLabel={copy.primaryAction}
        skipLabel={copy.secondaryAction}
      />
    </section>
  );
}

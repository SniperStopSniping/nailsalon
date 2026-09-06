/**
 * Shared renderer for the profile-led and cover-based Quick Book layouts.
 *
 * The onboarding preview and the public booking page both mount this exact
 * component, so a design an owner previews is the design their clients see.
 * It renders one privacy-filtered `QuickBookPresentationProfile`; it never
 * reads records itself and never shows owner instructions.
 *
 * Every composition is built from the same blocks (cover, portrait, logo,
 * identity, facts, contact, story, actions, gallery, booking button) and
 * differs only in arrangement, expressed through `data-qb-layout` and the
 * accompanying stylesheet.
 */
import {
  CalendarDays,
  ChevronDown,
  Clock3,
  Instagram,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Star,
  UserRound,
  X,
} from 'lucide-react';
import {
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import { DefaultCoverIllustration, DefaultPortraitIllustration } from './DefaultImagery';
import {
  getQuickBookLayout,
  type QuickBookFactsTreatment,
  type QuickBookLayoutDefinition,
} from './layouts';
import {
  DEFAULT_COVER_FOCAL_POINT,
  DEFAULT_PORTRAIT_FOCAL_POINT,
  focalPointToObjectPosition,
  type QuickBookCoverSlot,
  type QuickBookGalleryItem,
  quickBookMonogram,
  type QuickBookPortraitSlot,
  type QuickBookPresentationProfile,
} from './presentation-view';

export type QuickBookPresentationProps = {
  profile: QuickBookPresentationProfile;
  /** id of the business-name heading (used for aria-labelledby by the host). */
  headingId: string;
  /** Extra attributes for the business-name heading (test ids, preview markers). */
  headingProps?: HTMLAttributes<HTMLHeadingElement> & Record<`data-${string}`, string | undefined>;
  /** The existing booking entry point; the button never starts its own flow. */
  bookingHref: string;
  onBook?: (event: MouseEvent<HTMLAnchorElement>) => void;
  bookingLabel?: string;
  /** Optional link target for a gallery thumbnail; without one it opens in place. */
  galleryItemHref?: (item: QuickBookGalleryItem) => string | null;
};

type Fact = {
  id: 'location' | 'hours' | 'booking' | 'clients';
  label: string;
  value: string;
  detail: string | null;
  icon: ReactNode;
  href?: string;
};

/**
 * A saved asset that no longer loads (moved storage, revoked provider URL)
 * must never leave a broken frame beside the owner's name: the slot falls
 * back to the same decorative default the missing-upload state uses. The
 * owner is told separately in the dashboard; clients only see a complete
 * composition.
 */
function useBrokenImage(url: string | null): [boolean, () => void, RefObject<HTMLImageElement | null>] {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const ref = useRef<HTMLImageElement | null>(null);
  // An image that already failed before hydration never fires `onError`
  // for React, so the mounted element is checked once as well.
  useEffect(() => {
    const element = ref.current;
    if (url && element && element.complete && element.naturalWidth === 0) {
      setBrokenUrl(url);
    }
  }, [url]);
  return [brokenUrl !== null && brokenUrl === url, () => setBrokenUrl(url), ref];
}

function Logo({ name, src }: { name: string; src: string | null }) {
  const [broken, markBroken, imageRef] = useBrokenImage(src);
  return src && !broken
    ? (
        <span className="qb-logo" data-qb-block="logo">
          <img alt={`${name} logo`} onError={markBroken} ref={imageRef} src={src} />
        </span>
      )
    : (
        <span aria-hidden="true" className="qb-logo qb-logo--monogram" data-qb-block="logo" data-qb-image={broken ? 'fallback' : 'monogram'}>
          {quickBookMonogram(name)}
        </span>
      );
}

function Portrait({ slot, shape }: { slot: QuickBookPortraitSlot; shape: 'circle' | 'tall' }) {
  const [broken, markBroken, imageRef] = useBrokenImage(slot.kind === 'custom' ? slot.url : null);
  if (slot.kind === 'none') {
    return null;
  }
  const showCustom = slot.kind === 'custom' && !broken;
  return (
    <span
      className={`qb-portrait qb-portrait--${shape}`}
      data-qb-block="portrait"
      data-qb-image={showCustom ? 'custom' : broken ? 'fallback' : 'default'}
    >
      {showCustom
        ? (
            <img
              alt={slot.alt}
              data-testid="quick-book-portrait-image"
              onError={markBroken}
              ref={imageRef}
              src={slot.url}
              style={{ objectPosition: focalPointToObjectPosition(slot.focal, DEFAULT_PORTRAIT_FOCAL_POINT) }}
            />
          )
        : <DefaultPortraitIllustration />}
    </span>
  );
}

function Cover({ slot, text }: { slot: QuickBookCoverSlot; text: string | null }) {
  const [broken, markBroken, imageRef] = useBrokenImage(slot?.kind === 'custom' ? slot.url : null);
  if (!slot) {
    return null;
  }
  const showCustom = slot.kind === 'custom' && !broken;
  return (
    <div className="qb-cover" data-qb-block="cover" data-qb-image={showCustom ? 'custom' : broken ? 'fallback' : 'default'}>
      {showCustom
        ? (
            <img
              alt=""
              data-testid="quick-book-cover-image"
              onError={markBroken}
              ref={imageRef}
              src={slot.url}
              style={{ objectPosition: focalPointToObjectPosition(slot.focal, DEFAULT_COVER_FOCAL_POINT) }}
            />
          )
        : <DefaultCoverIllustration />}
      {text
        ? <p className="qb-cover__text" data-testid="quick-book-cover-text">{text}</p>
        : null}
    </div>
  );
}

function Identity({
  profile,
  headingId,
  headingProps,
  showLogo,
  showSpecialties,
  align,
  /** Panel compositions place the real heading inside the panel instead. */
  nameInPanel = false,
}: {
  profile: QuickBookPresentationProfile;
  headingId: string;
  headingProps?: QuickBookPresentationProps['headingProps'];
  showLogo: boolean;
  showSpecialties: boolean;
  align?: 'center';
  nameInPanel?: boolean;
}) {
  const { identity, presentation } = profile;
  return (
    <div className="qb-identity" data-qb-align={align} data-qb-block="identity" data-testid="quick-book-identity">
      {showLogo ? <Logo name={identity.salonName} src={identity.logoUrl} /> : null}
      <div className="qb-identity__copy">
        {nameInPanel
          ? null
          : <h1 {...headingProps} className="qb-name" id={headingId}>{identity.salonName}</h1>}
        {identity.technicianName
          ? <p className="qb-person" data-testid="quick-book-technician-name">{identity.technicianName}</p>
          : null}
        {showSpecialties && presentation.specialties.length > 0
          ? (
              <ul aria-label="Specialties" className="qb-chips" data-testid="quick-book-specialties">
                {presentation.specialties.map(specialty => <li key={specialty}>{specialty}</li>)}
              </ul>
            )
          : null}
      </div>
    </div>
  );
}

function buildFacts(profile: QuickBookPresentationProfile): Fact[] {
  const facts: Fact[] = [];
  if (profile.location) {
    const { location } = profile;
    facts.push({
      id: 'location',
      label: 'Location',
      value: [location.name, location.addressLine].filter(Boolean).join(', ') || location.localityLine || 'Directions',
      detail: location.name || location.addressLine ? location.localityLine : null,
      icon: <MapPin aria-hidden="true" size={18} />,
      href: location.directionsUrl,
    });
  }
  if (profile.hours) {
    facts.push({
      id: 'hours',
      label: 'Hours',
      value: profile.hours.statusLabel,
      detail: profile.hours.todayLabel,
      icon: <Clock3 aria-hidden="true" size={18} />,
    });
  }
  if (profile.presentation.bookingMethod) {
    facts.push({
      id: 'booking',
      label: 'Booking',
      value: profile.presentation.bookingMethod,
      detail: null,
      icon: <CalendarDays aria-hidden="true" size={18} />,
    });
  }
  if (profile.presentation.newClients) {
    facts.push({
      id: 'clients',
      label: 'Clients',
      value: profile.presentation.newClients,
      detail: null,
      icon: <UserRound aria-hidden="true" size={18} />,
    });
  }
  return facts;
}

function Facts({ profile, variant }: {
  profile: QuickBookPresentationProfile;
  variant: QuickBookFactsTreatment;
}) {
  const all = buildFacts(profile);
  // `compact` keeps only what a customer needs to orient themselves; booking
  // method and new-client status move behind Salon details. The layout has
  // decided that its imagery, not its facts, carries the header.
  const facts = variant === 'compact'
    ? all.filter(fact => fact.id === 'location' || fact.id === 'hours')
    : all;
  if (variant === 'none' || facts.length === 0) {
    return null;
  }
  return (
    <div className="qb-facts" data-qb-block="facts" data-qb-variant={variant} data-testid="quick-book-business-details">
      {facts.map((fact) => {
        const body = (
          <>
            {fact.icon}
            <span className="qb-fact__copy">
              <span className="qb-fact__label">{fact.label}</span>
              <strong className="qb-fact__value">{fact.value}</strong>
              {fact.detail ? <span className="qb-fact__detail">{fact.detail}</span> : null}
              {/* Arrival and parking notes are full sentences. They never fit a
                  half-width tile, so they live in Salon details instead. Only
                  the single-column `rows` variant has room for them here. */}
              {fact.id === 'location' && variant === 'rows' && profile.location
                ? profile.location.instructionLines.map(line => (
                  <span className="qb-fact__detail" key={line}>{line}</span>
                ))
                : null}
            </span>
          </>
        );
        if (fact.id === 'hours' && profile.hours) {
          return (
            <details className="qb-fact qb-fact--hours" data-testid="quick-book-hours" key={fact.id}>
              <summary>
                {body}
                <ChevronDown aria-hidden="true" className="qb-fact__chevron" size={16} />
              </summary>
              <dl className="qb-hours-week">
                {profile.hours.weekly.map(row => (
                  <div key={row.day}>
                    <dt>{row.day}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          );
        }
        if (fact.href) {
          return (
            <a
              className="qb-fact qb-fact--link"
              data-testid="quick-book-location"
              href={fact.href}
              key={fact.id}
              rel="noopener noreferrer"
              target="_blank"
            >
              {body}
            </a>
          );
        }
        return (
          <div className="qb-fact" data-testid={`quick-book-fact-${fact.id}`} key={fact.id}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

function Contact({ profile }: { profile: QuickBookPresentationProfile }) {
  const contact = profile.contact;
  if (!contact || (!contact.phone && !contact.email)) {
    return null;
  }
  return (
    <div className="qb-contact" data-qb-block="contact" data-testid="quick-book-contact">
      {contact.phone
        ? (
            <a className="qb-contact__row" href={contact.phone.href}>
              <Phone aria-hidden="true" size={18} />
              <span className="qb-contact__copy">
                <strong>{contact.phone.display}</strong>
                <span>{contact.phone.actionLabel}</span>
              </span>
              <span aria-hidden="true" className="qb-row__arrow">›</span>
            </a>
          )
        : null}
      {contact.email
        ? (
            <a className="qb-contact__row" href={contact.email.href}>
              <Mail aria-hidden="true" size={18} />
              <span className="qb-contact__copy">
                <strong>{contact.email.display}</strong>
                <span>Email</span>
              </span>
              <span aria-hidden="true" className="qb-row__arrow">›</span>
            </a>
          )
        : null}
    </div>
  );
}

function Story({ profile, greeting }: { profile: QuickBookPresentationProfile; greeting: boolean }) {
  if (!profile.bio) {
    return null;
  }
  const name = profile.identity.technicianName;
  return (
    <div className="qb-story" data-qb-block="story">
      {greeting
        ? <p className="qb-story__greeting">{name ? `Hi, I’m ${name}` : `Welcome to ${profile.identity.salonName}`}</p>
        : null}
      <p className="qb-story__text" data-testid="quick-book-bio">{profile.bio}</p>
    </div>
  );
}

/**
 * Everything a layout keeps reachable without printing it in the header.
 * Arrival notes always land here; contact rows and the practical facts a
 * `compact` layout dropped join them when that layout says so. Nothing is
 * removed from the salon record — this is where a curated header keeps its
 * promise that the rest is still one tap away.
 */
function SalonDetails({ profile, layout }: {
  profile: QuickBookPresentationProfile;
  layout: QuickBookLayoutDefinition;
}) {
  const instructions = layout.facts === 'rows' ? [] : profile.location?.instructionLines ?? [];
  const hiddenFacts = layout.facts === 'compact' || layout.facts === 'none'
    ? buildFacts(profile).filter(fact => fact.id === 'booking' || fact.id === 'clients')
    : [];
  const contact = layout.contact === 'disclosure' ? profile.contact : null;
  const hasContact = Boolean(contact?.phone || contact?.email);
  if (instructions.length === 0 && hiddenFacts.length === 0 && !hasContact) {
    return null;
  }
  return (
    <details className="qb-disclosure" data-testid="quick-book-salon-details">
      <summary>
        <MapPin aria-hidden="true" size={18} />
        <span className="qb-disclosure__copy">
          <strong>Salon details</strong>
          <span>{[hasContact ? 'Contact' : null, hiddenFacts.length > 0 ? 'Booking' : null, instructions.length > 0 ? 'Getting there' : null].filter(Boolean).join(' · ')}</span>
        </span>
        <ChevronDown aria-hidden="true" className="qb-fact__chevron" size={16} />
      </summary>
      <div className="qb-disclosure__body">
        {hiddenFacts.map(fact => (
          <p className="qb-detail-line" key={fact.id}>
            <strong>{fact.label}</strong>
            {' '}
            {fact.value}
          </p>
        ))}
        {instructions.length > 0
          ? (
              <div className="qb-detail-block">
                <strong>Getting there</strong>
                {instructions.map(line => <p key={line}>{line}</p>)}
              </div>
            )
          : null}
        {hasContact ? <Contact profile={profile} /> : null}
      </div>
    </details>
  );
}

function Actions({ profile, layout }: {
  profile: QuickBookPresentationProfile;
  layout: QuickBookLayoutDefinition;
}) {
  const aboutName = profile.identity.technicianName ?? profile.identity.salonName;
  // A story-led layout already shows the introduction in the composition, so
  // repeating it as an About disclosure would print the same words twice.
  const showAbout = layout.actions === 'full' && !layout.story && Boolean(profile.bio);
  const details = <SalonDetails layout={layout} profile={profile} />;
  const showLinks = layout.actions !== 'none';
  const hasAny = showAbout || details !== null
    || (showLinks && (profile.policies.length > 0 || profile.reviews || profile.instagram));
  if (!hasAny) {
    return null;
  }
  return (
    <div className="qb-actions" data-qb-block="actions" data-testid="quick-book-profile-actions">
      {details}
      {showAbout
        ? (
            <details className="qb-disclosure" data-testid="quick-book-about">
              <summary>
                <UserRound aria-hidden="true" size={18} />
                <span className="qb-disclosure__copy">
                  <strong>{`About ${aboutName}`}</strong>
                  <span>{profile.presentation.specialties.length > 0 ? profile.presentation.specialties.slice(0, 3).join(' · ') : 'Get to know your nail tech'}</span>
                </span>
                <ChevronDown aria-hidden="true" className="qb-fact__chevron" size={16} />
              </summary>
              <p className="qb-disclosure__body" data-testid="quick-book-bio">{profile.bio}</p>
            </details>
          )
        : null}
      {showLinks && profile.policies.length > 0
        ? (
            <details className="qb-disclosure" data-testid="quick-book-policies">
              <summary>
                <ShieldCheck aria-hidden="true" size={18} />
                <span className="qb-disclosure__copy">
                  <strong>Before you book</strong>
                  <span>{profile.policies.map(policy => policy.label).join(' · ')}</span>
                </span>
                <ChevronDown aria-hidden="true" className="qb-fact__chevron" size={16} />
              </summary>
              <div className="qb-disclosure__body">
                {profile.policies.map(policy => (
                  <div className="qb-policy" key={`${policy.label}-${policy.text}`}>
                    <strong>{policy.label}</strong>
                    <p>{policy.text}</p>
                  </div>
                ))}
              </div>
            </details>
          )
        : null}
      {showLinks && profile.reviews
        ? profile.reviews.href
          ? (
              <a className="qb-link-row" data-testid="quick-book-reviews" href={profile.reviews.href} rel="noopener noreferrer" target="_blank">
                <Star aria-hidden="true" size={18} />
                <span className="qb-disclosure__copy">
                  <strong>Reviews</strong>
                  <span>{`${profile.reviews.ratingText} ★ (${profile.reviews.reviewCountText})`}</span>
                </span>
                <span aria-hidden="true" className="qb-row__arrow">›</span>
              </a>
            )
          : (
              <div className="qb-link-row" data-testid="quick-book-reviews">
                <Star aria-hidden="true" size={18} />
                <span className="qb-disclosure__copy">
                  <strong>Reviews</strong>
                  <span>{`${profile.reviews.ratingText} ★ (${profile.reviews.reviewCountText})`}</span>
                </span>
              </div>
            )
        : null}
      {showLinks && profile.instagram
        ? (
            <a className="qb-link-row" data-testid="quick-book-instagram" href={profile.instagram.href} rel="noopener noreferrer" target="_blank">
              <Instagram aria-hidden="true" size={18} />
              <span className="qb-disclosure__copy">
                <strong>{profile.instagram.label}</strong>
                <span>Instagram</span>
              </span>
              <span aria-hidden="true" className="qb-row__arrow">›</span>
            </a>
          )
        : null}
    </div>
  );
}

function Gallery({ items, galleryItemHref }: {
  items: QuickBookGalleryItem[];
  galleryItemHref?: QuickBookPresentationProps['galleryItemHref'];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<QuickBookGalleryItem | null>(null);
  if (items.length === 0) {
    return null;
  }
  const show = (item: QuickBookGalleryItem) => {
    setOpen(item);
    const dialog = dialogRef.current;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    }
  };
  const hide = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.close();
    }
    setOpen(null);
  };
  return (
    <div className="qb-gallery" data-qb-block="gallery" data-testid="quick-book-gallery">
      <ul aria-label="Recent work">
        {items.map((item) => {
          const href = galleryItemHref?.(item) ?? null;
          const image = <img alt={item.alt} height={item.height ?? undefined} loading="lazy" src={item.url} width={item.width ?? undefined} />;
          return (
            <li key={item.id}>
              {href
                ? <a href={href}>{image}</a>
                : <button aria-label={`Open ${item.alt}`} onClick={() => show(item)} type="button">{image}</button>}
            </li>
          );
        })}
      </ul>
      <dialog aria-label="Gallery photo" className="qb-gallery__dialog" onClose={() => setOpen(null)} ref={dialogRef}>
        {open ? <img alt={open.alt} src={open.url} /> : null}
        <button aria-label="Close photo" className="qb-gallery__close" onClick={hide} type="button">
          <X aria-hidden="true" size={20} />
        </button>
      </dialog>
    </div>
  );
}

function BookButton({ href, label, onBook }: { href: string; label: string; onBook?: QuickBookPresentationProps['onBook'] }) {
  return (
    <a className="qb-book" data-qb-block="book" data-testid="quick-book-book-button" href={href} onClick={onBook}>
      {label}
    </a>
  );
}

export function QuickBookPresentation({
  profile,
  headingId,
  headingProps,
  bookingHref,
  onBook,
  bookingLabel = 'Book an appointment',
  galleryItemHref,
}: QuickBookPresentationProps) {
  const layout = getQuickBookLayout(profile.presentation.layoutId);
  const { presentation, identity } = profile;
  const portrait = <Portrait shape={layout.portraitShape === 'tall' ? 'tall' : 'circle'} slot={presentation.portrait} />;
  const cover = <Cover slot={presentation.cover} text={presentation.coverText} />;
  const book = <BookButton href={bookingHref} label={bookingLabel} onBook={onBook} />;
  // The content recipe, not the presence of a field, decides what this
  // composition puts above booking. Anything it leaves out stays reachable
  // through Salon details, About or Before you book.
  const showLogo = layout.logo !== 'omitted';
  const logoNode = showLogo
    ? <Logo name={identity.salonName} src={identity.logoUrl} />
    : null;
  const factsNode = <Facts profile={profile} variant={layout.facts} />;
  const contact = layout.contact === 'shown' ? <Contact profile={profile} /> : null;
  const actionsNode = <Actions layout={layout} profile={profile} />;
  const gallery = <Gallery galleryItemHref={galleryItemHref} items={presentation.gallery} />;
  const identityProps = { headingId, headingProps, profile };
  const centred = layout.id === 'profile_overlay' || layout.id === 'story_banner';
  const usesInlineStory = layout.story;

  let body: ReactNode;
  switch (layout.id) {
    case 'portrait_rail':
      body = (
        <>
          <div className="qb-rail">
            <div className="qb-rail__copy">
              <Identity {...identityProps} showLogo={showLogo} showSpecialties />
              {presentation.coverText ? <p className="qb-tagline">{presentation.coverText}</p> : null}
            </div>
            {portrait}
          </div>
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'floating_profile':
      body = (
        <>
          <div className="qb-float">
            {logoNode}
            <span className="qb-blob">{portrait}</span>
          </div>
          <Identity {...identityProps} showLogo={false} showSpecialties />
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'signature_stack':
      body = (
        <>
          <div className="qb-float">
            {logoNode}
            <span className="qb-blob">{portrait}</span>
          </div>
          <Identity {...identityProps} showLogo={false} showSpecialties />
          <Story greeting profile={profile} />
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'concierge_panel':
      body = (
        <>
          <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
          <div className="qb-panel" data-qb-block="person-card">
            {portrait}
            <div className="qb-panel__copy">
              {identity.technicianName
                ? <p className="qb-panel__name">{identity.technicianName}</p>
                : <p className="qb-panel__name">{identity.salonName}</p>}
              <p className="qb-panel__role">{identity.technicianName ? 'Your nail tech' : 'Nail studio'}</p>
              {presentation.specialties.length > 0
                ? (
                    <ul aria-label="Specialties" className="qb-panel__list" data-testid="quick-book-specialties">
                      {presentation.specialties.map(specialty => <li key={specialty}>{specialty}</li>)}
                    </ul>
                  )
                : null}
              {profile.bio ? <p className="qb-panel__bio" data-testid="quick-book-bio">{profile.bio}</p> : null}
            </div>
          </div>
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'premium_split':
      body = (
        <>
          <div className="qb-split">
            <div className="qb-split__panel">
              {logoNode}
              <h1 {...headingProps} className="qb-name qb-split__title" id={headingId}>{identity.salonName}</h1>
              {presentation.coverText ? <p className="qb-split__copy">{presentation.coverText}</p> : null}
            </div>
            <Cover slot={presentation.cover} text={null} />
          </div>
          {identity.technicianName || presentation.specialties.length > 0 || presentation.portrait.kind !== 'none'
            ? (
                <div className="qb-band">
                  <Identity {...identityProps} nameInPanel showLogo={false} showSpecialties />
                  {portrait}
                </div>
              )
            : null}
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'asymmetric_luxe':
      body = (
        <>
          <div className="qb-luxe">
            <Cover slot={presentation.cover} text={null} />
            <div className="qb-luxe__panel">
              <h1 {...headingProps} className="qb-name qb-luxe__title" id={headingId}>{identity.salonName}</h1>
              {presentation.coverText ? <p className="qb-luxe__copy">{presentation.coverText}</p> : null}
              {logoNode}
            </div>
            {portrait}
          </div>
          {identity.technicianName || presentation.specialties.length > 0
            ? <Identity {...identityProps} nameInPanel showLogo={false} showSpecialties />
            : null}
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'profile_overlay':
    case 'story_banner':
      body = (
        <>
          <div className="qb-cover-stack">
            {cover}
            {logoNode}
          </div>
          <div className="qb-overlap">{portrait}</div>
          <Identity {...identityProps} align="center" showLogo={false} showSpecialties />
          {usesInlineStory ? <Story greeting profile={profile} /> : null}
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'hero_ribbon':
      body = (
        <>
          <div className="qb-ribbon">
            {cover}
            {logoNode}
            {portrait}
          </div>
          <Identity {...identityProps} showLogo={false} showSpecialties />
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'hero_banner':
    case 'story_intro':
    case 'gallery_header':
      body = (
        <>
          {cover}
          {/* The gallery strip sits under a flush band; the other two overlap the cover edge. */}
          <div className={layout.id === 'gallery_header' ? 'qb-band' : 'qb-band qb-band--overlap'}>
            <Identity {...identityProps} showLogo={showLogo} showSpecialties />
            {portrait}
          </div>
          {layout.id === 'gallery_header' ? gallery : null}
          {usesInlineStory ? <Story greeting profile={profile} /> : null}
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'compact_details':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties />
            {portrait}
          </div>
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'clean_card_pro':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties />
            {portrait}
          </div>
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'editorial_split':
      body = (
        <>
          <div className="qb-band qb-band--editorial">
            <div className="qb-band__copy">
              {logoNode}
              <Identity {...identityProps} showLogo={false} showSpecialties />
            </div>
            <span className="qb-blob qb-blob--small">{portrait}</span>
          </div>
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
    case 'side_portrait':
    default:
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties />
            {portrait}
          </div>
          {factsNode}
          {contact}
          {actionsNode}
          {book}
        </>
      );
      break;
  }

  return (
    <div
      className="qb-presentation"
      data-qb-centred={centred ? 'true' : undefined}
      data-qb-family={layout.family}
      data-qb-layout={layout.id}
    >
      {body}
    </div>
  );
}

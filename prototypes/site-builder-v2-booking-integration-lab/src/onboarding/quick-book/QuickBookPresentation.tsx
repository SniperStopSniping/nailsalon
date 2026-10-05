/**
 * Shared renderer for the retained Quick Book layouts.
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
  Image as ImageIcon,
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
  id: 'location' | 'hours' | 'booking' | 'clients' | 'reviews';
  label: string;
  value: string;
  detail: string | null;
  icon: ReactNode;
  href?: string;
};

const WIDE_LOGO_MIN_ASPECT_RATIO = 4 / 3;

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
  const [wideLogoSrc, setWideLogoSrc] = useState<string | null>(null);
  return src && !broken
    ? (
        <span className="qb-logo" data-qb-block="logo" data-testid="quick-book-logo" data-qb-logo-shape={wideLogoSrc === src ? 'wide' : 'square'}>
          <img
            alt={`${name} logo`}
            onError={markBroken}
            onLoad={(event) => {
              const { naturalHeight, naturalWidth } = event.currentTarget;
              setWideLogoSrc(
                naturalHeight > 0 && naturalWidth / naturalHeight >= WIDE_LOGO_MIN_ASPECT_RATIO
                  ? src
                  : null,
              );
            }}
            ref={imageRef}
            src={src}
          />
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
  /**
   * A layout that heads its own person card with the tech's name must not
   * print that name in the branding row as well.
   */
  showPerson = true,
}: {
  profile: QuickBookPresentationProfile;
  headingId: string;
  headingProps?: QuickBookPresentationProps['headingProps'];
  showLogo: boolean;
  showSpecialties: boolean;
  align?: 'center';
  nameInPanel?: boolean;
  showPerson?: boolean;
}) {
  const { identity, presentation } = profile;
  return (
    <div className="qb-identity" data-qb-align={align} data-qb-block="identity" data-testid="quick-book-identity">
      {showLogo ? <Logo name={identity.salonName} src={identity.logoUrl} /> : null}
      <div className="qb-identity__copy">
        {nameInPanel
          ? null
          : <h1 {...headingProps} className="qb-name" id={headingId}>{identity.salonName}</h1>}
        {showPerson && identity.technicianName
          ? <p className="qb-person" data-testid="quick-book-technician-name">{identity.technicianName}</p>
          : null}
        {showSpecialties && presentation.specialties.length > 0
          ? (
              <ul aria-label="Specialties" className="qb-chips" data-testid="quick-book-specialties">
                {presentation.specialties.slice(0, 2).map(specialty => <li key={specialty}>{specialty}</li>)}
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
      href: location.directionsUrl ?? undefined,
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
  if (profile.reviews) {
    facts.push({ id: 'reviews', label: 'Reviews', value: `${profile.reviews.ratingText} ★ (${profile.reviews.reviewCountText})`, detail: null, icon: <Star aria-hidden="true" size={18} />, href: profile.reviews.href ?? undefined });
  }
  return facts;
}

function Facts({ profile, variant }: {
  profile: QuickBookPresentationProfile;
  variant: QuickBookFactsTreatment;
}) {
  const all = buildFacts(profile);
  // Every fact supplied by the privacy-filtered profile stays easy to scan.
  const facts = all;
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
            </span>
          </>
        );
        if (fact.id === 'hours' && profile.hours) {
          return (
            <details className="qb-fact qb-fact--hours" data-qb-fact={fact.id} data-testid="quick-book-hours" key={fact.id}>
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
              data-qb-fact={fact.id}
              data-testid={`quick-book-${fact.id}`}
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
          <div className="qb-fact" data-qb-fact={fact.id} data-testid={`quick-book-fact-${fact.id}`} key={fact.id}>
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
      {contact.text
        ? (
            <a className="qb-contact__row" href={contact.text.href}>
              <Phone aria-hidden="true" size={18} />
              <span className="qb-contact__copy">
                <strong>{contact.text.display}</strong>
                <span>{contact.text.actionLabel}</span>
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

/** One secondary disclosure. Practical facts and the booking action stay visible. */
function Actions({ profile, layout }: {
  profile: QuickBookPresentationProfile;
  layout: QuickBookLayoutDefinition;
}) {
  const aboutName = profile.identity.technicianName ?? profile.identity.salonName;
  const showAbout = Boolean(profile.fullBio || profile.bio || profile.aboutDetails?.length);
  const specialties = profile.presentation.specialties;
  const instructions = profile.location?.instructionLines ?? [];
  const hasContact = Boolean(profile.contact?.phone || profile.contact?.email);
  const hasPolicies = profile.policies.length > 0;
  if (!showAbout && !specialties.length && !instructions.length && !hasContact && !hasPolicies && !profile.instagram) {
    return null;
  }
  return (
    <details className="qb-secondary" data-content-key={hasPolicies ? 'before_you_book_policies' : undefined} data-qb-block="actions" data-testid="quick-book-profile-actions">
      <summary>
        <ShieldCheck aria-hidden="true" size={18} />
        <span>{hasPolicies ? 'Before you book' : 'More about the studio'}</span>
        <ChevronDown aria-hidden="true" className="qb-fact__chevron" size={16} />
      </summary>
      <div className="qb-secondary__body">
        {showAbout
          ? (
              <section data-testid="quick-book-about">
                <h2>{`About ${aboutName}`}</h2>
                {!layout.story && profile.bio && profile.fullBio && profile.bio !== profile.fullBio ? <p>{profile.bio}</p> : null}
                <p data-testid="quick-book-full-bio">{profile.fullBio || profile.bio}</p>
                {profile.aboutDetails?.map(detail => <p key={detail}>{detail}</p>)}
              </section>
            )
          : null}
        {specialties.length
          ? (
              <section>
                <h2>Specialties</h2>
                <p>{specialties.join(' · ')}</p>
              </section>
            )
          : null}
        {instructions.length
          ? (
              <section>
                <h2>Getting there</h2>
                {instructions.map(line => <p key={line}>{line}</p>)}
              </section>
            )
          : null}
        {hasContact ? <Contact profile={profile} /> : null}
        {hasPolicies
          ? (
              <section data-testid="quick-book-policies">
                <h2>Before you book</h2>
                {profile.policies.map(policy => (
                  <div className="qb-policy" key={`${policy.label}-${policy.text}`}>
                    <strong>{policy.label}</strong>
                    <p>{policy.text}</p>
                  </div>
                ))}
              </section>
            )
          : null}
        {profile.instagram
          ? (
              <a className="qb-link-row" data-content-key="instagram" data-testid="quick-book-instagram" href={profile.instagram.href} rel="noopener noreferrer" target="_blank">
                <Instagram aria-hidden="true" size={18} />
                <span>{profile.instagram.label}</span>
                <span aria-hidden="true">↗</span>
              </a>
            )
          : null}
      </div>
    </details>
  );
}

function GalleryImage({ item }: { item: QuickBookGalleryItem }) {
  const [broken, markBroken, imageRef] = useBrokenImage(item.url);
  return broken
    ? <span aria-label={`${item.alt} unavailable`} className="qb-gallery__missing" role="img"><ImageIcon aria-hidden="true" size={24} /></span>
    : <img alt={item.alt} height={item.height ?? undefined} loading="lazy" onError={markBroken} ref={imageRef} src={item.url} width={item.width ?? undefined} />;
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
          const image = <GalleryImage item={item} />;
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
        {open ? <GalleryImage item={open} /> : null}
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
  const showLogo = layout.logo !== 'omitted' && (Boolean(identity.logoUrl) || !['compact_dropdown', 'ultra_minimal', 'clean_card'].includes(layout.id));
  const logoNode = showLogo
    ? <Logo name={identity.salonName} src={identity.logoUrl} />
    : null;
  const factsNode = <Facts profile={profile} variant={layout.facts} />;

  const actionsNode = <Actions layout={layout} profile={profile} />;
  const coverUrl = presentation.cover?.kind === 'custom' ? presentation.cover.url : null;
  const galleryItems = layout.id === 'gallery_header' && presentation.cover?.kind === 'custom'
    ? presentation.gallery.filter(item => item.url !== coverUrl)
    : presentation.gallery;
  const gallery = <Gallery galleryItemHref={galleryItemHref} items={galleryItems} />;
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
              <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
              {presentation.coverText ? <p className="qb-tagline">{presentation.coverText}</p> : null}
            </div>
            {portrait}
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'floating_profile':
      body = (
        <>
          <div className="qb-band qb-float">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            <span className="qb-blob">{portrait}</span>
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'signature_stack':
      body = (
        <>
          <div className="qb-band qb-float">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            <span className="qb-blob">{portrait}</span>
          </div>
          <Story greeting={false} profile={profile} />
          {factsNode}
          {book}
        </>
      );
      break;
    case 'concierge_panel':
      body = (
        <>
          <Identity {...identityProps} showLogo={showLogo} showPerson={false} showSpecialties={false} />
          <div className="qb-panel" data-qb-block="person-card">
            {portrait}
            <div className="qb-panel__copy">
              {identity.technicianName
                ? <p className="qb-panel__name">{identity.technicianName}</p>
                : <p className="qb-panel__name">{identity.salonName}</p>}
              <p className="qb-panel__role">{identity.technicianName ? 'Your nail tech' : 'Nail studio'}</p>
              {profile.bio ? <p className="qb-panel__bio" data-testid="quick-book-bio">{profile.bio}</p> : null}
            </div>
          </div>
          {factsNode}
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
                  <Identity {...identityProps} nameInPanel showLogo={false} showSpecialties={false} />
                  {portrait}
                </div>
              )
            : null}
          {factsNode}
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
            ? <Identity {...identityProps} nameInPanel showLogo={false} showSpecialties={false} />
            : null}
          {factsNode}
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
          <Identity {...identityProps} align="center" showLogo={false} showSpecialties={false} />
          {usesInlineStory ? <Story greeting={false} profile={profile} /> : null}
          {factsNode}
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
          <Identity {...identityProps} showLogo={false} showSpecialties={false} />
          {factsNode}
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
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {layout.id === 'gallery_header' ? gallery : null}
          {usesInlineStory ? <Story greeting={false} profile={profile} /> : null}
          {factsNode}
          {book}
        </>
      );
      break;
    case 'compact_details':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'clean_card_pro':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {factsNode}
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
              <Identity {...identityProps} showLogo={false} showSpecialties={false} />
            </div>
            <span className="qb-blob qb-blob--small">{portrait}</span>
          </div>
          {factsNode}
          {book}
        </>
      );
      break;
    case 'compact_dropdown':
      body = (
        <>
          <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
          {factsNode}
        </>
      );
      break;
    case 'ultra_minimal':
      body = (
        <div className="qb-minimal">
          <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
          {factsNode}
        </div>
      );
      break;
    case 'clean_card':
      body = (
        <>
          <Identity {...identityProps} align="center" showLogo={showLogo} showSpecialties={false} />
          {factsNode}
          {book}
        </>
      );
      break;
    case 'profile_story':
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={false} showSpecialties={false} />
            {portrait}
          </div>
          <Story greeting={false} profile={profile} />
          {factsNode}
          {book}
        </>
      );
      break;
    case 'side_portrait':
    default:
      body = (
        <>
          <div className="qb-band">
            <Identity {...identityProps} showLogo={showLogo} showSpecialties={false} />
            {portrait}
          </div>
          {factsNode}
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
      data-qb-long-name={identity.salonName.length > 26 ? 'true' : undefined}
    >
      <div className="qb-main">{body}</div>
      {actionsNode}
    </div>
  );
}

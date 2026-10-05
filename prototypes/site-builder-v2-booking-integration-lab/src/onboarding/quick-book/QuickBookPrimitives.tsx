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
import type {
  QuickBookFactsTreatment,
  QuickBookLayoutDefinition,
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

export function Identity({
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

export function Facts({ profile, variant }: {
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

export function Story({ profile, greeting }: { profile: QuickBookPresentationProfile; greeting: boolean }) {
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
function Actions({ profile, layout, additionalDetails, summaryLabel }: {
  profile: QuickBookPresentationProfile;
  layout: QuickBookLayoutDefinition;
  /** Optional composition-owned information; existing callers are unchanged. */
  additionalDetails?: ReactNode;
  summaryLabel?: string;
}) {
  const aboutName = profile.identity.technicianName ?? profile.identity.salonName;
  const showAbout = Boolean(profile.fullBio || profile.bio || profile.aboutDetails?.length);
  const specialties = profile.presentation.specialties;
  const instructions = profile.location?.instructionLines ?? [];
  const hasContact = Boolean(profile.contact?.phone || profile.contact?.email);
  const hasPolicies = profile.policies.length > 0;
  if (!additionalDetails && !showAbout && !specialties.length && !instructions.length && !hasContact && !hasPolicies && !profile.instagram) {
    return null;
  }
  return (
    <details className="qb-secondary" data-content-key={hasPolicies ? 'before_you_book_policies' : undefined} data-qb-block="actions" data-testid="quick-book-profile-actions">
      <summary>
        <ShieldCheck aria-hidden="true" size={18} />
        <span>{summaryLabel ?? (hasPolicies ? 'Before you book' : 'More about the studio')}</span>
        <ChevronDown aria-hidden="true" className="qb-fact__chevron" size={16} />
      </summary>
      <div className="qb-secondary__body">
        {additionalDetails}
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

// Composition primitives shared by customer and preview renderers.
export {
  buildFacts as buildQuickBookFacts,
  Cover as QuickBookCover,
  Logo as QuickBookLogo,
  Portrait as QuickBookPortrait,
  Actions as QuickBookSecondaryDetails,
};

function GalleryImage({ item }: { item: QuickBookGalleryItem }) {
  const [broken, markBroken, imageRef] = useBrokenImage(item.url);
  return broken
    ? <span aria-label={`${item.alt} unavailable`} className="qb-gallery__missing" role="img"><ImageIcon aria-hidden="true" size={24} /></span>
    : <img alt={item.alt} height={item.height ?? undefined} loading="lazy" onError={markBroken} ref={imageRef} src={item.url} width={item.width ?? undefined} />;
}

export function Gallery({ items, galleryItemHref }: {
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

export function BookButton({ href, label, onBook }: { href: string; label: string; onBook?: QuickBookPresentationProps['onBook'] }) {
  return (
    <a className="qb-book" data-qb-block="book" data-testid="quick-book-book-button" href={href} onClick={onBook}>
      {label}
    </a>
  );
}

import {
  ChevronDown,
  Clock3,
  Instagram,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Star,
} from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';

import type { BookingStep } from '@/libs/bookingFlow';
import { getStepLabel } from '@/libs/bookingFlow';
import {
  type QuickBookSiteLayout,
  resolveQuickBookSiteLayout,
} from '@/libs/quickBookSiteLayout';
import { themeVars } from '@/theme';

import type { QuickBookProfileView } from './quickBookProfile';

type QuickBookProfileHeaderProps = {
  profile: QuickBookProfileView;
  bookingFlow: BookingStep[];
  layout?: QuickBookSiteLayout;
  mounted: boolean;
  announcement?: ReactNode;
};

function ProfileLogo({ name, src }: { name: string; src: string }) {
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm sm:size-[4.5rem]">
      <Image
        src={src}
        alt={`${name} logo`}
        width={72}
        height={72}
        unoptimized
        className="size-full object-contain p-1"
      />
    </div>
  );
}

function TechnicianPhoto({ name, src }: { name: string; src: string }) {
  return (
    <div className="relative size-16 shrink-0 overflow-hidden rounded-full border-2 border-white bg-neutral-100 shadow-sm sm:size-[4.5rem]">
      <Image
        src={src}
        alt={name}
        width={72}
        height={72}
        unoptimized
        className="size-full object-cover"
      />
    </div>
  );
}

export function QuickBookProfileHeader({
  profile,
  bookingFlow,
  layout,
  mounted,
  announcement,
}: QuickBookProfileHeaderProps) {
  const activeLayout = resolveQuickBookSiteLayout(layout);
  const hasSecondaryActions = profile.policies.length > 0 || profile.reviews || profile.instagram;
  const contactCount = Number(Boolean(profile.contact?.phone))
    + Number(Boolean(profile.contact?.email));
  const secondaryLinkCount = Number(Boolean(profile.reviews))
    + Number(Boolean(profile.instagram));
  const collapseBusinessDetails = activeLayout === 'compact_dropdown'
    || activeLayout === 'ultra_minimal';

  return (
    <div
      data-testid="booking-step-header"
      data-quick-book-layout={activeLayout}
      className="booking-header-safe-top"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 300ms ease-out, transform 300ms ease-out',
      }}
    >
      <section
        data-public-surface="salonProfile"
        data-testid="quick-book-profile"
        data-layout-presentation={activeLayout}
        aria-labelledby="quick-book-profile-name"
        className={`mb-5 overflow-hidden border bg-white ${
          activeLayout === 'editorial'
            ? 'rounded-none border-x-0 shadow-none'
            : activeLayout === 'ultra_minimal'
              ? 'rounded-2xl shadow-sm'
              : activeLayout === 'profile_story'
                ? 'rounded-[2rem] shadow-[0_18px_46px_rgba(78,45,57,0.12)]'
                : activeLayout === 'compact_dropdown'
                  ? 'rounded-2xl shadow-[0_8px_24px_rgba(78,45,57,0.07)]'
                  : 'rounded-[1.75rem] shadow-[0_14px_40px_rgba(78,45,57,0.09)]'
        }`}
        style={{ borderColor: themeVars.cardBorder }}
      >
        <div className={`flex flex-col ${activeLayout === 'ultra_minimal' ? 'p-3 sm:p-4' : 'p-4 sm:p-5'}`}>
          <div
            data-testid="quick-book-identity"
            className={`flex min-w-0 gap-3 sm:gap-4 ${
              activeLayout === 'editorial'
                ? 'items-center justify-center text-center'
                : activeLayout === 'clean_card'
                  ? 'flex-col items-center text-center sm:flex-row sm:text-left'
                  : activeLayout === 'profile_story'
                    ? 'items-start'
                    : 'items-center'
            }`}
          >
            {profile.identity.logoUrl
              ? <ProfileLogo name={profile.identity.salonName} src={profile.identity.logoUrl} />
              : null}

            <div className={activeLayout === 'editorial' ? 'max-w-sm' : 'min-w-0 flex-1'}>
              <h1
                id="quick-book-profile-name"
                data-testid="booking-salon-name"
                className={`break-words font-bold leading-tight text-neutral-950 ${
                  activeLayout === 'editorial'
                    ? 'font-serif text-3xl uppercase tracking-[0.08em] sm:text-4xl'
                    : activeLayout === 'profile_story'
                      ? 'font-serif text-2xl tracking-tight sm:text-3xl'
                      : 'text-xl tracking-tight sm:text-2xl'
                }`}
              >
                {profile.identity.salonName}
              </h1>
              {profile.identity.technicianName
                ? (
                    <p data-testid="quick-book-technician-name" className="mt-1 break-words text-sm font-medium text-neutral-600 sm:text-base">
                      {profile.identity.technicianName}
                    </p>
                  )
                : null}
            </div>

            {profile.identity.technicianPhotoUrl
              ? (
                  <TechnicianPhoto
                    name={profile.identity.technicianName ?? profile.identity.salonName}
                    src={profile.identity.technicianPhotoUrl}
                  />
                )
              : null}
          </div>

          {profile.location || profile.hours || profile.contact
            ? (
                <details
                  className={`group mt-4 border-t border-neutral-100 ${activeLayout === 'profile_story' ? 'order-2' : ''}`}
                  data-testid="quick-book-business-details-disclosure"
                  open={!collapseBusinessDetails}
                >
                  <summary
                    className={collapseBusinessDetails
                      ? 'flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-sm font-semibold text-neutral-800 focus-visible:rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden'
                      : 'hidden'}
                  >
                    <MapPin aria-hidden="true" className="size-4" style={{ color: themeVars.accent }} />
                    <span className="flex-1">
                      {activeLayout === 'ultra_minimal' ? 'More details' : 'Salon details'}
                    </span>
                    <ChevronDown aria-hidden="true" className="size-4 text-neutral-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                  </summary>
                  <div
                    data-testid="quick-book-business-details"
                    className={`${
                      activeLayout === 'hub_menu'
                        ? 'grid grid-cols-2 gap-2 pt-3 [&>*]:rounded-2xl [&>*]:border [&>*]:border-neutral-100 [&>*]:px-3'
                        : activeLayout === 'editorial'
                          ? 'grid gap-x-4 divide-y divide-neutral-100 sm:grid-cols-2 sm:divide-y-0'
                          : activeLayout === 'compact_dropdown' || activeLayout === 'ultra_minimal'
                            ? 'divide-y divide-neutral-100 text-sm'
                            : 'divide-y divide-neutral-100'
                    }`}
                  >
                    {profile.location
                      ? (
                          <a
                            data-testid="quick-book-location"
                            href={profile.location.directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-14 items-start gap-3 py-3 text-left focus-visible:rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0" style={{ color: themeVars.accent }} />
                            <span className="min-w-0 flex-1 text-sm leading-5 text-neutral-700">
                              {profile.location.name ? <strong className="block break-words text-neutral-900">{profile.location.name}</strong> : null}
                              {profile.location.addressLine ? <span className="block break-words">{profile.location.addressLine}</span> : null}
                              {profile.location.localityLine ? <span className="block break-words text-neutral-500">{profile.location.localityLine}</span> : null}
                              {profile.location.instructionLines.map(line => (
                                <span key={line} className="block break-words text-neutral-500">{line}</span>
                              ))}
                            </span>
                            <span aria-hidden="true" className="mt-1 text-xl leading-none text-neutral-400">›</span>
                          </a>
                        )
                      : null}

                    {profile.hours
                      ? (
                          <details data-testid="quick-book-hours" className="group py-1">
                            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
                              <Clock3 aria-hidden="true" className="size-5 shrink-0" style={{ color: themeVars.accent }} />
                              <span className="min-w-0 flex-1 text-sm">
                                <strong className="block text-neutral-900">{profile.hours.statusLabel}</strong>
                                <span className="block text-neutral-500">{profile.hours.todayLabel ?? 'See weekly hours'}</span>
                              </span>
                              <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-neutral-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                            </summary>
                            <dl className="mb-3 ml-8 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-xl bg-neutral-50 px-3 py-2.5 text-xs leading-5 text-neutral-600">
                              {profile.hours.weekly.map(row => (
                                <div key={row.day} className="contents">
                                  <dt>{row.day}</dt>
                                  <dd className="text-right font-medium text-neutral-800">{row.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        )
                      : null}

                    {profile.contact
                      ? (
                          <div
                            data-testid="quick-book-contact"
                            className={`grid gap-2 py-3 ${contactCount === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}
                          >
                            {profile.contact.phone
                              ? (
                                  <a
                                    href={profile.contact.phone.href}
                                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl bg-neutral-50 px-3 text-sm font-medium text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                                  >
                                    <Phone aria-hidden="true" className="size-4 shrink-0" style={{ color: themeVars.accent }} />
                                    <span className="min-w-0">
                                      <span className="block break-words">{profile.contact.phone.display}</span>
                                      <span className="block text-xs font-normal text-neutral-500">
                                        {profile.contact.phone.actionLabel}
                                      </span>
                                    </span>
                                  </a>
                                )
                              : null}
                            {profile.contact.email
                              ? (
                                  <a
                                    href={profile.contact.email.href}
                                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl bg-neutral-50 px-3 text-sm font-medium text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                                  >
                                    <Mail aria-hidden="true" className="size-4 shrink-0" style={{ color: themeVars.accent }} />
                                    <span className="min-w-0 break-all">{profile.contact.email.display}</span>
                                  </a>
                                )
                              : null}
                          </div>
                        )
                      : null}
                  </div>
                </details>
              )
            : null}

          {hasSecondaryActions
            ? (
                <div
                  data-testid="quick-book-profile-actions"
                  className={`mt-3 grid gap-2 border-t border-neutral-100 pt-3 ${activeLayout === 'profile_story' ? 'order-3' : ''} ${
                    activeLayout === 'hub_menu'
                      ? 'grid-cols-2'
                      : secondaryLinkCount === 2
                        ? 'sm:grid-cols-2'
                        : 'grid-cols-1'
                  }`}
                >
                  {profile.policies.length > 0
                    ? (
                        <details data-testid="quick-book-policies" className="group sm:col-span-full">
                          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-neutral-200 px-3 text-sm font-semibold text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
                            <ShieldCheck aria-hidden="true" className="size-4 shrink-0" style={{ color: themeVars.accent }} />
                            <span className="flex-1">Policies</span>
                            <ChevronDown aria-hidden="true" className="size-4 text-neutral-400 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                          </summary>
                          <div className="mt-2 space-y-2 rounded-xl bg-neutral-50 p-3 text-sm leading-5 text-neutral-700">
                            {profile.policies.map(policy => (
                              <div key={`${policy.label}-${policy.text}`}>
                                <strong className="block text-neutral-900">{policy.label}</strong>
                                <p className="whitespace-pre-line break-words">{policy.text}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )
                    : null}

                  {profile.reviews
                    ? profile.reviews.href
                      ? (
                          <a
                            data-testid="quick-book-reviews"
                            href={profile.reviews.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex min-h-11 items-center gap-2 rounded-xl border border-neutral-200 px-3 text-sm font-medium text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            <Star aria-hidden="true" className="size-4 shrink-0" style={{ color: themeVars.accent }} />
                            <span className="min-w-0">
                              <strong className="block">Reviews</strong>
                              <span className="block text-xs font-normal text-neutral-500">
                                {profile.reviews.ratingText}
                                {' ★ ('}
                                {profile.reviews.reviewCountText}
                                )
                              </span>
                            </span>
                          </a>
                        )
                      : (
                          <div data-testid="quick-book-reviews" className="flex min-h-11 items-center gap-2 rounded-xl border border-neutral-200 px-3 text-sm font-medium text-neutral-800">
                            <Star aria-hidden="true" className="size-4 shrink-0" style={{ color: themeVars.accent }} />
                            <span className="min-w-0">
                              <strong className="block">Reviews</strong>
                              <span className="block text-xs font-normal text-neutral-500">
                                {profile.reviews.ratingText}
                                {' ★ ('}
                                {profile.reviews.reviewCountText}
                                )
                              </span>
                            </span>
                          </div>
                        )
                    : null}

                  {profile.instagram
                    ? (
                        <a
                          data-testid="quick-book-instagram"
                          href={profile.instagram.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-neutral-200 px-3 text-sm font-medium text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          <Instagram aria-hidden="true" className="size-4 shrink-0" style={{ color: themeVars.accent }} />
                          <span className="min-w-0 truncate">{profile.instagram.label}</span>
                        </a>
                      )
                    : null}
                </div>
              )
            : null}

          {profile.bio
            ? (
                <p
                  data-testid="quick-book-bio"
                  className={`mt-3 whitespace-pre-line break-words bg-[color-mix(in_srgb,var(--theme-primary)_8%,white)] px-3.5 py-3 text-sm leading-5 text-neutral-700 ${
                    activeLayout === 'profile_story'
                      ? 'order-1 mb-3 rounded-2xl border-l-4 font-medium'
                      : activeLayout === 'editorial'
                        ? 'rounded-none border-y border-neutral-100 bg-transparent text-center font-serif text-base'
                        : 'rounded-2xl'
                  }`}
                >
                  {profile.bio}
                </p>
              )
            : null}
        </div>
      </section>

      {announcement
        ? <div data-testid="booking-step-header-announcement" className="mb-3 flex justify-center">{announcement}</div>
        : null}

      <div className="mb-3 flex items-center justify-center gap-1.5" aria-label="Booking progress">
        {bookingFlow.map((step, index) => (
          <div key={step} className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              <span
                data-testid={`booking-step-marker-${step}`}
                className="flex size-5 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{
                  backgroundColor: index === 0 ? themeVars.primary : '#d4d4d4',
                  color: index === 0 ? '#171717' : '#525252',
                }}
              >
                {index + 1}
              </span>
              <span
                data-testid={`booking-step-label-${step}`}
                className={index === 0 ? 'text-[10px] font-medium text-neutral-900' : 'text-[10px] font-medium text-neutral-500 opacity-60'}
              >
                {getStepLabel(step)}
              </span>
            </div>
            {index < bookingFlow.length - 1 ? <span aria-hidden="true" className="h-px w-3 bg-neutral-300" /> : null}
          </div>
        ))}
      </div>

      <div className="mb-4 text-center">
        <h2 className="text-[1.7rem] font-bold tracking-tight text-neutral-900 sm:text-2xl">Book an appointment</h2>
        <p className="mt-0.5 text-[13px] leading-[1.35] text-neutral-500 sm:text-sm">
          Choose a service, then add any extras.
        </p>
      </div>
    </div>
  );
}

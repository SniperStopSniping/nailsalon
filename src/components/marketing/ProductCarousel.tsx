'use client';

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- A native scroll region must be focusable for keyboard scrolling; arrow/Home/End keys select slides. */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { useRef, useState } from 'react';

import type { MarketingLocale } from '@/libs/marketingContent';

import styles from './home.module.css';
import { homeContent } from './homeContent';

const asset = '/assets/images/homepage/';

function Phone({ src, alt, priority = false, className = '' }: { src: string; alt: string; priority?: boolean; className?: string }) {
  return (
    <div className={`${styles.phone} ${className}`}>
      <Image src={`${asset}${src}`} alt={alt} width={780} height={1688} sizes="(min-width: 1100px) 250px, 270px" priority={priority} draggable={false} />
    </div>
  );
}

function Laptop({ className = '', priority = false }: { className?: string; priority?: boolean }) {
  return (
    <div className={`${styles.laptop} ${className}`}>
      <div className={styles.laptopScreen}>
        <Image src={`${asset}calendar.webp`} alt="Luster calendar with synthetic appointments." width={1440} height={1047} sizes="(min-width: 1100px) 560px, 600px" priority={priority} draggable={false} />
      </div>
      <div className={styles.laptopBase} />
    </div>
  );
}

export function ProductCarousel({ locale }: { locale: MarketingLocale }) {
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const copy = homeContent[locale];
  const select = (index: number) => {
    const target = (index + copy.slides.length) % copy.slides.length;
    const element = track.current;
    if (element) {
      element.scrollTo({ left: target * element.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  };

  return (
    <section className={styles.carousel} aria-label={copy.preview} aria-roledescription="carousel">
      <div
        id="home-preview-track"
        tabIndex={0}
        role="group"
        aria-label={copy.preview}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            select(event.key === 'Home' ? 0 : event.key === 'End' ? copy.slides.length - 1 : active + (event.key === 'ArrowRight' ? 1 : -1));
          }
        }}
        className={styles.track}
        ref={track}
        onScroll={(event) => {
          const element = event.currentTarget;
          setActive(Math.max(0, Math.min(copy.slides.length - 1, Math.round(element.scrollLeft / element.clientWidth))));
        }}
      >
        {copy.slides.map((slide, index) => (
          <div key={slide.title} className={styles.slide} role="group" aria-roledescription="slide" aria-label={`${index + 1} / ${copy.slides.length}: ${slide.title}`} aria-hidden={index !== active}>
            <div className={`${styles.artwork} ${styles[`artwork${index}`]}`}>
              {index === 0 && (
                <>
                  <Laptop className={styles.heroLaptop} />
                  <Phone src="booking-page.webp" alt={slide.alt} priority className={styles.heroPhone} />
                </>
              )}
              {index === 1 && (
                <>
                  <Phone src="services.webp" alt={slide.alt} className={styles.servicePhone} />
                  <Phone src="available-time.webp" alt={locale === 'fr' ? 'Les horaires disponibles dans Luster.' : 'Available appointment times in Luster.'} className={styles.timePhone} />
                </>
              )}
              {index === 2 && <Laptop className={styles.calendarLaptop} />}
              {index === 3 && <Phone src="booking-policy.webp" alt={slide.alt} className={styles.policyPhone} />}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.carouselCaption} aria-live="polite" aria-atomic="true">
        <h2>{copy.slides[active]?.title}</h2>
        <p>{copy.slides[active]?.caption}</p>
        <small>{active === 3 ? copy.smsNote : copy.sample}</small>
      </div>
      <div className={styles.carouselControls}>
        <button type="button" aria-label={copy.previous} aria-controls="home-preview-track" onClick={() => select(active - 1)}><ChevronLeft aria-hidden="true" /></button>
        <div className={styles.dots}>
          {copy.slides.map((slide, index) => <button key={slide.title} type="button" aria-label={`${copy.goTo} ${index + 1}: ${slide.title}`} aria-current={active === index ? 'true' : undefined} aria-controls="home-preview-track" onClick={() => select(index)}><span /></button>)}
        </div>
        <button type="button" aria-label={copy.next} aria-controls="home-preview-track" onClick={() => select(active + 1)}><ChevronRight aria-hidden="true" /></button>
      </div>
    </section>
  );
}

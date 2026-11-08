'use client';

import { Menu, ShoppingBag, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { LUSTER_SHOP_URL, marketingCopy, type MarketingLocale } from '@/libs/marketingContent';
import { marketingPath } from '@/libs/marketingSeo';

import styles from './home.module.css';
import { homeContent } from './homeContent';

const sections = ['booking-app', 'features', 'pricing', 'resources'];

export function HomeHeader({ locale }: { locale: MarketingLocale }) {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const copy = homeContent[locale];
  const language = marketingCopy[locale];
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const media = window.matchMedia('(min-width: 1100px)');
    const onResize = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    media.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      media.removeEventListener('change', onResize);
    };
  }, [open]);

  const links = sections.map((section, index) => (
    <a key={section} href={`#${section}`} onClick={() => setOpen(false)}>{copy.navigation[index]}</a>
  ));
  const languageLink = <a href={locale === 'fr' ? '/en' : '/fr'} hrefLang={locale === 'fr' ? 'en' : 'fr'} aria-label={language.languageLabel}>{language.language}</a>;

  return (
    <header
      className={styles.header}
      ref={header}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <div className={styles.headerInner}>
        {/* Retains the existing public marketing wordmark. */}
        <Link href={marketingPath('/', locale)} className={styles.wordmark} aria-label="Luster">LUSTER</Link>
        <nav className={styles.desktopNav} aria-label={locale === 'fr' ? 'Navigation principale' : 'Main navigation'}>{links}</nav>
        <div className={styles.headerActions}>
          <a href={LUSTER_SHOP_URL} className={styles.shop} aria-label={copy.shop}>
            <ShoppingBag aria-hidden="true" />
            <span className={styles.shopLong}>{copy.shop}</span>
            <span className={styles.shopShort}>{copy.shopShort}</span>
          </a>
          <button ref={toggle} type="button" className={styles.menuToggle} aria-label={open ? copy.menuClose : copy.menuOpen} aria-expanded={open} aria-controls="home-mobile-navigation" onClick={() => setOpen(value => !value)}>
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
        <nav id="home-mobile-navigation" className={styles.mobileNav} hidden={!open} aria-label={locale === 'fr' ? 'Navigation mobile' : 'Mobile navigation'}>
          {links}
          {languageLink}
        </nav>
      </div>
    </header>
  );
}
